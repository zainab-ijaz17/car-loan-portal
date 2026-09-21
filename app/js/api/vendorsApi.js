import { request } from './client.js';

/**
 * Vendors eligible for a diesel-indexed rate revision, with their
 * pass-through rate and current rounding rule.
 *
 * Real endpoint: GET {API_BASE_URL}/vendors
 * Response: [{
 *   id: string, name: string, annexure: string,
 *   passThroughPct: number, roundingRule: string,
 *   rateLineCount: number, lastRevisedDate: 'DD.MM.YYYY', stale: boolean
 * }]
 */
export async function getVendors() {
  return request('/vendors');
}

/**
 * Lightweight { id, name } list for dropdowns (rate lookup, annexure view)
 * that don't need the full vendor record.
 *
 * Real endpoint: GET {API_BASE_URL}/vendors?fields=id,name
 * Response: [{ id: string, name: string }]
 */
export async function getVendorOptions() {
  return request('/vendors?fields=id,name');
}
