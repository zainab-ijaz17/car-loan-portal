// Every screen below login sends the session's Basic Auth header on each
// call (see app/js/api/client.js) the same way a real SAP passthrough
// endpoint would expect. This app's own data (vendors/rates/revisions) only
// needs to know *who* is calling for the audit log — the password itself is
// only re-checked against SAP at the one place it actually matters
// (approveAndRelease's re-auth, in routes/revisions.js).
function requireActor(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Basic ')) {
    return res.status(401).json({ message: 'Sign in required.' });
  }
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  const employeeId = sep === -1 ? decoded : decoded.slice(0, sep);
  if (!employeeId) {
    return res.status(401).json({ message: 'Sign in required.' });
  }
  req.actor = { employeeId };
  next();
}

module.exports = { requireActor };
