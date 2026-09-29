// In-app notifications for the bell in the top bar — see
// app/js/components/alerts.js. Role-wide notifications are shown for the
// role this session signed in with.
const express = require('express');
const { pool } = require('../db');
const { requireActor } = require('../middleware/auth');
const { fail, handle } = require('../errors');

const router = express.Router();

function audience(req) {
  return { employeeId: req.actor.employeeId, role: req.actor.role };
}

const VISIBLE = `(recipient_employee_id = $1 OR (recipient_role = $2 AND actor_employee_id IS DISTINCT FROM $1))`;

// GET /alerts
router.get('/alerts', requireActor, handle('loading notifications', async (req, res) => {
  const { employeeId, role } = audience(req);
  const { rows } = await pool.query(
    `SELECT *, read_by ? $1 AS is_read FROM alerts WHERE ${VISIBLE} ORDER BY created_at DESC, id DESC LIMIT 50`,
    [employeeId, role]
  );
  res.json({
    unreadCount: rows.filter((r) => !r.is_read).length,
    items: rows.map((r) => ({
      id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link,
      createdAt: r.created_at.toISOString(), read: r.is_read,
    })),
  });
}));

// POST /alerts/:id/read
router.post('/alerts/:id/read', requireActor, handle('marking the notification as read', async (req, res) => {
  const { employeeId, role } = audience(req);
  const { rowCount } = await pool.query(
    `UPDATE alerts SET read_by = CASE WHEN read_by ? $1 THEN read_by ELSE read_by || to_jsonb($1::text) END WHERE id = $3 AND ${VISIBLE}`,
    [employeeId, role, Number(req.params.id)]
  );
  if (!rowCount) throw fail('ALR-001', 'That notification no longer exists.', { status: 404 });
  res.json({ ok: true });
}));

// POST /alerts/read-all
router.post('/alerts/read-all', requireActor, handle('marking notifications as read', async (req, res) => {
  const { employeeId, role } = audience(req);
  await pool.query(
    `UPDATE alerts SET read_by = read_by || to_jsonb($1::text) WHERE ${VISIBLE} AND NOT (read_by ? $1)`,
    [employeeId, role]
  );
  res.json({ ok: true });
}));

module.exports = router;
