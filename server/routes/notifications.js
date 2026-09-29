const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { requireActor, requireRole } = require('../middleware/auth');
const { fail, sendError, handle } = require('../errors');

const router = express.Router();
// Only for files uploaded before notifications moved into the database.
const LEGACY_UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

const TYPES = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

// Held in memory just long enough to write into Postgres — the app's own
// disk doesn't survive a Cloud Foundry restart.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = path.extname(file.originalname).toLowerCase() in TYPES;
    cb(ok ? null : fail('UPL-001', `"${file.originalname}" is not a PDF, JPG or PNG file. Attach the notification in one of those formats.`, { field: 'Attach notification' }), ok);
  },
});

// Checks the file really is what its extension says (first bytes), so a
// renamed file of another kind is refused.
function looksLike(buffer, ext) {
  const head = buffer.subarray(0, 8);
  if (ext === '.pdf') return head.subarray(0, 5).toString('latin1') === '%PDF-';
  if (ext === '.png') return head.equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff; // JPEG
}

// POST /notifications — the diesel-price notification attachment (Section
// 5: mandatory). Uploaded independently of the revision it'll end up
// attached to, since the file has to exist before the diesel price draft is
// even started — see app/js/api/notificationsApi.js.
router.post('/notifications', requireActor, requireRole('Rate Maintainer'), (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return sendError(res, fail('UPL-003', 'The file is larger than 10 MB. Attach a smaller copy of the notification.', { field: 'Attach notification' }));
    if (err) return sendError(res, err, 'uploading the notification');
    if (!req.file) return sendError(res, fail('UPL-002', 'No file was received. Choose the notification file again.', { field: 'Attach notification' }));
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!looksLike(req.file.buffer, ext)) {
      return sendError(res, fail('UPL-001', `"${req.file.originalname}" is not a valid ${ext.slice(1).toUpperCase()} file. Attach the original notification.`, { field: 'Attach notification' }));
    }
    try {
      const result = await pool.query(
        'INSERT INTO notifications (original_name, content, mime_type, uploaded_by) VALUES ($1,$2,$3,$4) RETURNING id',
        [req.file.originalname, req.file.buffer, TYPES[ext], JSON.stringify(req.actor)]
      );
      res.json({ id: result.rows[0].id, originalName: req.file.originalname });
    } catch (dbErr) {
      sendError(res, dbErr, 'saving the uploaded notification');
    }
  });
});

// GET /notifications/:id — downloads the original file.
router.get('/notifications/:id', requireActor, requireRole('Rate Maintainer', 'Approver'), handle('downloading the notification', async (req, res) => {
  const result = await pool.query('SELECT original_name, stored_name, content, mime_type FROM notifications WHERE id = $1', [Number(req.params.id)]);
  const row = result.rows[0];
  if (!row) throw fail('UPL-004', 'That notification file was not found on the server.', { status: 404 });
  if (row.content) {
    res.set('Content-Type', row.mime_type || 'application/octet-stream');
    res.attachment(row.original_name);
    return res.send(row.content);
  }
  const legacyPath = row.stored_name && path.join(LEGACY_UPLOAD_DIR, row.stored_name);
  if (!legacyPath || !fs.existsSync(legacyPath)) {
    throw fail('UPL-004', 'This notification was uploaded before files were kept in the database, and the file is no longer on the server. Ask the maintainer for a copy.', { status: 404 });
  }
  res.download(legacyPath, row.original_name);
}));

module.exports = router;
