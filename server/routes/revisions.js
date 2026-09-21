const express = require('express');
const { withDb, withTransaction } = require('../store');
const { requireActor } = require('../middleware/auth');
const { verifyEmployeeCredentials } = require('../sfClient');
const { buildSimulation, rateLineCount, vendorById, today, parseDMY } = require('../rateEngine');

const router = express.Router();

function logAudit(db, action, actor, details) {
  db.auditLog.unshift({ action, actor, at: new Date().toISOString(), details });
}

// POST /revisions/simulate — see app/js/api/revisionsApi.js
router.post('/revisions/simulate', requireActor, async (req, res) => {
  const payload = req.body || {};
  if (!payload.vendorIds?.length) {
    return res.status(422).json({ message: 'Select at least one vendor to simulate.' });
  }
  try {
    const result = await withDb(async (db) => buildSimulation(db, payload));
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// POST /revisions — see app/js/api/revisionsApi.js
router.post('/revisions', requireActor, async (req, res) => {
  const payload = req.body || {};
  try {
    const result = await withTransaction(async (db) => {
      if (db.pendingRevision) {
        const err = new Error('A revision is already pending approval. Wait for it to be released or rejected first.');
        err.status = 409;
        throw err;
      }
      if (!payload.notificationId) {
        const err = new Error('A diesel-price notification attachment is required.');
        err.status = 422;
        throw err;
      }
      // "Effective date cannot be earlier than the last confirmed price"
      // — dieselPrice.js already enforces this client-side via the date
      // input's min, but that's bypassable by calling the API directly.
      const previous = db.revisions[db.currentRevisionNo];
      if (payload.dieselEffectiveDate && parseDMY(payload.dieselEffectiveDate) < parseDMY(previous.effectiveDate)) {
        const err = new Error(`Diesel price effective date cannot be earlier than the last confirmed price (${previous.effectiveDate}).`);
        err.status = 422;
        throw err;
      }
      const sim = buildSimulation(db, payload);
      if (sim.blocked) {
        const err = new Error('This revision has lines with no computable rate and cannot be submitted until they are resolved.');
        err.status = 422;
        throw err;
      }
      db.pendingRevision = {
        ...sim,
        dieselPrice: payload.dieselPrice,
        dieselEffectiveDate: payload.dieselEffectiveDate,
        fuelType: payload.fuelType,
        source: payload.source,
        notificationId: payload.notificationId,
        notificationFileName: payload.notificationFileName,
        remarks: payload.remarks || '',
        vendorIds: payload.vendorIds,
        submittedBy: payload.submittedBy,
        submittedOn: today(),
      };
      logAudit(db, 'revision_submitted', payload.submittedBy, { revisionNo: sim.revisionNo, vendorIds: payload.vendorIds });
      return { revisionNo: sim.revisionNo, status: 'pending', submittedBy: payload.submittedBy, submittedOn: db.pendingRevision.submittedOn };
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// GET /revisions/pending — see app/js/api/revisionsApi.js
router.get('/revisions/pending', requireActor, async (req, res) => {
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
      fuelType: p.fuelType,
      source: p.source,
      notificationId: p.notificationId,
      notificationFileName: p.notificationFileName,
      totals: { ...p.totals, upliftPct: p.overallUpliftPct },
      lines,
    };
  });
  res.json(result);
});

// POST /revisions/:revisionNo/approve — see app/js/api/revisionsApi.js
// Re-authenticates the approver against real SuccessFactors (same check as
// login) before writing anything, and refuses if they're also the original
// submitter. The resulting rates are this app's own system of record (see
// MEMORY / today's discussion) — nothing here writes to SAP.
router.post('/revisions/:revisionNo/approve', requireActor, async (req, res) => {
  const revisionNo = Number(req.params.revisionNo);
  const { employeeId, password, name } = req.body || {};

  try {
    const result = await withTransaction(async (db) => {
      const p = db.pendingRevision;
      if (!p || p.revisionNo !== revisionNo) {
        const err = new Error('No matching revision is pending approval.');
        err.status = 404;
        throw err;
      }
      if (employeeId === p.submittedBy.employeeId) {
        const err = new Error('The approver cannot be the same person who submitted this revision.');
        err.status = 403;
        throw err;
      }

      let valid;
      try {
        valid = await verifyEmployeeCredentials(employeeId, password);
      } catch (loginErr) {
        console.error('SF re-auth error:', loginErr.message);
        const err = new Error('Could not reach SAP SuccessFactors. Try again in a moment.');
        err.status = 502;
        throw err;
      }
      if (!valid) {
        const err = new Error('Incorrect password.');
        err.status = 401;
        throw err;
      }

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
        approvedBy: name || employeeId,
        approvedOn: today(),
        notificationId: p.notificationId,
      };
      db.currentRevisionNo = revisionNo;

      const linesWritten = p.vendorIds.reduce((sum, id) => sum + rateLineCount(db, id), 0);
      db.pendingRevision = null;
      logAudit(db, 'revision_approved', { employeeId, name }, { revisionNo, linesWritten });

      return { revisionNo, linesWritten, effectiveDate: p.effectiveDate, closedRevisionNo, closedDate };
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// POST /revisions/:revisionNo/reject — see app/js/api/revisionsApi.js
router.post('/revisions/:revisionNo/reject', requireActor, async (req, res) => {
  const revisionNo = Number(req.params.revisionNo);
  const { reason } = req.body || {};
  try {
    const result = await withTransaction(async (db) => {
      const p = db.pendingRevision;
      if (!p || p.revisionNo !== revisionNo) {
        const err = new Error('No matching revision is pending approval.');
        err.status = 404;
        throw err;
      }
      if (!reason?.trim()) {
        const err = new Error('A reason is required to reject a revision.');
        err.status = 422;
        throw err;
      }
      db.pendingRevision = null;
      logAudit(db, 'revision_rejected', req.actor, { revisionNo, reason: reason.trim() });
      return { revisionNo, status: 'rejected' };
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// POST /revisions/:revisionNo/return — see app/js/api/revisionsApi.js
router.post('/revisions/:revisionNo/return', requireActor, async (req, res) => {
  const revisionNo = Number(req.params.revisionNo);
  const { reason } = req.body || {};
  try {
    const result = await withTransaction(async (db) => {
      const p = db.pendingRevision;
      if (!p || p.revisionNo !== revisionNo) {
        const err = new Error('No matching revision is pending approval.');
        err.status = 404;
        throw err;
      }
      if (!reason?.trim()) {
        const err = new Error('A reason is required to return a revision for correction.');
        err.status = 422;
        throw err;
      }
      db.pendingRevision = null;
      logAudit(db, 'revision_returned', req.actor, { revisionNo, reason: reason.trim() });
      return { revisionNo, status: 'returned' };
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

module.exports = router;
