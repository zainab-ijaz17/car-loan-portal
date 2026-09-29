// The one place that actually calls fetch(). Every api/*.js module routes
// its non-mock requests through here so auth headers, error shapes and the
// base URL only need to be right in one spot.
import { CONFIG } from '../config.js';
import { getCredentials, clearSession, isAuthenticated } from '../session.js';

// `code` / `where` come from the server's coded error body (see
// server/errors.js) — "DSL-003", "Enter diesel price › Effective date" —
// and are what ui.js's errorText()/showInlineError() display.
export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.name = 'ApiError';
    this.status = status; // 0 = network/transport failure, no HTTP response
    this.details = details;
    this.code = details?.code || (status === 0 ? 'NET-001' : `SYS-${status}`);
    this.where = details?.where || (status === 0 ? 'Connection' : 'Server');
    this.field = details?.field || null;
  }
}

/**
 * @param {string} path - appended to CONFIG.API_BASE_URL, e.g. '/vendors'
 * @param {object} [opts]
 * @param {'GET'|'POST'|'PUT'|'DELETE'} [opts.method]
 * @param {object} [opts.body] - JSON-serialized as the request body
 * @param {object} [opts.headers] - merged over the defaults; set
 *   `Authorization` explicitly (as authApi.login does) to bypass the
 *   session credentials, e.g. while verifying a login attempt.
 * @param {boolean} [opts.skipAuth] - don't attach the session's Basic Auth
 *   header (used for the login call itself)
 */
export async function request(path, { method = 'GET', body, headers = {}, skipAuth = false } = {}) {
  const finalHeaders = { 'Content-Type': 'application/json', ...headers };
  if (!skipAuth && !finalHeaders.Authorization) {
    const creds = getCredentials();
    if (creds) {
      finalHeaders.Authorization = 'Basic ' + btoa(`${creds.employeeId}:${creds.password}`);
    }
  }

  let res;
  try {
    res = await fetch(CONFIG.API_BASE_URL + path, {
      method,
      headers: finalHeaders,
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new ApiError('Could not reach the portal server. Check your connection and try again.', 0, { cause: err });
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // e.g. a proxy's HTML error page — fall through to the generic message
  }

  if (!res.ok) {
    // A 401 on an authenticated call means SAP no longer accepts this
    // session's credentials (password changed, account disabled, etc.) —
    // drop it so the router's login gate takes over on the next render,
    // rather than leaving stale, now-unauthorized data on screen.
    if (res.status === 401 && !skipAuth && isAuthenticated()) {
      clearSession();
      location.hash = '#/login';
    }
    // Plain REST error bodies use `.message`; SAP OData/Gateway error
    // bodies nest it as `.error.message.value` — handle both so a real
    // endpoint doesn't need special-casing per call site.
    const message =
      data?.message || data?.error?.message?.value || `The server could not complete the request (HTTP ${res.status}).`;
    throw new ApiError(message, res.status, data);
  }

  return data;
}
