import { request } from './client.js';

/**
 * Verifies an employee ID / password pair against SAP SuccessFactors.
 *
 * Real endpoint: POST {API_BASE_URL}/login with { employeeId, password }.
 *   This is proxied through the portal's own backend (server/), which
 *   turns the employee ID into the SF username the OData login check
 *   expects (see sfClient.js) — that mapping can't live in browser code.
 * Response: { employeeId: string, name: string, role: string }
 *   SuccessFactors doesn't return a name or role for this check, so the
 *   backend looks both up from its own roster (server/roles.js) keyed by
 *   employeeId. Employee IDs not on the roster come back as role: 'Display'.
 */
export async function login(employeeId, password) {
  return request('/login', {
    method: 'POST',
    skipAuth: true,
    body: { employeeId, password },
  });
}
