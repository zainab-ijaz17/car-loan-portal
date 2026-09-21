const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { requireActor } = require('../middleware/auth');

const router = express.Router();
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
// multer's diskStorage doesn't create its destination — needed here since
// deployment bits (see .cfignore) don't ship an empty uploads/ directory.
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    cb(null, `notif-${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname)}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['.pdf', '.jpg', '.jpeg', '.png'].includes(path.extname(file.originalname).toLowerCase());
    cb(ok ? null : new Error('Only PDF, JPG or PNG files are accepted.'), ok);
  },
});

// POST /notifications — the diesel-price notification attachment (Section
// 5: mandatory). Uploaded independently of the revision it'll end up
// attached to, since the file has to exist before Screen 1's draft is
// even started — see app/js/api/notificationsApi.js.
router.post('/notifications', requireActor, (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(422).json({ message: err.message });
    if (!req.file) return res.status(422).json({ message: 'No file was attached.' });
    try {
      const result = await pool.query(
        'INSERT INTO notifications (original_name, stored_name, uploaded_by) VALUES ($1,$2,$3) RETURNING id',
        [req.file.originalname, req.file.filename, JSON.stringify(req.actor)]
      );
      res.json({ id: result.rows[0].id, originalName: req.file.originalname });
    } catch (dbErr) {
      res.status(500).json({ message: dbErr.message });
    }
  });
});

// GET /notifications/:id — downloads the original file.
router.get('/notifications/:id', requireActor, async (req, res) => {
  const result = await pool.query('SELECT original_name, stored_name FROM notifications WHERE id = $1', [req.params.id]);
  const row = result.rows[0];
  if (!row) return res.status(404).json({ message: 'Notification not found.' });
  res.download(path.join(UPLOAD_DIR, row.stored_name), row.original_name);
});

module.exports = router;
