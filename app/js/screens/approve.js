import { getPendingApproval, approveAndRelease, rejectRevision, returnForCorrection } from '../api/revisionsApi.js';
import { downloadNotification } from '../api/notificationsApi.js';
import { getSession } from '../session.js';
import { withAsyncState, escapeHtml, money, priceStr, pct, toast, openDialog, closeDialog } from '../ui.js';

export const title = 'Screen 4 · Approve and Release';

export function mount(container) {
  const controller = new AbortController();
  load(container);
  return () => { controller.abort(); closeDialog(); };
}

function load(container) {
  withAsyncState(container, getPendingApproval, (pending) => {
    if (!pending) {
      container.innerHTML = `
        <div class="state-block" style="padding-top:60px">
          <div class="hd">Nothing to approve</div>
          <p class="muted">No revision is currently pending approval.</p>
        </div>
      `;
      return;
    }
    render(container, pending);
  }, { loadingLabel: 'Loading pending revision…' });
}

function render(container, pending) {
  container.innerHTML = `
    <div class="screen-medium">
      <div class="row-gap" style="align-items:baseline">
        <h3 style="margin-bottom:3px">Approve and release</h3>
        <span class="tag tag-accent">Revision ${pending.revisionNo} · pending</span>
      </div>
      <p class="muted" style="font-size:13px">Read-only. The approver cannot be the maintainer who submitted it.</p>

      <div style="display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:30px;margin-top:22px">
        <div>
          <div class="grid-4">
            <div><div class="hd">Vendors</div><div class="num" style="font-size:32px;line-height:1.1">${pending.totals.vendorCount}</div></div>
            <div><div class="hd">Rate lines</div><div class="num" style="font-size:32px;line-height:1.1">${pending.totals.rateLineCount}</div></div>
            <div><div class="hd">Uplift</div><div class="num" style="font-size:32px;line-height:1.1;color:var(--color-accent-300)">${pct(pending.totals.upliftPct)}</div></div>
            <div></div>
          </div>
          <div class="table-scroll">
          <table class="table" style="margin-top:22px">
            <thead><tr>
              <th>Vendor</th><th>Destination</th><th>Vehicle</th>
              <th style="text-align:right">Current rate</th><th style="text-align:right">Uplift</th>
              <th style="text-align:right">New rate</th><th style="text-align:right">Change</th>
            </tr></thead>
            <tbody>
              ${pending.lines.map((r) => `
                <tr>
                  <td>${escapeHtml(r.vendor)}</td><td>${escapeHtml(r.dest)}</td><td>${escapeHtml(r.vehicle)}</td>
                  <td class="num" style="text-align:right">${r.currentRate == null ? '—' : money(r.currentRate)}</td>
                  <td class="num" style="text-align:right">${r.upliftAmt == null ? '—' : money(r.upliftAmt)}</td>
                  <td class="num" style="text-align:right;font-weight:600">${r.newRate == null ? 'error' : money(r.newRate)}</td>
                  <td class="num" style="text-align:right;color:var(--color-accent-300)">${r.changePct == null ? '!' : pct(r.changePct)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          </div>
        </div>
        <div>
          <div class="card elev-sm">
            <div class="card-kicker">Submission</div>
            <div class="stack" style="font-size:13px">
              <div><div class="ro-lab" style="margin:0">Submitted by</div>${escapeHtml(pending.submittedBy.name)}</div>
              <div><div class="ro-lab" style="margin:0">Submitted on</div><span class="num">${escapeHtml(pending.submittedOn)}</span></div>
              <div><div class="ro-lab" style="margin:0">Diesel price notification</div>${pending.notificationId ? `<a href="#" id="notif-download">${escapeHtml(pending.notificationFileName)}</a>` : '<span class="muted">none attached</span>'}</div>
              <div><div class="ro-lab" style="margin:0">Basis</div><span class="num">${escapeHtml(pending.fuelType)} at PKR ${priceStr(pending.dieselPrice)} / litre, effective ${escapeHtml(pending.dieselEffectiveDate)}</span></div>
              <div><div class="ro-lab" style="margin:0">Rates effective from</div><span class="num">${escapeHtml(pending.effectiveDate)}</span></div>
            </div>
          </div>
        </div>
      </div>

      <div class="end" style="margin-top:24px">
        <button class="btn btn-secondary" id="return-btn">Return for Correction</button>
        <button class="btn btn-secondary" id="reject-btn">Reject</button>
        <button class="btn btn-primary" id="approve-btn">Approve and Release</button>
      </div>
    </div>
  `;

  container.querySelector('#return-btn').addEventListener('click', () => openReasonDialog(container, pending, 'return'));
  container.querySelector('#reject-btn').addEventListener('click', () => openReasonDialog(container, pending, 'reject'));
  container.querySelector('#approve-btn').addEventListener('click', () => openPasswordDialog(container, pending));
  container.querySelector('#notif-download')?.addEventListener('click', (e) => {
    e.preventDefault();
    downloadNotification(pending.notificationId, pending.notificationFileName)
      .catch((err) => toast(err.message || 'Download failed.', 'error'));
  });
}

function openReasonDialog(container, pending, kind) {
  const isReject = kind === 'reject';
  openDialog(`
    <div class="dialog-title">${isReject ? `Reject revision ${pending.revisionNo}` : `Return revision ${pending.revisionNo} for correction`}</div>
    <div class="field"><label>Reason · required</label><textarea class="input" id="reason-input" placeholder="Why is this being ${isReject ? 'rejected' : 'returned'}?"></textarea></div>
    <div id="reason-error" class="inline-error" hidden></div>
    <div class="dialog-actions">
      <button class="btn btn-secondary" id="dlg-cancel">Cancel</button>
      <button class="btn btn-primary" id="dlg-confirm">${isReject ? 'Reject revision' : 'Return revision'}</button>
    </div>
  `);
  document.getElementById('dlg-cancel').addEventListener('click', closeDialog);
  document.getElementById('dlg-confirm').addEventListener('click', async () => {
    const reason = document.getElementById('reason-input').value.trim();
    const errorEl = document.getElementById('reason-error');
    if (!reason) {
      errorEl.textContent = 'A reason is required.';
      errorEl.hidden = false;
      return;
    }
    try {
      const fn = isReject ? rejectRevision : returnForCorrection;
      await fn(pending.revisionNo, reason);
      closeDialog();
      toast(`Revision ${pending.revisionNo} ${isReject ? 'rejected' : 'returned for correction'}.`, 'success');
      load(container);
    } catch (err) {
      errorEl.textContent = err.message || 'Something went wrong.';
      errorEl.hidden = false;
    }
  });
}

function openPasswordDialog(container, pending) {
  const session = getSession();
  openDialog(`
    <div class="dialog-title">Sign and release</div>
    <div class="dialog-body">Re-enter your password to release revision <span class="num">${pending.revisionNo}</span> to <span class="num">${pending.totals.vendorCount}</span> vendors.</div>
    <div class="field"><label>Password · ${escapeHtml(session.name)}</label><input class="input" id="approve-password" type="password"></div>
    <div id="approve-error" class="inline-error" hidden></div>
    <div class="dialog-actions">
      <button class="btn btn-secondary" id="dlg-cancel">Cancel</button>
      <button class="btn btn-primary" id="dlg-confirm">Approve and Release</button>
    </div>
  `);
  document.getElementById('dlg-cancel').addEventListener('click', closeDialog);
  document.getElementById('dlg-confirm').addEventListener('click', async () => {
    const password = document.getElementById('approve-password').value;
    const errorEl = document.getElementById('approve-error');
    try {
      const result = await approveAndRelease(pending.revisionNo, {
        employeeId: session.employeeId,
        password,
        name: session.name,
      });
      showSuccessDialog(container, result);
    } catch (err) {
      errorEl.textContent = err.message || 'Approval failed.';
      errorEl.hidden = false;
    }
  });
}

function showSuccessDialog(container, result) {
  openDialog(`
    <div class="dialog-title">Revision ${result.revisionNo} released</div>
    <div class="dialog-body"><span class="num">${result.linesWritten}</span> rate lines written, effective <span class="num">${escapeHtml(result.effectiveDate)}</span>. Revision ${result.closedRevisionNo} lines closed on <span class="num">${escapeHtml(result.closedDate)}</span>.</div>
    <div class="dialog-actions">
      <button class="btn btn-secondary" id="dlg-close">Close</button>
      <button class="btn btn-primary" id="dlg-lookup">Open rate lookup</button>
    </div>
  `);
  document.getElementById('dlg-close').addEventListener('click', () => {
    closeDialog();
    load(container);
  });
  document.getElementById('dlg-lookup').addEventListener('click', () => {
    closeDialog();
    location.hash = '#/lookup';
  });
}
