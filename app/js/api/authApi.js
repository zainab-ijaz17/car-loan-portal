import { request } from './client.js';

/**
 * Checks an employee ID / password pair against SAP SuccessFactors and
 * opens a session.
 *
 * Real endpoint: POST {API_BASE_URL}/login with { employeeId, password }.
 *   Proxied through the portal's own backend (server/), which turns the
 *   employee ID into the SF username the OData login check expects (see
 *   sfClient.js) — that mapping can't live in browser code.
 * Response: { token, employeeId, name, roles: string[], activeRole: string|null }
 *   `token` is sent on every later call instead of the password. Name and
 *   roles come from the backend's roster (server/roles.js); IDs not on it
 *   get ['Display']. activeRole is null when there's more than one role —
 *   pick one with chooseRole().
 */
export async function login(employeeId, password) {
  return request('/login', {
    method: 'POST',
    skipAuth: true,
    body: { employeeId, password },
  });
}

/**
 * Fixes the role for a multi-role account's session (once per session).
 * Called before the session is stored, so the token is passed explicitly.
 *
 * Real endpoint: POST {API_BASE_URL}/session/role  { role }
 */
export async function chooseRole(token, role) {
  return request('/session/role', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: { role } });
}

/** Real endpoint: POST {API_BASE_URL}/logout */
export async function logout() {
  return request('/logout', { method: 'POST', body: {} });
}
