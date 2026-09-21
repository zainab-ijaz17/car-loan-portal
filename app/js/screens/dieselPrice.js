import { getCurrentDieselPrice } from '../api/dieselApi.js';
import { uploadNotification } from '../api/notificationsApi.js';
import { getDraft, startDraft } from '../revisionDraft.js';
import { withAsyncState, escapeHtml, priceStr, pct, isoToDisplayDate, displayToIsoDate, daysBetween, toast, openDialog, closeDialog } from '../ui.js';

export const title = 'Screen 1 · Enter Diesel Price';

export function mount(container) {
  const controller = new AbortController();
  withAsyncState(container, getCurrentDieselPrice, (previous) => render(container, previous), {
    loadingLabel: 'Loading current diesel price…',
  });
  return () => { controller.abort(); closeDialog(); };
}

function render(container, previous) {
  container.innerHTML = `
    <div style="display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:34px;max-width:1080px">
      <div>
        <h3 style="margin-bottom:3px">Enter diesel price</h3>
        <p class="muted" style="font-size:13px;max-width:46ch">One entry reprices every indexed contract. Values are checked again on confirm.</p>

        <form id="diesel-form" class="grid-2" style="margin-top:20px">
          <div class="field">
            <label for="fuelType">Fuel type</label>
            <select class="input" id="fuelType" name="fuelType">
              <option>High Speed Diesel</option>
              <option>Light Diesel Oil</option>
            </select>
          </div>
          <div class="field">
            <label for="effectiveDate">Effective date</label>
            <input class="input num" id="effectiveDate" name="effectiveDate" type="date" required>
          </div>
          <div class="field">
            <label for="price">Price per litre (PKR, 3 decimals)</label>
            <input class="input num" id="price" name="price" type="number" step="0.001" min="0" required>
          </div>
          <div class="field">
            <label for="source">Source</label>
            <select class="input" id="source" name="source">
              <option>PSO</option>
              <option>OGRA</option>
              <option>Other</option>
            </select>
          </div>
          <div class="field" style="grid-column:1/-1">
            <label>Attach notification <span style="color:var(--color-accent-300)">· required</span></label>
            <div class="row-gap">
              <input type="file" id="notification" name="notification" accept=".pdf,.jpg,.png" style="max-width:340px">
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
          <div><div class="ro-lab">Change</div><div class="ro num" id="change-line" style="color:var(--color-accent-300)">—</div></div>
          <div><div class="ro-lab">Days since last revision</div><div class="ro num" id="days-since">—</div></div>
        </div>
        <p class="muted" style="font-size:11.5px;margin-top:14px;line-height:1.5">Dashed fields are system-calculated and never editable.</p>
      </div>
    </div>
  `;

  const form = container.querySelector('#diesel-form');
  const changeLine = container.querySelector('#change-line');
  const daysSince = container.querySelector('#days-since');
  const errorEl = container.querySelector('#form-error');
  const notificationStatus = container.querySelector('#notification-status');

  // { id, originalName } once uploaded — this, not the file input, is what
  // "attached" means: the file has actually reached the server and has a
  // real reference other screens can use to retrieve it later.
  let notification = null;

  // "Effective date cannot be earlier than the last confirmed price" —
  // enforced natively via min, which form.checkValidity() below honors.
  form.effectiveDate.min = displayToIsoDate(previous.effectiveDate);

  function recalc() {
    const price = Number(form.price.value);
    if (form.price.value && !Number.isNaN(price)) {
      const changePct = ((price - previous.price) / previous.price) * 100;
      changeLine.textContent = `+PKR ${(price - previous.price).toFixed(3)} · ${pct(changePct)}`;
    } else {
      changeLine.textContent = '—';
    }
    if (form.effectiveDate.value) {
      const displayDate = isoToDisplayDate(form.effectiveDate.value);
      daysSince.textContent = daysBetween(displayDate, previous.effectiveDate);
    } else {
      daysSince.textContent = '—';
    }
  }
  form.price.addEventListener('input', recalc);
  form.effectiveDate.addEventListener('input', recalc);

  // Restore an in-progress draft (e.g. the user went on to Screen 2 and
  // came back) instead of showing a blank form. The file itself can't be
  // repopulated into the input, but it's already uploaded — its
  // reference carries over directly.
  const existingDraft = getDraft();
  if (existingDraft) {
    form.fuelType.value = existingDraft.fuelType;
    form.effectiveDate.value = displayToIsoDate(existingDraft.dieselEffectiveDate);
    form.price.value = existingDraft.dieselPrice;
    form.source.value = existingDraft.source;
    form.remarks.value = existingDraft.remarks || '';
    if (existingDraft.notificationId) {
      notification = { id: existingDraft.notificationId, originalName: existingDraft.notificationFileName };
      notificationStatus.textContent = `Attached: ${existingDraft.notificationFileName}`;
    }
    recalc();
  }

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
      toast(err.message || 'Upload failed.', 'error');
      form.notification.value = '';
    }
  });

  container.querySelector('#save-draft').addEventListener('click', () => {
    toast('Draft saved locally. It is not yet submitted.', 'info');
  });

  container.querySelector('#open-confirm').addEventListener('click', () => {
    errorEl.hidden = true;
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }
    const price = Number(form.price.value);
    if (!(price > 0)) {
      errorEl.textContent = 'Enter a price greater than zero.';
      errorEl.hidden = false;
      return;
    }
    if (!notification) {
      errorEl.textContent = 'Attach the diesel-price notification (and wait for it to finish uploading).';
      errorEl.hidden = false;
      return;
    }
    const dieselEffectiveDate = isoToDisplayDate(form.effectiveDate.value);

    openDialog(`
      <div class="dialog-title">Confirm diesel price</div>
      <div class="dialog-body">You are confirming ${escapeHtml(form.fuelType.value)} at PKR <span class="num">${priceStr(price)}</span> effective <span class="num">${escapeHtml(dieselEffectiveDate)}</span>.</div>
      <div class="dialog-body" style="opacity:.6;font-size:12.5px">This price becomes the basis for every indexed contract you select next.</div>
      <div class="dialog-actions">
        <button class="btn btn-secondary" id="dlg-cancel">Go back and edit</button>
        <button class="btn btn-primary" id="dlg-confirm">Confirm price</button>
      </div>
    `);
    document.getElementById('dlg-cancel').addEventListener('click', closeDialog);
    document.getElementById('dlg-confirm').addEventListener('click', () => {
      startDraft({
        dieselPrice: price,
        dieselEffectiveDate,
        fuelType: form.fuelType.value,
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
