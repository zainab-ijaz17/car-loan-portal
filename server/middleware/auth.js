// Every call below login sends `Authorization: Bearer <token>` — the
// session token issued by POST /login (see server/sessions.js). Nothing
// the browser says about who it is or which role it has is trusted: both
// come from the session row, and the role is re-checked against the
// roster (roles.js) on every request so removing someone's role takes
// effect immediately rather than at their next login.
const { assignmentFor } = require('../roles');
const { findSession } = require('../sessions');
const { fail, sendError } = require('../errors');

async function requireActor(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) {
    return sendError(res, fail('AUTH-001', 'Sign in required.', { status: 401 }));
  }
  let session;
  try {
    session = await findSession(token);
  } catch (err) {
    return sendError(res, err, 'checking your session');
  }
  if (!session) {
    return sendError(res, fail('AUTH-001', 'Your session has ended (signed out, or inactive for too long). Sign in again.', { status: 401 }));
  }
  if (session.active_role && !assignmentFor(session.employee_id).roles.includes(session.active_role)) {
    return sendError(res, fail('AUTH-006', `Your account no longer has the ${session.active_role} role. Sign in again.`, { status: 401 }));
  }
  req.token = token;
  req.actor = { employeeId: session.employee_id, name: session.name, role: session.active_role };
  next();
}

// The role the user signed in with for this session must be one of `roles`.
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.actor.role)) {
      const signedInAs = req.actor.role ? `You are signed in as ${req.actor.role}.` : 'Choose a role first.';
      return sendError(res, fail('AUTH-005', `This action needs the ${roles.join(' or ')} role. ${signedInAs}`, { status: 403 }));
    }
    next();
  };
}

module.exports = { requireActor, requireRole };
