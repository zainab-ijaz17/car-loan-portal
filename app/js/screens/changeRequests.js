// The Rate Approver's queue of master data changes raised by an
// Administrator — new vendors / destinations / vehicle types, and
// deletions. Approving applies the change immediately; rejecting needs a
// reason, which goes back to the requester.
import { listRequests, approveRequest, rejectRequest } from '../api/changeRequestsApi.js';
import { getVendorOptions } from '../api/vendorsApi.js';
import { getSession } from '../session.js';
import {
  withAsyncState, escapeHtml, money, trimNum, formatDateTime, toast, openDialog, closeDialog,
  codedError, showInlineError,
} from '../ui.js';

export const title = 'Master Data Requests';

const STATUS_TAG = { pending: 'tag-warning', approved: 'tag-positive', rejected: 'tag-negative' };
const KIND_LABEL = {
  add_vendor: 'New vendor',
  add_destination: 'New destination',
  add_vehicle_type: 'New vehicle type',
  delete_vendor: 'Delete vendor',
  delete_destination: 'Delete destination',
};

export function mount(container) {
  const controller = new AbortController();
  load(container);
  return () => { controller.abort(); closeDialog(); };
}

function load(container) {
  const loader = () => Promise.all([listRequests(), getVendorOptions()]);
  withAsyncState(container, loader, ([requests, vendors]) => render(container, requests, vendors), {
    loadingLabel: 'Loading requests…',
  });
}

function rate(v) {
  return v === '' || v == null ? '<span class="muted">blank</span>' : `PKR ${money(v)}`;
}

// What exactly would change, so the approver doesn't have to go and look.
function detailsHtml(r, vendorName) {
  const p = r.payload;
  const row = (label, value) => `<div><span class="muted">${escapeHtml(label)}:</span> ${value}</div>`;
  switch (r.kind) {
    case 'add_vendor':
      return [
        row('Annexure', escapeHtml(p.annexure || '—')),
        row('Pass-through', `${escapeHtml(trimNum(p.passThroughPct))}% · ${escapeHtml(p.roundingRule)}`),
        row('Validity', `${escapeHtml(p.validityStart || 'open')} – ${escapeHtml(p.validityEnd || 'open')}`),
        row('First line', `${escapeHtml(p.firstDestination)} · ${escapeHtml(p.firstVehicleType)}${p.firstWeight ? ` (${escapeHtml(p.firstWeight)})` : ''} · ${rate(p.firstBaseRate)}`),
      ].join('');
    case 'add_destination':
      return row('Vendor', escapeHtml(vendorName)) + row('Base rates', p.baseRates.map(rate).join(' · '));
    case 'add_vehicle_type': {
      const filled = (p.baseRates || []).filter((x) => x !== '' && x != null).length;
      return row('Vendor', escapeHtml(vendorName))
        + row('Payload', escapeHtml(p.weight || '—'))
        + row('Base rates', `${filled} of ${(p.baseRates || []).length} destinations filled in${filled < (p.baseRates || []).length ? ' — the rest are typed in at the next revision' : ''}`);
    }
    case 'delete_destination':
      return row('Vendor', escapeHtml(vendorName));
    default:
      return '';
  }
}

