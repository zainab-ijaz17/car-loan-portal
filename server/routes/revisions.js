const express = require('express');
const { withDb, withTransaction } = require('../store');
const { requireActor, requireRole } = require('../middleware/auth');
const { verifyEmployeeCredentials } = require('../sfClient');
const { buildSimulation, rateLineCount, vendorById, today, parseDMY, isValidDMY } = require('../rateEngine');
const { fail, handle } = require('../errors');
const { createAlert } = require('../alerts');

const router = express.Router();

// Only one fuel is indexed — the old fuel-type choice is gone.
const FUEL_TYPE = 'Diesel';

function logAudit(db, action, actor, details) {
  db.auditLog.unshift({ action, actor, at: new Date().toISOString(), details });
}

function validateSimulationInput(payload) {
  if (!payload.vendorIds?.length) {
    throw fail('VND-001', 'Select at least one vendor to simulate.', { field: 'Vendor list' });
  }
  if (!isValidDMY(payload.effectiveDate)) {
    throw fail('VND-002', 'Enter the date the new rates take effect as DD.MM.YYYY.', { field: 'Rates effective from' });
  }
}

// POST /revisions/simulate — see app/js/api/revisionsApi.js
router.post('/revisions/simulate', requireActor, requireRole('Rate Maintainer'), handle('running the simulation', async (req, res) => {
  const payload = req.body || {};
  validateSimulationInput(payload);
  res.json(await withDb(async (db) => buildSimulation(db, payload)));
}));

// POST /revisions — see app/js/api/revisionsApi.js
router.post('/revisions', requireActor, requireRole('Rate Maintainer'), handle('submitting the revision for approval', async (req, res) => {
  const payload = req.body || {};
  const result = await withTransaction(async (db, client) => {
    if (db.pendingRevision) {
      throw fail('REV-001', `Revision ${db.pendingRevision.revisionNo} is already pending approval. Wait for it to be released, rejected or returned first.`, { status: 409 });
    }
    if (!payload.notificationId) {
      throw fail('DSL-004', 'Attach the diesel-price notification before submitting.', { field: 'Attach notification' });
    }
    if (!isValidDMY(payload.dieselEffectiveDate)) {
      throw fail('DSL-002', 'Enter the diesel price effective date as DD.MM.YYYY.', { field: 'Effective date' });
    }
    // "Effective date cannot be earlier than the last confirmed price"
    // — dieselPrice.js already enforces this client-side, but that's
    // bypassable by calling the API directly.
    const previous = db.revisions[db.currentRevisionNo];
    if (parseDMY(payload.dieselEffectiveDate) < parseDMY(previous.effectiveDate)) {
      throw fail('DSL-003', `The diesel price effective date cannot be earlier than the last confirmed price (${previous.effectiveDate}).`, { field: 'Effective date' });
    }
    validateSimulationInput(payload);
    const sim = buildSimulation(db, payload);
    if (sim.blocked) {
      const vendorNames = sim.vendors.filter((v) => v.blocked).map((v) => v.name).join(', ');
      throw fail('REV-002', `Some rate lines have no rate yet (${vendorNames}). Type a rate for each under "New rates" before submitting.`, { field: 'New rates' });
    }
    const submittedBy = { employeeId: req.actor.employeeId, name: req.actor.name };
    // Carry the approver's earlier comments along, so whoever reviews the
    // resubmission can check they were addressed.
    const returned = db.returnedRevision;
    db.pendingRevision = {
      ...sim,
      dieselPrice: payload.dieselPrice,
      dieselEffectiveDate: payload.dieselEffectiveDate,
      fuelType: FUEL_TYPE,
      source: payload.source,
      notificationId: payload.notificationId,
      notificationFileName: payload.notificationFileName,
      remarks: payload.remarks || '',
      vendorIds: payload.vendorIds,
      overrides: payload.overrides || {},
      submittedBy,
      submittedOn: today(),
      previousReturn: returned ? { revisionNo: returned.revisionNo, reason: returned.reason, returnedBy: returned.returnedBy, returnedOn: returned.returnedOn } : null,
    };
    db.returnedRevision = null;
    // Submitted — the maintainer's saved draft has done its job.
    await client.query('DELETE FROM revision_drafts WHERE employee_id = $1', [submittedBy.employeeId]);
    logAudit(db, 'revision_submitted', submittedBy, { revisionNo: sim.revisionNo, vendorIds: payload.vendorIds });
    await createAlert(client, {
      toRole: 'Approver',
      actor: submittedBy,
      kind: 'revision_submitted',
      title: `Revision ${sim.revisionNo} is waiting for your approval`,
      body: `Submitted by ${submittedBy.name}${returned ? ' (resubmitted after correction)' : ''} · ${sim.totals.vendorCount} vendor(s), ${sim.totals.rateLineCount} rate lines, effective ${sim.effectiveDate}.`,
      link: '#/approve',
    });
    return { revisionNo: sim.revisionNo, status: 'pending', submittedBy, submittedOn: db.pendingRevision.submittedOn };
  });
  res.json(result);
}));

