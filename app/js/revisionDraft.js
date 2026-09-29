// The in-progress revision as it moves through screens 1 → 2 → 3 (diesel
// price entry → vendor selection → review). Held in memory while the
// maintainer works, and saved on the server under their name (see
// server/routes/drafts.js) — on "Save Draft" and automatically at each
// step — so it comes back after a refresh, a sign-out or on another PC.
// Removed once it's submitted for approval or discarded.
//
// `confirmed` is set once the diesel price has been confirmed; vendor
// selection and review need it (a "Save Draft" from the first screen can
// hold an unfinished, unchecked form).
//
// A draft reopened from a returned revision also carries `vendorIds`,
// `effectiveDate`, `overrides` and `returnedFrom` ({ revisionNo, reason,
// returnedBy, returnedOn }) — the approver's comments, shown on every step
// until it's resubmitted.
import { getSavedDraft, saveDraft, deleteSavedDraft } from './api/revisionsApi.js';
import { getSession } from './session.js';
import { toastError } from './ui.js';

let draft = null;
let savedAt = null;
let loadedFor = null; // employee ID whose saved draft is in memory
let saveTimer = null;

const AUTOSAVE_DELAY_MS = 800;

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveNow().catch((err) => toastError(err, 'Your draft could not be saved.')); }, AUTOSAVE_DELAY_MS);
}

/** Saves the draft to the server right away; resolves with its saved time (ISO). */
export async function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!draft) return null;
  const result = await saveDraft(draft);
  savedAt = result.savedAt;
  return savedAt;
}

/**
 * Loads the signed-in maintainer's saved draft into memory, once per
 * sign-in. Screens call this before reading getDraft().
 */
export async function ensureDraftLoaded() {
  const employeeId = getSession()?.employeeId;
  if (!employeeId || loadedFor === employeeId) return draft;
  const saved = await getSavedDraft();
  draft = saved?.data || null;
  savedAt = saved?.savedAt || null;
  loadedFor = employeeId;
  return draft;
}

export function startDraft(dieselPriceEntry) {
  draft = { vendorIds: [], ...dieselPriceEntry };
  scheduleSave();
  return draft;
}

export function getDraft() {
  return draft;
}

export function getDraftSavedAt() {
  return savedAt;
}

export function updateDraft(patch) {
  draft = { ...draft, ...patch };
  scheduleSave();
  return draft;
}

/** Submitted or discarded — gone from memory and from the server. */
export async function clearDraft() {
  clearTimeout(saveTimer);
  draft = null;
  savedAt = null;
  await deleteSavedDraft().catch(() => {}); // submitting already removed it server-side
}

/**
 * On sign-out: saves any change still waiting for its autosave (must run
 * before the session ends), then forgets the draft locally only — it
 * stays saved for next time.
 */
export async function forgetDraft() {
  if (saveTimer) await saveNow().catch(() => {});
  clearTimeout(saveTimer);
  draft = null;
  savedAt = null;
  loadedFor = null;
}
