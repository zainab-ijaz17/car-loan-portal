const express = require('express');
const { withDb } = require('../store');
const { requireActor } = require('../middleware/auth');
const {
  vendorById, revisionCoveringDate, rateAtRevision, subtractOneDay, roundByRule,
} = require('../rateEngine');

const router = express.Router();

// GET /rates/lookup?vendorId=&destination=&vehicleType=&date= — see app/js/api/rateLookupApi.js
router.get('/rates/lookup', requireActor, async (req, res) => {
  const { date, vendorId, destination, vehicleType } = req.query;

  const result = await withDb(async (db) => {
    let v;
    try {
      v = vendorById(db, vendorId);
    } catch {
      return null;
    }
    const sheet = db.rateSheets[vendorId];
    const colIndex = sheet.cols.indexOf(vehicleType);
    const row = sheet.rows.find((r) => r[0].toLowerCase().includes((destination || '').trim().toLowerCase()));
    if (!row || colIndex === -1) return null;
    const destName = row[0];

    const revNo = revisionCoveringDate(db, date);
    if (revNo == null) return null; // date predates every known revision

    const rate = rateAtRevision(db, vendorId, destName, colIndex, revNo);
    if (rate == null) return null;

    const revNos = Object.keys(db.revisions).map(Number).sort((a, b) => b - a);
    const nextRevNo = revNos[revNos.indexOf(revNo) - 1];
    const rev = db.revisions[revNo];
    return {
      rate,
      vendorName: v.name,
      destination: destName,
      vehicleType,
      annexure: sheet.annexure,
      revisionNo: revNo,
      validFrom: rev.effectiveDate,
      validTo: nextRevNo ? subtractOneDay(db.revisions[nextRevNo].effectiveDate) : 'current',
      approvedBy: rev.approvedBy,
      approvedOn: rev.approvedOn,
    };
  });

  res.json(result);
});

// GET /rates/history?vendorId=&destination=&vehicleType= — see app/js/api/rateLookupApi.js
router.get('/rates/history', requireActor, async (req, res) => {
  const { vendorId, destination, vehicleType } = req.query;

  const history = await withDb(async (db) => {
    const sheet = db.rateSheets[vendorId];
    if (!sheet) return [];
    const colIndex = sheet.cols.indexOf(vehicleType);
    const row = sheet.rows.find((r) => r[0].toLowerCase().includes((destination || '').trim().toLowerCase()));
    if (!row || colIndex === -1) return [];
    const destName = row[0];

    const revNos = Object.keys(db.revisions).map(Number).sort((a, b) => b - a);
    return revNos
      .map((revNo, i) => {
        const rev = db.revisions[revNo];
        const nextRev = db.revisions[revNos[i - 1]];
        return {
          revisionNo: revNo,
          dieselPrice: rev.dieselPrice,
          rate: rateAtRevision(db, vendorId, destName, colIndex, revNo),
          validFrom: rev.effectiveDate,
          validTo: nextRev ? subtractOneDay(nextRev.effectiveDate) : 'current',
        };
      })
      .filter((h) => h.rate != null);
  });

  res.json(history);
});

// GET /vendors/:vendorId/vehicle-types — see app/js/api/rateLookupApi.js
router.get('/vendors/:vendorId/vehicle-types', requireActor, async (req, res) => {
  try {
    const cols = await withDb(async (db) => {
      const sheet = db.rateSheets[req.params.vendorId];
      if (!sheet) {
        const err = new Error(`Unknown vendor "${req.params.vendorId}".`);
        err.status = 404;
        throw err;
      }
      return sheet.cols;
    });
    res.json(cols);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

// GET /revisions/options — see app/js/api/rateLookupApi.js
router.get('/revisions/options', requireActor, async (req, res) => {
  const options = await withDb(async (db) => Object.keys(db.revisions).map(Number).sort((a, b) => b - a));
  res.json(options);
});

// GET /vendors/:vendorId/annexure?revisionNo= — see app/js/api/rateLookupApi.js
router.get('/vendors/:vendorId/annexure', requireActor, async (req, res) => {
  const { vendorId } = req.params;
  const revisionNo = Number(req.query.revisionNo);

  try {
    const result = await withDb(async (db) => {
      const v = vendorById(db, vendorId);
      const sheet = db.rateSheets[vendorId];
      const rev = db.revisions[revisionNo];
      if (!rev) {
        const err = new Error(`Unknown revision ${revisionNo}.`);
        err.status = 404;
        throw err;
      }

      const snapshotEntry = db.rateSnapshots[vendorId]?.[revisionNo];
      const snapshot = snapshotEntry?.rows;
      const auditRows = snapshotEntry?.auditRows;
      const rows = (snapshot || sheet.rows).map((row, i) => ({
        no: i + 1,
        dest: row[0],
        cells: row.slice(1).map((val) => (val == null ? null : snapshot ? val : roundByRule(val * rev.factor, 'Nearest 100'))),
        // Section 6's audit requirement: the base rate and unrounded
        // adjusted rate a published cell was computed from, where known
        // (every revision approved through this app has it; the two
        // pre-existing seed revisions only have the scalar approximation
        // above, so there's nothing to trace for those).
        audit: auditRows?.[i] ? { base: auditRows[i].base, unrounded: auditRows[i].sum } : null,
      }));

      return {
        title: sheet.title,
        annexure: sheet.annexure,
        cols: sheet.cols,
        vendorName: v.name,
        revisionNo,
        dieselPrice: rev.dieselPrice,
        effectiveDate: rev.effectiveDate,
        approvedBy: rev.approvedBy,
        approvedOn: rev.approvedOn,
        rows,
      };
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message });
  }
});

module.exports = router;
