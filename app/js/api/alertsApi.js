import { request } from './client.js';

/**
 * In-app notifications for the signed-in user in their current role —
 * revision approved/rejected/returned, new items waiting for approval,
 * master data requests decided.
 *
 * Real endpoint: GET {API_BASE_URL}/alerts?role=
 * Response: { unreadCount, items: [{ id, kind, title, body, link, createdAt, read }] }
 */
export async function getAlerts(role) {
  return request(`/alerts?role=${encodeURIComponent(role)}`);
}

/** Real endpoint: POST {API_BASE_URL}/alerts/{id}/read */
export async function markRead(id, role) {
  return request(`/alerts/${id}/read`, { method: 'POST', body: { role } });
}

/** Real endpoint: POST {API_BASE_URL}/alerts/read-all */
export async function markAllRead(role) {
  return request('/alerts/read-all', { method: 'POST', body: { role } });
}
