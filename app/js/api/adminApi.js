import { request } from './client.js';

/**
 * Full vendor + agreement records for master-data maintenance
 * (Administrator only — same shape as vendorsApi.getVendors()).
 *
 * Real endpoint: GET {API_BASE_URL}/admin/vendors
 */
export async function getVendors() {
  return request('/admin/vendors');
}

/**
 * Updates an agreement's maintainable terms — Section 5: "Pass-through %
 * and rounding rule must be maintainable fields, not hard-coded."
 *
 * Real endpoint: PATCH {API_BASE_URL}/admin/vendors/{vendorId}/agreement
 * Request:  { passThroughPct?: number, roundingRule?: 'Nearest 100' | 'Nearest 50' | 'None',
 *   validityStart?: 'DD.MM.YYYY', validityEnd?: 'DD.MM.YYYY' }
 * Response: the updated vendor record
 */
export async function updateAgreement(vendorId, patch) {
  return request(`/admin/vendors/${vendorId}/agreement`, { method: 'PATCH', body: patch });
}

/**
 * Registers a new vendor with its agreement terms and one starting rate
 * line — Section 3's "space for adding additional vendors."
 *
 * Real endpoint: POST {API_BASE_URL}/admin/vendors
 * Request: {
 *   name, annexure, passThroughPct, roundingRule, validityStart?, validityEnd?,
 *   firstDestination, firstVehicleType, firstWeight, firstBaseRate
 * }
 * Response: the created vendor record
 */
export async function addVendor(payload) {
  return request('/admin/vendors', { method: 'POST', body: payload });
}

/**
 * A vendor's live rate sheet, so the admin screen can show which
 * destinations/vehicle types already exist before adding to them.
 *
 * Real endpoint: GET {API_BASE_URL}/admin/vendors/{vendorId}/rate-sheet
 * Response: { title, annexure, cols: string[], weights: string[], rows: [[dest, ...rates]] }
 */
export async function getRateSheet(vendorId) {
  return request(`/admin/vendors/${vendorId}/rate-sheet`);
}

/**
 * Adds a new destination row to a vendor's rate sheet — Section 3's
 * "space for adding additional destination rows." This is master-data
 * maintenance, not a revision: it takes effect immediately, with no
 * simulate/approve step.
 *
 * Real endpoint: POST {API_BASE_URL}/admin/vendors/{vendorId}/destinations
 * Request:  { destination: string, baseRates: (number|null)[] }  // aligned to the sheet's existing cols
 * Response: the updated rate sheet
 */
export async function addDestination(vendorId, payload) {
  return request(`/admin/vendors/${vendorId}/destinations`, { method: 'POST', body: payload });
}

/**
 * Updates the base rates for a destination that already exists on the
 * sheet (matched by name) — how a maintainer fills in numbers for a
 * destination that's on the sheet but has no rate yet.
 *
 * Real endpoint: PATCH {API_BASE_URL}/admin/vendors/{vendorId}/destinations
 * Request:  { destination: string, baseRates: (number|null)[] }  // aligned to the sheet's existing cols
 * Response: the updated rate sheet
 */
export async function updateDestinationRates(vendorId, payload) {
  return request(`/admin/vendors/${vendorId}/destinations`, { method: 'PATCH', body: payload });
}