// GET /revisions/pending — see app/js/api/revisionsApi.js
router.get('/revisions/pending', requireActor, requireRole('Approver'), handle('loading the pending revision', async (req, res) => {
  const result = await withDb(async (db) => {
    const p = db.pendingRevision;
    if (!p) return null;

    const lines = p.vendorIds.flatMap((vid) => {
      const v = vendorById(db, vid);
      const sheet = p.worksheets[vid];
      return sheet.rows.flatMap((row) =>
        row.base.map((b, j) => ({
          vendor: v.name,
          dest: row.dest,
          vehicle: sheet.cols[j],
          currentRate: b,
          upliftAmt: row.inc[j],
          newRate: row.rounded[j],
          changePct: b == null ? null : (row.inc[j] / b) * 100,
        }))
      );
    });

    return {
      revisionNo: p.revisionNo,
      submittedBy: p.submittedBy,
      submittedOn: p.submittedOn,
      dieselPrice: p.dieselPrice,
      dieselEffectiveDate: p.dieselEffectiveDate,
      previousDieselPrice: db.revisions[db.currentRevisionNo].dieselPrice,
      effectiveDate: p.effectiveDate,
      fuelType: FUEL_TYPE,
      source: p.source,
      notificationId: p.notificationId,
      notificationFileName: p.notificationFileName,
      remarks: p.remarks,
      previousReturn: p.previousReturn || null,
      totals: { ...p.totals, upliftPct: p.overallUpliftPct },
      lines,
    };
  });
  res.json(result);
}));

// GET /revisions/returned — the revision an approver last sent back for
// correction, with their comments, until a maintainer resubmits it. See
// app/js/api/revisionsApi.js.
router.get('/revisions/returned', requireActor, requireRole('Rate Maintainer'), handle('loading the returned revision', async (req, res) => {
  res.json(await withDb(async (db) => db.returnedRevision ?? null));
}));

function requirePending(db, revisionNo) {
  const p = db.pendingRevision;
  if (!p || p.revisionNo !== revisionNo) {
    throw fail('APR-001', `Revision ${revisionNo} is no longer pending approval — someone may already have acted on it. Reload the page.`, { status: 404 });
  }
  return p;
}

// POST /revisions/:revisionNo/approve — see app/js/api/revisionsApi.js
// The approver is whoever this session belongs to — never an ID taken
// from the request body. Re-authenticates them against real
// SuccessFactors (same check as login) before writing anything, and
// refuses if they're also the original submitter. The resulting rates are this app's own system of record —
// nothing here writes to SAP.
router.post('/revisions/:revisionNo/approve', requireActor, requireRole('Approver'), handle('approving the revision', async (req, res) => {
  const revisionNo = Number(req.params.revisionNo);
  const { password } = req.body || {};
  const { employeeId, name } = req.actor;

  const result = await withTransaction(async (db, client) => {
    const p = requirePending(db, revisionNo);
    if (employeeId === p.submittedBy.employeeId) {
      throw fail('APR-002', 'You submitted this revision, so you cannot also approve it. Another approver must release it.', { status: 403 });
    }

    let valid;
    try {
      valid = await verifyEmployeeCredentials(employeeId, password);
    } catch (loginErr) {
      console.error('SF re-auth error:', loginErr.message);
      throw fail('APR-006', 'Could not reach SAP SuccessFactors to confirm your password. Try again in a moment.', { status: 502 });
    }
    // 403, not 401: a 401 makes the client end the whole session, which
    // is the wrong response to a mistyped confirmation password.
    if (!valid) throw fail('APR-003', 'That password is incorrect. Re-enter your SAP password to release the revision.', { status: 403, field: 'Password' });

    const closedRevisionNo = db.currentRevisionNo;
    const closedDate = db.revisions[closedRevisionNo].effectiveDate;

    // Archive an exact snapshot of both the closed and the new rows so
    // rates.js's history/annexure endpoints can show this vendor's real
    // numbers for both revisions from now on. The closed one is only
    // filled in if it doesn't already have a snapshot (it normally
    // does, from when it was itself the "new" revision at the previous
    // approval) — writing it unconditionally here would blow away that
    // revision's own audit trail with a copy carrying none.
    p.vendorIds.forEach((vid) => {
      const sheet = db.rateSheets[vid];
      db.rateSnapshots[vid] = db.rateSnapshots[vid] || {};
      if (!db.rateSnapshots[vid][closedRevisionNo]) {
        db.rateSnapshots[vid][closedRevisionNo] = { rows: sheet.rows.map((row) => [...row]), auditRows: null };
      }

      const worksheet = p.worksheets[vid];
      sheet.rows = sheet.rows.map((row, i) => {
        const newRow = [row[0]];
        const wRow = worksheet.rows[i];
        for (let j = 0; j < row.length - 1; j++) {
          newRow.push(wRow.rounded[j] == null ? row[j + 1] : wRow.rounded[j]);
        }
        return newRow;
      });
      // Section 6: keep the base rate and unrounded adjusted rate
      // alongside the published one, per line, for audit.
      const auditRows = worksheet.rows.map((wRow) => ({ dest: wRow.dest, base: wRow.base, sum: wRow.sum, rounded: wRow.rounded }));
      db.rateSnapshots[vid][revisionNo] = { rows: sheet.rows.map((row) => [...row]), auditRows };
    });

    db.revisions[revisionNo] = {
      dieselPrice: p.dieselPrice,
      effectiveDate: p.effectiveDate,
      factor: 1,
      approvedBy: name,
      approvedOn: today(),
      notificationId: p.notificationId,
    };
    db.currentRevisionNo = revisionNo;

    const linesWritten = p.vendorIds.reduce((sum, id) => sum + rateLineCount(db, id), 0);
    db.pendingRevision = null;
    const approver = { employeeId, name };
    logAudit(db, 'revision_approved', approver, { revisionNo, linesWritten });
    await createAlert(client, {
      toRole: 'Rate Maintainer',
      actor: approver,
      kind: 'revision_approved',
      title: `Revision ${revisionNo} approved and released`,
      body: `Approved by ${name} · ${linesWritten} rate lines now in effect from ${p.effectiveDate}.`,
      link: '#/lookup',
    });

    return { revisionNo, linesWritten, effectiveDate: p.effectiveDate, closedRevisionNo, closedDate };
  });
  res.json(result);
}));

