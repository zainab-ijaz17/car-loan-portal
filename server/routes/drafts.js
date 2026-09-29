// The signed-in maintainer's own in-progress revision (see the
// revision_drafts table in schema.sql and app/js/revisionDraft.js). One
// draft per person; POST /revisions removes it once submitted.
const express = require('express');
const { pool } = require('../db');
const { requireActor, requireRole } = require('../middleware/auth');
const { fail, handle } = require('../errors');

const router = express.Router();
const maintainer = [requireActor, requireRole('Rate Maintainer')];

// GET /revisions/draft → { data, savedAt } | null
router.get('/revisions/draft', ...maintainer, handle('loading your draft', async (req, res) => {
  const { rows } = await pool.query('SELECT data, updated_at FROM revision_drafts WHERE employee_id = $1', [req.actor.employeeId]);
  res.json(rows[0] ? { data: rows[0].data, savedAt: rows[0].updated_at.toISOString() } : null);
}));

// PUT /revisions/draft  { data } → { savedAt }
router.put('/revisions/draft', ...maintainer, handle('saving your draft', async (req, res) => {
  const data = req.body?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw fail('DSL-005', 'The draft could not be saved because it was empty or malformed. Re-enter the details and save again.');
  }
  const { rows } = await pool.query(
    `INSERT INTO revision_drafts (employee_id, data, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (employee_id) DO UPDATE SET data = EXCLUDED.data, updated_at = now() RETURNING updated_at`,
    [req.actor.employeeId, JSON.stringify(data)]
  );
  res.json({ savedAt: rows[0].updated_at.toISOString() });
}));

// DELETE /revisions/draft
router.delete('/revisions/draft', ...maintainer, handle('discarding your draft', async (req, res) => {
  await pool.query('DELETE FROM revision_drafts WHERE employee_id = $1', [req.actor.employeeId]);
  res.json({ ok: true });
}));

module.exports = router;
