const express = require('express');
const { verifyEmployeeCredentials } = require('../sfClient');
const { assignmentFor } = require('../roles');
const { createSession, setActiveRole, endSession } = require('../sessions');
const { requireActor } = require('../middleware/auth');
const { fail, sendError, handle } = require('../errors');

const router = express.Router();

// POST /api/sap/login — checks the employee ID / password against SAP
// SuccessFactors (with a synthesized username, see sfClient.js, which is
// why this can only live server-side) and, if valid, opens a session. The
// browser gets a token back and sends that — not the password — on every
// later call.
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
  try {
    const { token, activeRole } = await createSession({ employeeId, name, roles });
    res.json({ token, employeeId, name, roles, activeRole });
  } catch (err) {
    sendError(res, err, 'starting your session');
  }
});

// POST /api/sap/session/role  { role } — for accounts with more than one
// role, fixes the role for this session. Allowed once per session.
router.post('/session/role', requireActor, handle('setting your role', async (req, res) => {
  const role = req.body?.role;
  if (!assignmentFor(req.actor.employeeId).roles.includes(role)) {
    throw fail('AUTH-005', `Your account does not have the ${role} role.`, { status: 403 });
  }
  if (!(await setActiveRole(req.token, role))) {
    throw fail('AUTH-007', 'A role has already been chosen for this session. Log out and sign in again to use a different role.', { status: 409 });
  }
  res.json({ role });
}));

// POST /api/sap/logout
router.post('/logout', requireActor, handle('signing out', async (req, res) => {
  await endSession(req.token);
  res.json({ ok: true });
}));

module.exports = router;