// POST /revisions/:revisionNo/reject — see app/js/api/revisionsApi.js
router.post('/revisions/:revisionNo/reject', requireActor, requireRole('Approver'), handle('rejecting the revision', async (req, res) => {
  const revisionNo = Number(req.params.revisionNo);
  const reason = req.body?.reason?.trim();
  const result = await withTransaction(async (db, client) => {
    requirePending(db, revisionNo);
    if (!reason) throw fail('APR-004', 'Enter a reason for rejecting this revision.', { field: 'Reason' });
    db.pendingRevision = null;
    logAudit(db, 'revision_rejected', req.actor, { revisionNo, reason });
    await createAlert(client, {
      toRole: 'Rate Maintainer',
      actor: req.actor,
      kind: 'revision_rejected',
      title: `Revision ${revisionNo} was rejected`,
      body: `Rejected by ${req.actor.name} on ${today()}. Reason: ${reason}`,
      link: '#/diesel-price',
    });
    return { revisionNo, status: 'rejected' };
  });
  res.json(result);
}));

// POST /revisions/:revisionNo/return — see app/js/api/revisionsApi.js
// Unlike reject, the submission is kept (as returnedRevision) together
// with the approver's comments, so the maintainer sees exactly what to
// change and can reopen it pre-filled instead of starting over.
router.post('/revisions/:revisionNo/return', requireActor, requireRole('Approver'), handle('returning the revision for correction', async (req, res) => {
  const revisionNo = Number(req.params.revisionNo);
  const reason = req.body?.reason?.trim();
  const result = await withTransaction(async (db, client) => {
    const p = requirePending(db, revisionNo);
    if (!reason) throw fail('APR-005', 'Enter the corrections needed, so the maintainer knows what to change.', { field: 'Corrections required' });
    db.returnedRevision = {
      revisionNo,
      reason,
      returnedBy: req.actor,
      returnedOn: today(),
      submittedBy: p.submittedBy,
      submittedOn: p.submittedOn,
      draft: {
        dieselPrice: p.dieselPrice,
        dieselEffectiveDate: p.dieselEffectiveDate,
        effectiveDate: p.effectiveDate,
        source: p.source,
        notificationId: p.notificationId,
        notificationFileName: p.notificationFileName,
        remarks: p.remarks,
        vendorIds: p.vendorIds,
        overrides: p.overrides || {},
      },
    };
    db.pendingRevision = null;
    logAudit(db, 'revision_returned', req.actor, { revisionNo, reason });
    await createAlert(client, {
      toRole: 'Rate Maintainer',
      actor: req.actor,
      kind: 'revision_returned',
      title: `Revision ${revisionNo} was returned for correction`,
      body: `Corrections required (${req.actor.name}): ${reason}`,
      link: '#/diesel-price',
    });
    return { revisionNo, status: 'returned' };
  });
  res.json(result);
}));

module.exports = router;
