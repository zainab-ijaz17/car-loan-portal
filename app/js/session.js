// The logged-in user's identity, role and session token.
//
// Kept in memory only — never written to localStorage/sessionStorage, so
// a refresh means signing in again. The password is never kept: it's
// sent once to POST /login, which returns a session token (see
// server/sessions.js); that token is what api/client.js sends on every
// request, and the server ends it on logout or after inactivity.
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

export function getToken() {
  return currentSession?.token || null;
}

export function authHeader() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function isAuthenticated() {
  return currentSession != null;
}

export function hasRole(role) {
  return currentSession?.role === role;
}
