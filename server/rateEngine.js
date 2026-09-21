// Pure calculation/lookup logic shared by the routes in server/routes/.
// Ported from the old app/js/api/mock/mockServer.js so the real backend
// behaves exactly like the mock did — same formulas, same shapes — just
// reading/writing a persisted `db` (server/store.js) instead of an
// in-browser object that reset on reload.

function notFound(message) {
  const err = new Error(message);
  err.status = 404;
  return err;
}

function vendorById(db, id) {
  const v = db.vendors.find((v) => v.id === id);
  if (!v) throw notFound(`Unknown vendor "${id}".`);
  return v;
}

// 0 for a vendor whose pricing_model isn't 'lane' (category / dedicated
// vehicle) — those have no rate_sheets row at all.
function rateLineCount(db, vendorId) {
  const sheet = db.rateSheets[vendorId];
  if (!sheet) return 0;
  return sheet.rows.length * sheet.cols.length;
}

// Rounding is a per-agreement, maintainer-configured field (Section 5) —
// never hardcoded to one rule for every vendor.
function roundByRule(value, rule) {
  if (rule === 'Nearest 100') return Math.round(value / 100) * 100;
  if (rule === 'Nearest 50') return Math.round(value / 50) * 50;
  return Math.round(value); // 'None' — no bucket rounding, just whole rupees
}

// Computes one vendor's before/after worksheet for a candidate diesel
// price, per the Section 6 formula:
//   adjustedRate = baseRate * (1 + upliftPct/100)      — unrounded
//   publishedRate = ROUND(adjustedRate, roundingRule)  — rounded once, at the end
// A line with no base rate on file (base == null — never priced before)
// can't go through that formula at all; `overrides` lets the maintainer
// supply that line's rate directly instead. Once submitted and approved,
// it's written back to rate_sheets as an ordinary rate, so it becomes the
// base rate the *next* revision projects an increase from — this is how a
// vendor's rates get entered for the first time, through the same
// simulate/submit/approve flow as any other revision, not a separate
// "master data" step.
// `rowOverrides`: { [rowIndex]: { [colIndex]: number } }
function computeWorksheet(db, v, upliftPct, rowOverrides) {
  const sheet = db.rateSheets[v.id];
  const rows = sheet.rows.map((row, i) => {
    const base = row.slice(1);
    const overridesForRow = rowOverrides?.[i] || {};
    const sum = base.map((b) => (b == null ? null : b * (1 + upliftPct / 100))); // adjusted rate, unrounded
    const inc = sum.map((s, j) => (s == null ? null : s - base[j])); // for display only
    const rounded = sum.map((s, j) => {
      if (s != null) return roundByRule(s, v.roundingRule);
      const override = overridesForRow[j];
      return override === '' || override == null ? null : Number(override);
    });
    const bal = rounded.map((r) => (r == null ? null : 0));
    return { no: i + 1, dest: row[0], base, inc, sum, rounded, bal };
  });
  const blocked = rows.some((r) => r.bal.some((b) => b == null));
  return { title: sheet.title, annexure: sheet.annexure, cols: sheet.cols, weights: sheet.weights, rows, blocked };
}

function buildSimulation(db, { dieselPrice, effectiveDate, vendorIds, overrides }) {
  const previous = db.revisions[db.currentRevisionNo];
  const overallUpliftPct = ((dieselPrice - previous.dieselPrice) / previous.dieselPrice) * 100;

  const vendors = vendorIds.map((id) => {
    const v = vendorById(db, id);
    const upliftPct = overallUpliftPct * (v.passThroughPct / 100);
    return { id: v.id, name: v.name, upliftPct, upliftBasis: `${v.passThroughPct.toFixed(2)}% pass-through of ${overallUpliftPct.toFixed(2)}%` };
  });

  const worksheets = {};
  vendors.forEach((v) => { worksheets[v.id] = computeWorksheet(db, vendorById(db, v.id), v.upliftPct, overrides?.[v.id]); });

  const blocked = Object.values(worksheets).some((w) => w.blocked);
  const rateLineTotal = vendorIds.reduce((sum, id) => sum + rateLineCount(db, id), 0);
  const totalIncreasePkr = Object.values(worksheets).reduce(
    (sum, w) => sum + w.rows.reduce((rowSum, r) => rowSum + r.inc.reduce((a, v) => a + (v ?? 0), 0), 0),
    0
  );

  return {
    revisionNo: db.currentRevisionNo + 1,
    effectiveDate,
    overallUpliftPct,
    vendors: vendors.map((v) => ({ ...v, blocked: worksheets[v.id].blocked })),
    worksheets,
    totals: { vendorCount: vendorIds.length, rateLineCount: rateLineTotal, totalIncreasePkr },
    blocked,
  };
}

function parseDMY(ddmmyyyy) {
  const [d, m, y] = ddmmyyyy.split('.').map(Number);
  return new Date(y, m - 1, d);
}

function subtractOneDay(ddmmyyyy) {
  const [d, m, y] = ddmmyyyy.split('.').map(Number);
  const date = new Date(y, m - 1, d - 1);
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
}

// The revision in effect on `dateStr` (DD.MM.YYYY), or the current revision
// if no date is given. Returns null if the date predates every known revision.
function revisionCoveringDate(db, dateStr) {
  const revNos = Object.keys(db.revisions).map(Number).sort((a, b) => b - a);
  if (!dateStr) return revNos[0];
  const target = parseDMY(dateStr);
  const covering = revNos.find((revNo) => parseDMY(db.revisions[revNo].effectiveDate) <= target);
  return covering ?? null;
}

// This vendor/destination/column's rate as it stood at `revNo`: the exact
// archived figure if this revision has an rateSnapshots entry (every
// revision approved through this app gets one), else the scalar-factor
// approximation against today's master rate (only true for the two
// pre-existing revisions seeded with no snapshot — see seedData.js).
function rateAtRevision(db, vendorId, destName, colIndex, revNo) {
  const snapshotRow = db.rateSnapshots[vendorId]?.[revNo]?.rows?.find((r) => r[0] === destName);
  if (snapshotRow) return snapshotRow[colIndex + 1];
  const currentRow = db.rateSheets[vendorId].rows.find((r) => r[0] === destName);
  const currentRate = currentRow[colIndex + 1];
  return currentRate == null ? null : roundByRule(currentRate * db.revisions[revNo].factor, 'Nearest 100');
}

function today() {
  return new Date().toISOString().slice(0, 10).split('-').reverse().join('.');
}

module.exports = {
  vendorById,
  rateLineCount,
  roundByRule,
  computeWorksheet,
  buildSimulation,
  parseDMY,
  subtractOneDay,
  revisionCoveringDate,
  rateAtRevision,
  today,
};
