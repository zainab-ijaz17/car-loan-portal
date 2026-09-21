// The in-progress revision as it moves through screens 1 → 2 → 3 (diesel
// price entry → vendor selection → review). Lives in memory for the
// duration of the flow; cleared once it's submitted for approval, rejected
// by the user backing out, or the session ends.
let draft = null;

export function startDraft(dieselPriceEntry) {
  draft = { ...dieselPriceEntry, vendorIds: [] };
  return draft;
}

export function getDraft() {
  return draft;
}

export function updateDraft(patch) {
  draft = { ...draft, ...patch };
  return draft;
}

export function clearDraft() {
  draft = null;
}
