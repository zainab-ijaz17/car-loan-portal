// Server-side login sessions (see the sessions table in schema.sql). The
// browser only ever holds a random token; the password is checked against
// SuccessFactors once, at login, and never stored or resent.
const crypto = require('crypto');
const { pool } = require('./db');

const IDLE_MINUTES = 60; // signed out after an hour with no activity
const MAX_HOURS = 10;    // and after a working day regardless

function hash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function createSession({ employeeId, name, roles }) {
  const token = crypto.randomBytes(32).toString('base64url');
  // Only a single-role account starts with its role set; anyone with more
  // than one picks it once, right after login (setActiveRole).
  const activeRole = roles.length === 1 ? roles[0] : null;
  await pool.query('DELETE FROM sessions WHERE expires_at < now() OR last_seen_at < now() - make_interval(mins => $1)', [IDLE_MINUTES]);
  await pool.query(
    'INSERT INTO sessions (token_hash, employee_id, name, roles, active_role, expires_at) VALUES ($1,$2,$3,$4,$5, now() + make_interval(hours => $6))',
    [hash(token), employeeId, name, JSON.stringify(roles), activeRole, MAX_HOURS]
  );
  return { token, activeRole };
}

// The live session for `token` (touching its idle timer), or null.
async function findSession(token) {
  const { rows } = await pool.query(
    'UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1 AND expires_at > now() AND last_seen_at > now() - make_interval(mins => $2) RETURNING *',
    [hash(token), IDLE_MINUTES]
  );
  return rows[0] || null;
}

// Set once per session: switching role mid-session isn't allowed, so the
// same sitting can't be used to both raise and approve something.
async function setActiveRole(token, role) {
  const { rowCount } = await pool.query('UPDATE sessions SET active_role = $2 WHERE token_hash = $1 AND active_role IS NULL', [hash(token), role]);
  return rowCount === 1;
}

async function endSession(token) {
  await pool.query('DELETE FROM sessions WHERE token_hash = $1', [hash(token)]);
}

module.exports = { createSession, findSession, setActiveRole, endSession };