function render(container, requests, vendors) {
  const session = getSession();
  const nameOf = (id) => vendors.find((v) => v.id === id)?.name || id;
  const pending = requests.filter((r) => r.status === 'pending');
  const decided = requests.filter((r) => r.status !== 'pending');

  container.innerHTML = `
    <div class="screen-medium">
      <h3 style="margin-bottom:3px">Master data requests</h3>
      <p class="muted" style="font-size:13px">New and deleted vendors, destinations and vehicle types take effect only once you approve them. You cannot decide a request you raised yourself.</p>

      <div class="hd" style="margin-top:22px">Waiting for your decision · <span class="num">${pending.length}</span></div>
      <div class="stack" style="margin-top:10px">
        ${pending.length ? pending.map((r) => `
          <div class="card elev-sm" style="padding:14px 16px">
            <div class="spread" style="align-items:flex-start;gap:16px">
              <div style="min-width:0">
                <div class="row-gap"><span class="tag ${r.kind.startsWith('delete') ? 'tag-negative' : 'tag-neutral'}">${KIND_LABEL[r.kind] || r.kind}</span><span class="muted num" style="font-size:12px">#${r.id}</span></div>
                <div style="font-size:15px;margin-top:6px">${escapeHtml(r.summary)}</div>
                <div style="font-size:12.5px;margin-top:6px;line-height:1.6">${detailsHtml(r, nameOf(r.vendorId))}</div>
                ${r.reason ? `<div class="notice-quote" style="border-left-color:var(--color-divider);font-size:13px">${escapeHtml(r.reason)}</div>` : ''}
                <div class="muted" style="font-size:12px;margin-top:8px">Requested by ${escapeHtml(r.requestedBy?.name || '')} · <span class="num">${escapeHtml(formatDateTime(r.requestedAt))}</span></div>
              </div>
              <div class="row-gap" style="flex:none">
                ${r.requestedBy?.employeeId === session.employeeId
                  ? '<span class="muted" style="font-size:12px">Raised by you — another approver must decide</span>'
                  : `<button class="btn btn-secondary" data-reject="${r.id}">Reject</button><button class="btn btn-primary" data-approve="${r.id}">Approve</button>`}
              </div>
            </div>
          </div>
        `).join('') : '<p class="muted" style="font-size:13px">Nothing waiting. New requests also appear under the bell in the top bar.</p>'}
      </div>

      ${decided.length ? `
        <div class="hd" style="margin-top:34px">Decided</div>
        <table class="table" style="margin-top:10px">
          <thead><tr><th style="width:50px">#</th><th>Request</th><th>Requested by</th><th>Status</th><th>Decided</th></tr></thead>
          <tbody>
            ${decided.map((r) => `
              <tr>
                <td class="num">${r.id}</td>
                <td>${escapeHtml(r.summary)}${r.decisionNote ? `<div class="muted" style="font-size:12px">${escapeHtml(r.decisionNote)}</div>` : ''}</td>
                <td>${escapeHtml(r.requestedBy?.name || '')}</td>
                <td><span class="tag ${STATUS_TAG[r.status]}">${r.status === 'approved' ? 'Approved' : 'Rejected'}</span></td>
                <td style="font-size:12.5px">${escapeHtml(r.decidedBy?.name || '')} · <span class="num">${escapeHtml(formatDateTime(r.decidedAt))}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>` : ''}
    </div>
  `;

  const byId = (id) => requests.find((r) => String(r.id) === id);
  container.querySelectorAll('[data-approve]').forEach((btn) => btn.addEventListener('click', () => openDecisionDialog(container, byId(btn.dataset.approve), 'approve')));
  container.querySelectorAll('[data-reject]').forEach((btn) => btn.addEventListener('click', () => openDecisionDialog(container, byId(btn.dataset.reject), 'reject')));
}

function openDecisionDialog(container, r, action) {
  const approving = action === 'approve';
  openDialog(`
    <div class="dialog-title">${approving ? 'Approve' : 'Reject'} request #${r.id}</div>
    <div class="dialog-body">${escapeHtml(r.summary)}</div>
    ${approving
      ? `<div class="dialog-body" style="font-size:12.5px;opacity:.75">${r.kind.startsWith('delete') ? 'This takes effect immediately and cannot be undone from the portal.' : 'This takes effect immediately.'} The requester is notified.</div>`
      : '<div class="field"><label for="cr-reason">Reason for rejection · required</label><textarea class="input" id="cr-reason"></textarea></div>'}
    <div id="cr-error" class="inline-error" hidden></div>
    <div class="dialog-actions">
      <button class="btn btn-secondary" id="dlg-cancel">Cancel</button>
      <button class="btn btn-primary" id="dlg-confirm">${approving ? 'Approve' : 'Reject request'}</button>
    </div>
  `);
  document.getElementById('dlg-cancel').addEventListener('click', closeDialog);
  const confirmBtn = document.getElementById('dlg-confirm');
  confirmBtn.addEventListener('click', async () => {
    const errorEl = document.getElementById('cr-error');
    let reason;
    if (!approving) {
      reason = document.getElementById('cr-reason').value.trim();
      if (!reason) {
        showInlineError(errorEl, codedError('CR-004', 'Enter a reason for rejecting this request.', 'Reason for rejection'));
        return;
      }
    }
    confirmBtn.disabled = true;
    try {
      if (approving) await approveRequest(r.id); else await rejectRequest(r.id, reason);
      closeDialog();
      toast(`Request #${r.id} ${approving ? 'approved' : 'rejected'}.`, 'success');
      load(container);
    } catch (err) {
      showInlineError(errorEl, err);
      confirmBtn.disabled = false;
    }
  });
}
