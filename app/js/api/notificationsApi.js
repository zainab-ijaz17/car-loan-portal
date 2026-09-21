import { CONFIG } from '../config.js';
import { getCredentials } from '../session.js';
import { ApiError } from './client.js';

/**
 * Uploads the diesel-price notification attachment (Section 5: mandatory).
 * Separate from client.js's request() because this sends multipart/
 * form-data, not JSON.
 *
 * Real endpoint: POST {API_BASE_URL}/notifications  (multipart, field "file")
 * Response: { id: number, originalName: string }
 */
export async function uploadNotification(file) {
  const creds = getCredentials();
  const headers = {};
  if (creds) headers.Authorization = 'Basic ' + btoa(`${creds.employeeId}:${creds.password}`);

  const formData = new FormData();
  formData.append('file', file);

  let res;
  try {
    res = await fetch(CONFIG.API_BASE_URL + '/notifications', { method: 'POST', headers, body: formData });
  } catch (err) {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0, err);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.message || `Upload failed (${res.status}).`, res.status, data);
  return data;
}

/**
 * Downloads and saves the notification file. A plain <a href> can't be
 * used — the download route needs the session's Basic Auth header, which
 * only a fetch() call attaches, not a browser navigation — so this fetches
 * it as a blob and triggers the save itself.
 *
 * Real endpoint: GET {API_BASE_URL}/notifications/{id}
 */
export async function downloadNotification(id, fileName) {
  const creds = getCredentials();
  const headers = {};
  if (creds) headers.Authorization = 'Basic ' + btoa(`${creds.employeeId}:${creds.password}`);

  const res = await fetch(CONFIG.API_BASE_URL + `/notifications/${id}`, { headers });
  if (!res.ok) throw new ApiError(`Could not download the attachment (${res.status}).`, res.status);

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'notification';
  a.click();
  URL.revokeObjectURL(url);
}
