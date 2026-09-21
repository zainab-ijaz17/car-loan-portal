const express = require('express');
const { withDb } = require('../store');
const { requireActor } = require('../middleware/auth');

const router = express.Router();

// GET /diesel-price/current — see app/js/api/dieselApi.js
router.get('/diesel-price/current', requireActor, async (req, res) => {
  const result = await withDb(async (db) => {
    const rev = db.revisions[db.currentRevisionNo];
    return {
      price: rev.dieselPrice,
      effectiveDate: rev.effectiveDate,
      fuelType: 'High Speed Diesel',
      source: 'PSO',
      revisionNo: db.currentRevisionNo,
    };
  });
  res.json(result);
});

module.exports = router;
