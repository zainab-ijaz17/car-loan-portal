// The logged-in user's identity, role and credentials.
//
// Kept in memory only — never written to localStorage/sessionStorage.
// Because login is HTTP Basic Auth against SAP, the employee ID and
// password must be resent on every request (see api/client.js), so we
// hold them for the tab's lifetime and require signing in again after a
// refresh. If the real SAP login endpoint later returns a session token
// instead of validating raw credentials each call, store that token here
// instead and stop sending the password on every request.
let currentSession = null;

export function setSession(session) {
  currentSession = session;
}

export function clearSession() {
  currentSession = null;
}

export function getSession() {
  return currentSession;
}

export function getCredentials() {
  return currentSession
    ? { employeeId: currentSession.employeeId, password: currentSession.password }
    : null;
}

export function isAuthenticated() {
  return currentSession != null;
}

export function hasRole(role) {
  return currentSession?.role === role;
}
