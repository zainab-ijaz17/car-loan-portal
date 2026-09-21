// Postgres-backed persistence for the portal's own data (vendors, rate
// sheets, revisions, workflow state, audit log). Routes work against the
// same plain-object shape the app has always used — { vendors, rateSheets,
// revisions, currentRevisionNo, pendingRevision, rateSnapshots, auditLog }
// — loadDb/saveDb just translate that to/from real tables, so
// rateEngine.js's calculation logic didn't need to change at all.
const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

async function ensureSchema() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
}

async function seedIfEmpty(seed) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM vendors');
  if (rows[0].count > 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await saveDb(client, seed);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Read-only access: hands the caller the current state, no locking.
async function withDb(fn) {
  const client = await pool.connect();
  try {
    const db = await loadDb(client);
    return await fn(db, client);
  } finally {
    client.release();
  }
}

// Read-modify-write access for anything that mutates state. Wrapped in a
// real transaction with an advisory lock held for its duration — since
// nearly every mutation touches app_state (current_revision_no /
// pending_revision) anyway, this serializes all writes against each
// other, closing the race window the old JSON-file store had between
// reading and writing. `fn` mutates the `db` object in place (or returns
// a response value); the resulting state is always what gets saved.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(727271)');
    const db = await loadDb(client);
    const result = await fn(db, client);
    await saveDb(client, db);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function loadDb(client) {
  // Sequential, not Promise.all: a single pg client can only have one
  // query in flight at a time — running these concurrently on the same
  // client only appeared to work by accident (silently serialized, with a
  // deprecation warning that becomes a hard error in a future pg version).
  const vendorsRes = await client.query('SELECT * FROM vendors ORDER BY id');
  const sheetsRes = await client.query('SELECT * FROM rate_sheets');
  const revisionsRes = await client.query('SELECT * FROM revisions');
  const snapshotsRes = await client.query('SELECT * FROM rate_snapshots');
  const stateRes = await client.query('SELECT * FROM app_state');
  const auditRes = await client.query('SELECT * FROM audit_log ORDER BY at DESC, id DESC');

  const vendors = vendorsRes.rows.map((v) => ({
    id: v.id,
    name: v.name,
    annexure: v.annexure,
    passThroughPct: Number(v.pass_through_pct),
    roundingRule: v.rounding_rule,
    stale: v.stale,
    validityStart: v.validity_start,
    validityEnd: v.validity_end,
  }));

  const rateSheets = {};
  sheetsRes.rows.forEach((s) => {
    rateSheets[s.vendor_id] = { title: s.title, annexure: s.annexure, cols: s.cols, weights: s.weights, rows: s.rows };
  });

  const revisions = {};
  revisionsRes.rows.forEach((r) => {
    revisions[r.revision_no] = {
      dieselPrice: Number(r.diesel_price),
      effectiveDate: r.effective_date,
      factor: Number(r.factor),
      approvedBy: r.approved_by,
      approvedOn: r.approved_on,
      notificationId: r.notification_id,
    };
  });

  const rateSnapshots = {};
  snapshotsRes.rows.forEach((s) => {
    rateSnapshots[s.vendor_id] = rateSnapshots[s.vendor_id] || {};
    rateSnapshots[s.vendor_id][s.revision_no] = { rows: s.rows, auditRows: s.audit_rows };
  });

  const state = {};
  stateRes.rows.forEach((r) => { state[r.key] = r.value; });

  const auditLog = auditRes.rows.map((a) => ({
    action: a.action,
    actor: a.actor,
    at: a.at.toISOString(),
    details: a.details,
  }));

  return {
    vendors,
    rateSheets,
    revisions,
    currentRevisionNo: state.current_revision_no ?? null,
    pendingRevision: state.pending_revision ?? null,
    rateSnapshots,
    auditLog,
  };
}

// Wipes and re-inserts every table from `db` — the same "rewrite the whole
// blob" approach the old JSON file used, just now inside a real
// transaction. Fine at this app's data volume (a handful of vendors, tens
// of revisions).
async function saveDb(client, db) {
  await client.query('DELETE FROM vendors');
  await client.query('DELETE FROM rate_sheets');
  await client.query('DELETE FROM revisions');
  await client.query('DELETE FROM rate_snapshots');
  await client.query('DELETE FROM app_state');
  await client.query('DELETE FROM audit_log');

  for (const v of db.vendors) {
    await client.query(
      'INSERT INTO vendors (id, name, annexure, pass_through_pct, rounding_rule, stale, validity_start, validity_end) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [v.id, v.name, v.annexure, v.passThroughPct, v.roundingRule, v.stale, v.validityStart ?? null, v.validityEnd ?? null]
    );
  }
  for (const [vendorId, sheet] of Object.entries(db.rateSheets)) {
    await client.query(
      'INSERT INTO rate_sheets (vendor_id, title, annexure, cols, weights, rows) VALUES ($1,$2,$3,$4,$5,$6)',
      [vendorId, sheet.title, sheet.annexure, JSON.stringify(sheet.cols), JSON.stringify(sheet.weights), JSON.stringify(sheet.rows)]
    );
  }
  for (const [revNo, rev] of Object.entries(db.revisions)) {
    await client.query(
      'INSERT INTO revisions (revision_no, diesel_price, effective_date, factor, approved_by, approved_on, notification_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [Number(revNo), rev.dieselPrice, rev.effectiveDate, rev.factor, rev.approvedBy, rev.approvedOn, rev.notificationId ?? null]
    );
  }
  for (const [vendorId, byRev] of Object.entries(db.rateSnapshots)) {
    for (const [revNo, snap] of Object.entries(byRev)) {
      await client.query(
        'INSERT INTO rate_snapshots (vendor_id, revision_no, rows, audit_rows) VALUES ($1,$2,$3,$4)',
        [vendorId, Number(revNo), JSON.stringify(snap.rows), snap.auditRows ? JSON.stringify(snap.auditRows) : null]
      );
    }
  }
  await client.query('INSERT INTO app_state (key, value) VALUES ($1,$2)', ['current_revision_no', JSON.stringify(db.currentRevisionNo)]);
  await client.query('INSERT INTO app_state (key, value) VALUES ($1,$2)', ['pending_revision', JSON.stringify(db.pendingRevision)]);

  const oldestFirst = [...db.auditLog].reverse();
  for (const entry of oldestFirst) {
    await client.query(
      'INSERT INTO audit_log (action, actor, at, details) VALUES ($1,$2,$3,$4)',
      [entry.action, JSON.stringify(entry.actor), entry.at, JSON.stringify(entry.details)]
    );
  }
}

module.exports = { ensureSchema, seedIfEmpty, withDb, withTransaction };
