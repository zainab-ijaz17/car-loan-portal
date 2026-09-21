const express = require('express');
const { withDb, withTransaction } = require('../store');
const { requireActor } = require('../middleware/auth');
const { rateLineCount, vendorById } = require('../rateEngine');

const router = express.Router();

function logAudit(db, action, actor, details) {
  db.auditLog.unshift({ action, actor, at: new Date().toISOString(), details });
}

// GET /admin/vendors — see app/js/api/adminApi.js
router.get('/admin/vendors', requireActor, async (req, res) => {
  const result = await withDb(async (db) => {
    const rev = db.revisions[db.currentRevisionNo];
    return db.vendors.map((v) => ({
      ...v,
      rateLineCount: rateLineCount(db, v.id),
      lastRevisedDate: rev.effectiveDate,
    }));
  });
  res.json(result);
});

// PATCH /admin/vendors/:vendorId/agreement — see app/js/api/adminApi.js
router.patch('/admin/vendors/:vendorId/agreement', requireActor, async (req, res) => {
  try {
    const result = await withTransaction(async (db) => {
      const v = vendorById(db, req.params.vendorId);
      const patch = req.body || {};
      const before = { passThroughPct: v.passThroughPct, roundingRule: v.roundingRule, validityStart: v.validityStart, validityEnd: v.validityEnd };
      if (patch.passThroughPct != null) {
        const pct = Number(patch.passThroughPct);
        if (!(pct >= 0 && pct <= 100)) {
          const err = new Error('Pass-through % must be between 0 and 100.');
          err.status = 422;
          throw err;
        }
        v.passThroughPct = pct;
      }
      if (patch.roundingRule != null) v.roundingRule = patch.roundingRule;
      if (patch.validityStart !== undefined) v.validityStart = patch.validityStart || null;
      if (patch.validityEnd !== undefined) v.validityEnd = patch.validityEnd || null;
      logAudit(db, 'agreement_updated', req.actor, { vendorId: v.id, before, after: { passThroughPct: v.passThroughPct, roundingRule: v.roundingRule, validityStart: v.validityStart, validityEnd: v.validityEnd } });
      const rev = db.revisions[db.currentRevisionNo];
      return { ...v, rateLineCount: rateLineCount(db, v.id), lastRevisedDate: rev.effectiveDate };
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// POST /admin/vendors — see app/js/api/adminApi.js
router.post('/admin/vendors', requireActor, async (req, res) => {
  try {
    const result = await withTransaction(async (db) => {
      const payload = req.body || {};
      if (!payload.name?.trim()) {
        const err = new Error('Vendor name is required.');
        err.status = 422;
        throw err;
      }
      if (!payload.firstDestination?.trim() || !payload.firstVehicleType?.trim()) {
        const err = new Error('A new vendor needs at least one destination and one vehicle type to start with.');
        err.status = 422;
        throw err;
      }
      const id = 'V' + Date.now().toString(36).toUpperCase();
      const record = {
        id,
        name: payload.name.trim(),
        annexure: payload.annexure?.trim() || '—',
        passThroughPct: Number(payload.passThroughPct) || 0,
        roundingRule: payload.roundingRule || 'Nearest 100',
        stale: false,
        validityStart: payload.validityStart?.trim() || null,
        validityEnd: payload.validityEnd?.trim() || null,
      };
      db.vendors.push(record);
      db.rateSheets[id] = {
        title: payload.name.trim(),
        annexure: record.annexure,
        cols: [payload.firstVehicleType.trim()],
        weights: [payload.firstWeight?.trim() || '—'],
        rows: [[payload.firstDestination.trim(), Number(payload.firstBaseRate) || 0]],
      };
      logAudit(db, 'vendor_added', req.actor, { vendorId: id, name: record.name });
      const rev = db.revisions[db.currentRevisionNo];
      return { ...record, rateLineCount: rateLineCount(db, id), lastRevisedDate: rev.effectiveDate };
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// GET /admin/vendors/:vendorId/rate-sheet — see app/js/api/adminApi.js
router.get('/admin/vendors/:vendorId/rate-sheet', requireActor, async (req, res) => {
  try {
    const sheet = await withDb(async (db) => {
      vendorById(db, req.params.vendorId);
      return db.rateSheets[req.params.vendorId];
    });
    res.json(sheet);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// POST /admin/vendors/:vendorId/destinations — see app/js/api/adminApi.js
router.post('/admin/vendors/:vendorId/destinations', requireActor, async (req, res) => {
  const { vendorId } = req.params;
  try {
    const sheet = await withTransaction(async (db) => {
      vendorById(db, vendorId);
      const sheet = db.rateSheets[vendorId];
      const { destination, baseRates } = req.body || {};
      if (!destination?.trim()) {
        const err = new Error('Destination name is required.');
        err.status = 422;
        throw err;
      }
      if (!Array.isArray(baseRates) || baseRates.length !== sheet.cols.length) {
        const err = new Error(`Provide a base rate for each of the ${sheet.cols.length} vehicle type(s).`);
        err.status = 422;
        throw err;
      }
      if (sheet.rows.some((r) => r[0].toLowerCase() === destination.trim().toLowerCase())) {
        const err = new Error(`"${destination.trim()}" already exists on this rate sheet.`);
        err.status = 409;
        throw err;
      }
      sheet.rows.push([destination.trim(), ...baseRates.map((r) => (r === '' || r == null ? null : Number(r)))]);
      logAudit(db, 'destination_added', req.actor, { vendorId, destination: destination.trim() });
      return sheet;
    });
    res.json(sheet);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// PATCH /admin/vendors/:vendorId/destinations — see app/js/api/adminApi.js
// Updates the base rates for a destination that already exists on the
// sheet (matched by name, case-insensitively) — how a maintainer actually
// fills in rates for a vendor whose destinations exist but have no
// numbers yet, since POST .../destinations rejects a name that's already
// there.
router.patch('/admin/vendors/:vendorId/destinations', requireActor, async (req, res) => {
  const { vendorId } = req.params;
  try {
    const sheet = await withTransaction(async (db) => {
      vendorById(db, vendorId);
      const sheet = db.rateSheets[vendorId];
      const { destination, baseRates } = req.body || {};
      if (!destination?.trim()) {
        const err = new Error('Destination name is required.');
        err.status = 422;
        throw err;
      }
      if (!Array.isArray(baseRates) || baseRates.length !== sheet.cols.length) {
        const err = new Error(`Provide a base rate for each of the ${sheet.cols.length} vehicle type(s).`);
        err.status = 422;
        throw err;
      }
      const row = sheet.rows.find((r) => r[0].toLowerCase() === destination.trim().toLowerCase());
      if (!row) {
        const err = new Error(`"${destination.trim()}" was not found on this rate sheet.`);
        err.status = 404;
        throw err;
      }
      const before = row.slice(1);
      const after = baseRates.map((r) => (r === '' || r == null ? null : Number(r)));
      after.forEach((v, i) => { row[i + 1] = v; });
      logAudit(db, 'destination_rate_updated', req.actor, { vendorId, destination: row[0], before, after });
      return sheet;
    });
    res.json(sheet);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

module.exports = router;
