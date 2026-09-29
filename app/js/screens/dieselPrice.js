import { getCurrentDieselPrice } from '../api/dieselApi.js';
import { getReturnedRevision } from '../api/revisionsApi.js';
import { uploadNotification } from '../api/notificationsApi.js';
import { getDraft, startDraft } from '../revisionDraft.js';
import { returnedNoticeHtml } from '../components/returnedNotice.js';
import {
  withAsyncState, escapeHtml, priceStr, pct, daysBetween, parseDisplayDate, isValidDisplayDate,
  dateField, wireDateFields, codedError, showInlineError, toastError, toast, openDialog, closeDialog,
} from '../ui.js';

export const title = 'Enter Diesel Price';

export function mount(container) {
  const controller = new AbortController();
  const loader = () => Promise.all([getCurrentDieselPrice(), getReturnedRevision()]);
  withAsyncState(container, loader, ([previous, returned]) => render(container, previous, returned), {
    loadingLabel: 'Loading current diesel price…',
  });
  return () => { controller.abort(); closeDialog(); };
}

function signed(n, digits) {
  const s = Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: digits });
  return `${n < 0 ? '−' : '+'}PKR ${s}`;
}

function render(container, previous, returned) {
  const draft = getDraft();
  const correcting = returned && draft?.returnedFrom?.revisionNo === returned.revisionNo;

  container.innerHTML = `
    ${returned ? `<div style="max-width:1080px;margin-bottom:24px">${returnedNoticeHtml(returned, {
      compact: correcting,
      actionsHtml: correcting ? '' : `
        <div class="row-gap" style="margin-top:12px">
          <button class="btn btn-primary" id="reopen-returned">Revise and resubmit</button>
          <span class="muted" style="font-size:12px">Reopens the submission by ${escapeHtml(returned.submittedBy?.name || '')} with its figures, attachment and vendors already filled in.</span>
        </div>`,
    })}</div>` : ''}
    <div style="display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:34px;max-width:1080px">
      <div>
        <h3 style="margin-bottom:3px">Enter diesel price</h3>
        <p class="muted" style="font-size:13px;max-width:46ch">One entry reprices every indexed contract. Values are checked again on confirm.</p>

        <form id="diesel-form" class="grid-2" style="margin-top:20px" novalidate>
          <div class="field">
            <label for="price">Diesel price per litre (PKR, up to 3 decimals)</label>
            <input class="input num" id="price" name="price" type="number" step="0.001" min="0" required>
          </div>
          <div class="field">
            <label for="effectiveDate">Effective date</label>
            ${dateField('effectiveDate', { min: previous.effectiveDate })}
          </div>
          <div class="field">
            <label for="source">Source</label>
            <select class="input" id="source" name="source">
              <option>PSO</option>
              <option>OGRA</option>
              <option>Other</option>
            </select>
          </div>
          <div></div>
          <div class="field" style="grid-column:1/-1">
            <label>Attach notification <span style="color:var(--color-warning)">· required</span></label>
            <div class="row-gap">
              <input type="file" id="notification" name="notification" accept=".pdf,.jpg,.jpeg,.png" style="max-width:340px">
              <span class="muted" style="font-size:12px" id="notification-status"></span>
            </div>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label for="remarks">Remarks <span class="muted">· optional</span></label>
            <textarea class="input" id="remarks" name="remarks" style="min-height:70px"></textarea>
          </div>
        </form>

        <div id="form-error" class="inline-error" hidden></div>

        <div class="end" style="justify-content:flex-start;margin-top:22px">
          <button class="btn btn-secondary" type="button" id="save-draft">Save Draft</button>
          <button class="btn btn-primary" type="button" id="open-confirm">Confirm</button>
        </div>
      </div>

      <div style="padding-top:6px">
        <div class="hd" style="display:flex;gap:6px;align-items:center;margin-bottom:10px">Calculated · read-only</div>
        <div class="stack">
          <div><div class="ro-lab">Previous price</div><div class="ro num">PKR ${priceStr(previous.price)}</div></div>
          <div><div class="ro-lab">Previous effective date</div><div class="ro num">${escapeHtml(previous.effectiveDate)}</div></div>
          <div><div class="ro-lab">Change</div><div class="ro num" id="change-line">—</div></div>
          <div><div class="ro-lab">Days since last revision</div><div class="ro num" id="days-since">—</div></div>
        </div>
        <p class="muted" style="font-size:11.5px;margin-top:14px;line-height:1.5">Dashed fields are system-calculated and never editable.</p>
      </div>
    </div>
  `;
  wireDateFields(container);

  const form = container.querySelector('#diesel-form');
  const dateInput = container.querySelector('#effectiveDate');
  const changeLine = container.querySelector('#change-line');
  const daysSince = container.querySelector('#days-since');
  const errorEl = container.querySelector('#form-error');
  const notificationStatus = container.querySelector('#notification-status');

  // { id, originalName } once uploaded — this, not the file input, is what
  // "attached" means: the file has actually reached the server and has a
  // real reference other screens can use to retrieve it later.
  let notification = null;

  function recalc() {
    const price = Number(form.price.value);
    if (form.price.value && !Number.isNaN(price)) {
      const diff = price - previous.price;
      changeLine.textContent = `${signed(diff, 3)} · ${pct((diff / previous.price) * 100)}`;
    } else {
      changeLine.textContent = '—';
    }
    daysSince.textContent = isValidDisplayDate(dateInput.value) ? daysBetween(dateInput.value, previous.effectiveDate) : '—';
  }
  form.price.addEventListener('input', recalc);
  dateInput.addEventListener('input', recalc);
  dateInput.addEventListener('change', recalc);

  // Restore an in-progress draft (e.g. the user went on to vendor
  // selection and came back, or reopened a returned revision) instead of
  // showing a blank form. The file itself can't be repopulated into the
  // input, but it's already uploaded — its reference carries over directly.
  if (draft) {
    dateInput.value = draft.dieselEffectiveDate || '';
    form.price.value = draft.dieselPrice ?? '';
    form.source.value = draft.source || 'PSO';
    form.remarks.value = draft.remarks || '';
    if (draft.notificationId) {
      notification = { id: draft.notificationId, originalName: draft.notificationFileName };
      notificationStatus.textContent = `Attached: ${draft.notificationFileName}`;
    }
    recalc();
  }

  container.querySelector('#reopen-returned')?.addEventListener('click', () => {
    startDraft({
      ...returned.draft,
      returnedFrom: { revisionNo: returned.revisionNo, reason: returned.reason, returnedBy: returned.returnedBy, returnedOn: returned.returnedOn },
      previousDieselPrice: previous.price,
      previousEffectiveDate: previous.effectiveDate,
    });
    render(container, previous, returned);
    toast('Returned revision reopened. Make the corrections, then continue through vendors and review to resubmit.', 'info', 6000);
  });

  form.notification.addEventListener('change', async () => {
    const file = form.notification.files[0];
    if (!file) return;
    notification = null;
    notificationStatus.textContent = 'Uploading…';
    try {
      notification = await uploadNotification(file);
      notificationStatus.textContent = `Attached: ${notification.originalName}`;
    } catch (err) {
      notificationStatus.textContent = '';
      toastError(err, 'Upload failed.');
      form.notification.value = '';
    }
  });

  container.querySelector('#save-draft').addEventListener('click', () => {
    toast('Draft saved locally. It is not yet submitted.', 'info');
  });

  function validate() {
    const price = Number(form.price.value);
    if (!form.price.value || !(price > 0)) {
      return codedError('DSL-001', 'Enter a diesel price greater than zero.', 'Diesel price per litre');
    }
    if (!isValidDisplayDate(dateInput.value)) {
      return codedError('DSL-002', 'Enter the effective date as DD.MM.YYYY, or pick it from the calendar.', 'Effective date');
    }
    if (parseDisplayDate(dateInput.value) < parseDisplayDate(previous.effectiveDate)) {
      return codedError('DSL-003', `The effective date cannot be earlier than the last confirmed price (${previous.effectiveDate}).`, 'Effective date');
    }
    if (!notification) {
      return codedError('DSL-004', 'Attach the diesel-price notification, and wait for it to finish uploading.', 'Attach notification');
    }
    return null;
  }

  container.querySelector('#open-confirm').addEventListener('click', () => {
    errorEl.hidden = true;
    const err = validate();
    if (err) {
      showInlineError(errorEl, err);
      return;
    }
    const price = Number(form.price.value);
    const dieselEffectiveDate = dateInput.value;

    openDialog(`
      <div class="dialog-title">Confirm diesel price</div>
      <div class="dialog-body">You are confirming diesel at PKR <span class="num">${priceStr(price)}</span> per litre, effective <span class="num">${escapeHtml(dieselEffectiveDate)}</span>.</div>
      <div class="dialog-body" style="opacity:.6;font-size:12.5px">This price becomes the basis for every indexed contract you select next.</div>
      <div class="dialog-actions">
        <button class="btn btn-secondary" id="dlg-cancel">Go back and edit</button>
        <button class="btn btn-primary" id="dlg-confirm">Confirm price</button>
      </div>
    `);
    document.getElementById('dlg-cancel').addEventListener('click', closeDialog);
    document.getElementById('dlg-confirm').addEventListener('click', () => {
      // Keep what later steps already picked (vendors, and for a returned
      // revision its rates-effective date, typed rates and comments).
      const carry = getDraft();
      startDraft({
        vendorIds: carry?.vendorIds || [],
        ...(carry?.returnedFrom ? { returnedFrom: carry.returnedFrom, effectiveDate: carry.effectiveDate, overrides: carry.overrides } : {}),
        dieselPrice: price,
        dieselEffectiveDate,
        source: form.source.value,
        notificationId: notification.id,
        notificationFileName: notification.originalName,
        remarks: form.remarks.value,
        previousDieselPrice: previous.price,
        previousEffectiveDate: previous.effectiveDate,
      });
      closeDialog();
      location.hash = '#/vendors';
    });
  });
}
