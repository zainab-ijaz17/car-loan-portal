const express = require('express');
const { verifyEmployeeCredentials } = require('../sfClient');
const { assignmentFor } = require('../roles');

const router = express.Router();

// POST /api/sap/login — the only backend-proxied call in this app; every
// other api/*.js module talks to SAP directly with the user's own Basic
// Auth credentials, but login needs to reach SuccessFactors with a
// synthesized username (see sfClient.js), which can only live server-side.
router.post('/login', async (req, res) => {
  const { employeeId, password } = req.body || {};
  if (!employeeId || !password) {
    return res.status(400).json({ message: 'Employee ID and password are required.' });
  }

  let valid;
  try {
    valid = await verifyEmployeeCredentials(employeeId, password);
  } catch (err) {
    console.error('SF login error:', err.message);
    return res.status(502).json({ message: 'Could not reach SAP SuccessFactors. Try again in a moment.' });
  }

  if (!valid) {
    return res.status(401).json({ message: 'Invalid employee ID or password.' });
  }

  // SuccessFactors' login check has no display-name or role field, so both
  // come from the roster in roles.js instead. `roles` is usually a single
  // value; screens/login.js prompts for a choice when there's more than one.
  const { name, roles } = assignmentFor(employeeId);
  res.json({ employeeId, name, roles });
});

module.exports = router;
