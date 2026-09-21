const express = require('express');
const { withDb } = require('../store');
const { rateLineCount } = require('../rateEngine');
const { requireActor } = require('../middleware/auth');

const router = express.Router();

// GET /vendors and GET /vendors?fields=id,name — see app/js/api/vendorsApi.js
router.get('/vendors', requireActor, async (req, res) => {
  const result = await withDb(async (db) => {
    if (req.query.fields === 'id,name') {
      return db.vendors.map((v) => ({ id: v.id, name: v.name }));
    }
    const rev = db.revisions[db.currentRevisionNo];
    return db.vendors.map((v) => ({
      ...v,
      rateLineCount: rateLineCount(db, v.id),
      lastRevisedDate: rev.effectiveDate,
    }));
  });
  res.json(result);
});

module.exports = router;
