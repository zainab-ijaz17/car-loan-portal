// The approver's comments on a revision that was returned for correction.
// Shown in full on "Enter diesel price" (with the button to reopen it) and
// as a reminder strip on every later step while it's being corrected.
import { escapeHtml } from '../ui.js';

export function returnedNoticeHtml(returned, { actionsHtml = '', compact = false } = {}) {
  const by = returned.returnedBy?.name || returned.returnedBy?.employeeId || 'the approver';
  return `
    <div class="notice-warning" role="alert">
      <div class="notice-title">${compact ? 'Correcting' : ''} Revision ${returned.revisionNo} ${compact ? '— address these comments before resubmitting' : 'was returned for correction'}</div>
      <div class="muted" style="font-size:12.5px">Comments from ${escapeHtml(by)} on <span class="num">${escapeHtml(returned.returnedOn)}</span>:</div>
      <div class="notice-quote">${escapeHtml(returned.reason)}</div>
      ${actionsHtml}
    </div>
  `;
}
