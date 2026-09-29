const express = require('express');
const { verifyEmployeeCredentials } = require('../sfClient');
const { assignmentFor } = require('../roles');
const { fail, sendError } = require('../errors');

const router = express.Router();

// POST /api/sap/login — the only backend-proxied call in this app; every
// other api/*.js module talks to SAP directly with the user's own Basic
// Auth credentials, but login needs to reach SuccessFactors with a
// synthesized username (see sfClient.js), which can only live server-side.
router.post('/login', async (req, res) => {
  const { employeeId, password } = req.body || {};
  if (!employeeId || !password) {
    return sendError(res, fail('AUTH-002', 'Enter both your employee ID and password.', { status: 400 }));
  }

  let valid;
  try {
    valid = await verifyEmployeeCredentials(employeeId, password);
  } catch (err) {
    console.error('SF login error:', err.message);
    return sendError(res, fail('AUTH-004', 'Could not reach SAP SuccessFactors to check your login. Try again in a moment.', { status: 502 }));
  }

  if (!valid) {
    return sendError(res, fail('AUTH-003', 'The employee ID or password is incorrect.', { status: 401 }));
  }

  // SuccessFactors' login check has no display-name or role field, so both
  // come from the roster in roles.js instead. `roles` is usually a single
  // value; screens/login.js prompts for a choice when there's more than one.
  const { name, roles } = assignmentFor(employeeId);
  res.json({ employeeId, name, roles });
});

module.exports = router;
