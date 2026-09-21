import { request } from './client.js';

/**
 * The rate in effect for one lane on a given date (Section 1's "no way to
 * look up the rate that applied on a past date" — `date` is what makes
 * this a real historical lookup, not just today's rate). Omit `date` for
 * the current rate.
 *
 * Real endpoint: GET {API_BASE_URL}/rates/lookup?vendorId=&destination=&vehicleType=&date=DD.MM.YYYY
 * Response: null | {
 *   rate, vendorName, destination, vehicleType, annexure, revisionNo,
 *   validFrom, validTo, approvedBy, approvedOn
 * }
 */
export async function lookupRate(params) {
  return request('/rates/lookup?' + new URLSearchParams(params));
}

/**
 * Real endpoint: GET {API_BASE_URL}/rates/history?vendorId=&destination=&vehicleType=
 * Response: [{ revisionNo, dieselPrice, rate, validFrom, validTo }]
 */
export async function getRateHistory(params) {
  return request('/rates/history?' + new URLSearchParams(params));
}

/**
 * Vehicle-type columns for one vendor's rate sheet, to populate the
 * lookup form's dependent dropdown.
 *
 * Real endpoint: GET {API_BASE_URL}/vendors/{vendorId}/vehicle-types
 * Response: string[]
 */
export async function getVehicleTypes(vendorId) {
  return request(`/vendors/${vendorId}/vehicle-types`);
}

/**
 * Real endpoint: GET {API_BASE_URL}/revisions/options
 * Response: number[] — revision numbers, most recent first
 */
export async function getRevisionOptions() {
  return request('/revisions/options');
}

/**
 * A vendor's full rate sheet as it stood at a given revision.
 *
 * Real endpoint: GET {API_BASE_URL}/vendors/{vendorId}/annexure?revisionNo=
 * Response: {
 *   title, annexure, cols: string[], vendorName, revisionNo,
 *   dieselPrice, effectiveDate, approvedBy, approvedOn,
 *   rows: [{ no, dest, cells: (number|null)[] }]
 * }
 */
export async function getAnnexure(vendorId, revisionNo) {
  return request(`/vendors/${vendorId}/annexure?revisionNo=${revisionNo}`);
}
