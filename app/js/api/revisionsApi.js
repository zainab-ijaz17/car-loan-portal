import { request } from './client.js';

/**
 * Dry-run: computes the before/after worksheet for a candidate diesel
 * price across the given vendors, without writing anything. SAP is
 * expected to own this calculation since it's the system of record for
 * the rates being compared against, per the fixed formula:
 *   adjustedRate = baseRate * (1 + upliftPct/100)     — unrounded
 *   publishedRate = ROUND(adjustedRate, roundingRule) — rounded once, at
 *   the end, using that vendor's own agreement-level rounding rule.
 *
 * Real endpoint: POST {API_BASE_URL}/revisions/simulate
 * Request:  { dieselPrice: number, effectiveDate: 'DD.MM.YYYY', vendorIds: string[] }
 * Response: {
 *   revisionNo: number, effectiveDate: string, overallUpliftPct: number,
 *   vendors: [{ id, name, upliftPct, upliftBasis, blocked }],
 *   worksheets: { [vendorId]: {
 *     title, annexure, cols: string[], weights: string[],
 *     rows: [{ no, dest, base, inc, sum, rounded, bal }],
 *       // per cell, aligned to `cols` (null where uncomputable):
 *       // base = base rate; sum = unrounded adjusted rate (kept for audit);
 *       // inc = sum - base, for display only; rounded = published rate
 *       // (sum rounded once, by this vendor's rounding rule); bal = check value
 *     blocked: boolean
 *   }},
 *   totals: { vendorCount, rateLineCount, totalIncreasePkr }, blocked: boolean
 * }
 */
export async function simulateRevision(payload) {
  return request('/revisions/simulate', { method: 'POST', body: payload });
}

/**
 * Submits a simulated revision for approval. SAP re-validates and
 * re-computes server-side rather than trusting the client's numbers.
 *
 * Real endpoint: POST {API_BASE_URL}/revisions
 * Request: {
 *   dieselPrice, dieselEffectiveDate, effectiveDate, fuelType, source,
 *   notificationFileName, remarks, vendorIds, submittedBy: { employeeId, name }
 * }
 * `dieselEffectiveDate` is when the fuel price itself took effect;
 * `effectiveDate` is when the revised rates take effect (Section 5's
 * "Rate effective from", which defaults to but can differ from the diesel date).
 * Response: { revisionNo, status: 'pending', submittedBy, submittedOn }
 */
export async function submitForApproval(payload) {
  return request('/revisions', { method: 'POST', body: payload });
}

/**
 * The revision currently awaiting approval, if any, with its rate lines
 * flattened for the approver's review table.
 *
 * Real endpoint: GET {API_BASE_URL}/revisions/pending
 * Response: null | {
 *   revisionNo, submittedBy, submittedOn, dieselPrice, previousDieselPrice,
 *   effectiveDate, fuelType, source, notificationFileName,
 *   totals: { vendorCount, rateLineCount, upliftPct },
 *   lines: [{ vendor, dest, vehicle, currentRate, upliftAmt, newRate, changePct }]
 * }
 */
export async function getPendingApproval() {
  return request('/revisions/pending');
}

/**
 * Releases a pending revision: writes the new rates to this app's own
 * store and closes out the prior revision. The approver re-authenticates
 * against real SAP SuccessFactors (the same check as login) as part of
 * this call; the backend also re-checks that the approver isn't the
 * original submitter.
 *
 * Real endpoint: POST {API_BASE_URL}/revisions/{revisionNo}/approve
 * Request:  { employeeId, password, name }
 * Response: { revisionNo, linesWritten, effectiveDate, closedRevisionNo, closedDate }
 */
export async function approveAndRelease(revisionNo, credentials) {
  return request(`/revisions/${revisionNo}/approve`, { method: 'POST', body: credentials });
}

/**
 * The actor is identified server-side via the request's own Basic Auth
 * header, same as every other authenticated endpoint.
 *
 * Real endpoint: POST {API_BASE_URL}/revisions/{revisionNo}/reject
 * Request:  { reason: string }
 * Response: { revisionNo, status: 'rejected' }
 */
export async function rejectRevision(revisionNo, reason) {
  return request(`/revisions/${revisionNo}/reject`, { method: 'POST', body: { reason } });
}

/**
 * Real endpoint: POST {API_BASE_URL}/revisions/{revisionNo}/return
 * Request:  { reason: string }
 * Response: { revisionNo, status: 'returned' }
 */
export async function returnForCorrection(revisionNo, reason) {
  return request(`/revisions/${revisionNo}/return`, { method: 'POST', body: { reason } });
}
