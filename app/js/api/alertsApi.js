import { request } from './client.js';

/**
 * In-app notifications for the signed-in user in their session's role —
 * revision approved/rejected/returned, new items waiting for approval,
 * master data requests decided.
 *
 * Real endpoint: GET {API_BASE_URL}/alerts
 * Response: { unreadCount, items: [{ id, kind, title, body, link, createdAt, read }] }
 */
export async function getAlerts() {
  return request('/alerts');
}

/** Real endpoint: POST {API_BASE_URL}/alerts/{id}/read */
export async function markRead(id) {
  return request(`/alerts/${id}/read`, { method: 'POST', body: {} });
}

/** Real endpoint: POST {API_BASE_URL}/alerts/read-all */
export async function markAllRead() {
  return request('/alerts/read-all', { method: 'POST', body: {} });
}
