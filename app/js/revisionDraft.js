// The in-progress revision as it moves through screens 1 → 2 → 3 (diesel
// price entry → vendor selection → review). Lives in memory for the
// duration of the flow; cleared once it's submitted for approval, rejected
// by the user backing out, or the session ends.
//
// A draft reopened from a returned revision also carries `vendorIds`,
// `effectiveDate`, `overrides` and `returnedFrom` ({ revisionNo, reason,
// returnedBy, returnedOn }) — the approver's comments, shown on every step
// until it's resubmitted.
let draft = null;

export function startDraft(dieselPriceEntry) {
  draft = { vendorIds: [], ...dieselPriceEntry };
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
