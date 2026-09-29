// Every screen below login sends the session's Basic Auth header on each
// call (see app/js/api/client.js) the same way a real SAP passthrough
// endpoint would expect. This app's own data (vendors/rates/revisions) only
// needs to know *who* is calling for the audit log — the password itself is
// only re-checked against SAP at the one place it actually matters
// (approveAndRelease's re-auth, in routes/revisions.js).
const { assignmentFor, hasAssignedRole } = require('../roles');
const { fail, sendError } = require('../errors');

function requireActor(req, res, next) {
  const header = req.headers.authorization;
  const decoded = header?.startsWith('Basic ') ? Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8') : '';
  const sep = decoded.indexOf(':');
  const employeeId = sep === -1 ? decoded : decoded.slice(0, sep);
  if (!employeeId) {
    return sendError(res, fail('AUTH-001', 'Sign in required. Your session may have ended — sign in again.', { status: 401 }));
  }
  req.actor = { employeeId, name: assignmentFor(employeeId).name };
  next();
}

// Checked against the roster in roles.js, not the role the client says it
// picked — so a request can't be raised or approved just by calling the
// API directly with a different role.
function requireRole(role) {
  return (req, res, next) => {
    if (!hasAssignedRole(req.actor.employeeId, role)) {
      return sendError(res, fail('AUTH-005', `This action needs the ${role} role, which your account does not have.`, { status: 403 }));
    }
    next();
  };
}

module.exports = { requireActor, requireRole };
