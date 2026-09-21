import * as adminApi from '../api/adminApi.js';
import { withAsyncState, escapeHtml, toast, openDialog, closeDialog, isoToDisplayDate, displayToIsoDate } from '../ui.js';

export const title = 'Screen 6 · Master Data';

const ROUNDING_RULES = ['Nearest 100', 'Nearest 50', 'None'];

export function mount(container) {
  const controller = new AbortController();
  load(container);
  return () => { controller.abort(); closeDialog(); };
}

function load(container) {
  withAsyncState(container, adminApi.getVendors, (vendors) => render(container, vendors), {
    loadingLabel: 'Loading vendors and agreements…',
  });
}

function render(container, vendors) {
  container.innerHTML = `
    <div class="screen-medium">
      <h3 style="margin-bottom:3px">Master data</h3>
      <p class="muted" style="font-size:13px">Vendors, agreements, destinations and vehicle types. No release rights — revisions still go through the approval workflow.</p>

      <div class="spread" style="margin-top:20px">
        <div class="hd">Vendors &amp; agreements</div>
        <button class="btn btn-secondary" id="add-vendor-btn">Add vendor</button>
      </div>
      <table class="table" style="margin-top:10px">
        <thead><tr>
          <th>Vendor</th><th>Annexure</th>
          <th style="text-align:right">Pass-through %</th><th>Rounding rule</th>
          <th>Valid from</th><th>Valid to</th>
          <th style="text-align:right">Rate lines</th><th style="text-align:right">Last revised</th>
        </tr></thead>
        <tbody id="vendor-rows"></tbody>
      </table>

      <div class="hd" style="margin-top:34px">Destinations &amp; vehicle types</div>
      <div class="field" style="width:280px;margin-top:10px">
        <label for="sheet-vendor">Vendor</label>
        <select class="input" id="sheet-vendor">${vendors.map((v) => `<option value="${v.id}">${escapeHtml(v.name)}</option>`).join('')}</select>
      </div>
      <div id="sheet-body" style="margin-top:16px"></div>
    </div>
  `;

  const rowsEl = container.querySelector('#vendor-rows');
  const sheetVendorSelect = container.querySelector('#sheet-vendor');
  const sheetBody = container.querySelector('#sheet-body');

  function rowHtml(v) {
    return `
      <tr data-id="${v.id}">
        <td>${escapeHtml(v.name)}</td>
        <td class="num">${escapeHtml(v.annexure)}</td>
        <td style="text-align:right"><input class="cell-in num" style="text-align:right;width:80px" type="number" min="0" max="100" step="0.01" value="${v.passThroughPct}" data-field="passThroughPct"></td>
        <td>
          <select class="cell-in" data-field="roundingRule">
            ${ROUNDING_RULES.map((r) => `<option ${r === v.roundingRule ? 'selected' : ''}>${r}</option>`).join('')}
          </select>
        </td>
        <td><input class="cell-in num" type="date" value="${v.validityStart ? displayToIsoDate(v.validityStart) : ''}" data-field="validityStart"></td>
        <td><input class="cell-in num" type="date" value="${v.validityEnd ? displayToIsoDate(v.validityEnd) : ''}" data-field="validityEnd"></td>
        <td class="num" style="text-align:right">${v.rateLineCount}</td>
        <td class="num" style="text-align:right">${escapeHtml(v.lastRevisedDate)}</td>
      </tr>
    `;
  }
  rowsEl.innerHTML = vendors.map(rowHtml).join('');

  async function saveAgreement(vendorId, field, value) {
    try {
      await adminApi.updateAgreement(vendorId, { [field]: value });
      toast('Agreement updated.', 'success');
    } catch (err) {
      toast(err.message || 'Could not save that change.', 'error');
      load(container);
    }
  }

  rowsEl.addEventListener('change', (e) => {
    const field = e.target.dataset.field;
    if (!field) return;
    const vendorId = e.target.closest('tr').dataset.id;
    let value = e.target.value;
    if (field === 'passThroughPct') value = Number(value);
    else if (field === 'validityStart' || field === 'validityEnd') value = value ? isoToDisplayDate(value) : '';
    saveAgreement(vendorId, field, value);
  });

  container.querySelector('#add-vendor-btn').addEventListener('click', () => openAddVendorDialog(container));

  async function loadSheet() {
    sheetBody.innerHTML = '<div class="state-block"><div class="spinner"></div></div>';
    try {
      const sheet = await adminApi.getRateSheet(sheetVendorSelect.value);
      renderSheet(sheetBody, sheetVendorSelect.value, sheet, () => loadSheet());
    } catch (err) {
      sheetBody.innerHTML = `<div class="error-banner"><span class="error-banner-dot">●</span><span>${escapeHtml(err.message || 'Could not load rate sheet.')}</span></div>`;
    }
  }
  sheetVendorSelect.addEventListener('change', loadSheet);
  loadSheet();
}

function renderSheet(container, vendorId, sheet, onChanged) {
  container.innerHTML = `
    <table class="table" style="max-width:820px">
      <thead><tr>
        <th style="width:60px">S.No</th><th>Destination</th>
        ${sheet.cols.map((c) => `<th style="text-align:right">${escapeHtml(c)}</th>`).join('')}
      </tr></thead>
      <tbody id="sheet-rows">
        ${sheet.rows.map((row, i) => `
          <tr data-dest="${escapeHtml(row[0])}">
            <td class="num">${i + 1}</td>
            <td>${escapeHtml(row[0])}</td>
            ${row.slice(1).map((v) => `
              <td class="num" style="text-align:right">
                <input class="cell-in num" style="text-align:right;width:100px" type="number" min="0" step="1" value="${v == null ? '' : v}" data-rate>
              </td>
            `).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
    <button class="btn btn-secondary" id="add-dest-btn" style="margin-top:14px">Add destination</button>
  `;

  async function saveRow(tr) {
    const destination = tr.dataset.dest;
    const baseRates = [...tr.querySelectorAll('input[data-rate]')].map((el) => el.value);
    try {
      await adminApi.updateDestinationRates(vendorId, { destination, baseRates });
      toast('Rate updated.', 'success');
    } catch (err) {
      toast(err.message || 'Could not save that rate.', 'error');
      onChanged();
    }
  }

  container.querySelector('#sheet-rows').addEventListener('change', (e) => {
    if (!e.target.matches('input[data-rate]')) return;
    saveRow(e.target.closest('tr'));
  });

  container.querySelector('#add-dest-btn').addEventListener('click', () => openAddDestinationDialog(vendorId, sheet, onChanged));
}

function openAddVendorDialog(container) {
  openDialog(`
    <div class="dialog-title">Add vendor</div>
    <div class="grid-2">
      <div class="field"><label>Vendor name</label><input class="input" id="av-name"></div>
      <div class="field"><label>Annexure reference</label><input class="input" id="av-annexure" placeholder="e.g. B/11"></div>
      <div class="field"><label>Pass-through %</label><input class="input num" id="av-pass" type="number" min="0" max="100" step="0.01" value="40"></div>
      <div class="field"><label>Rounding rule</label>
        <select class="input" id="av-round">${ROUNDING_RULES.map((r) => `<option>${r}</option>`).join('')}</select>
      </div>
      <div class="field"><label>Valid from <span class="muted">· optional</span></label><input class="input num" id="av-valid-from" type="date"></div>
      <div class="field"><label>Valid to <span class="muted">· optional</span></label><input class="input num" id="av-valid-to" type="date"></div>
      <div class="field"><label>First destination</label><input class="input" id="av-dest"></div>
      <div class="field"><label>First vehicle type</label><input class="input" id="av-vehicle"></div>
      <div class="field"><label>Payload / weight</label><input class="input" id="av-weight" placeholder="e.g. 20 Ton"></div>
      <div class="field"><label>Base rate (PKR)</label><input class="input num" id="av-rate" type="number" min="0" step="1"></div>
    </div>
    <div id="av-error" class="inline-error" hidden></div>
    <div class="dialog-actions">
      <button class="btn btn-secondary" id="dlg-cancel">Cancel</button>
      <button class="btn btn-primary" id="dlg-confirm">Add vendor</button>
    </div>
  `);
  document.getElementById('dlg-cancel').addEventListener('click', closeDialog);
  document.getElementById('dlg-confirm').addEventListener('click', async () => {
    const errorEl = document.getElementById('av-error');
    try {
      const validFrom = document.getElementById('av-valid-from').value;
      const validTo = document.getElementById('av-valid-to').value;
      await adminApi.addVendor({
        name: document.getElementById('av-name').value,
        annexure: document.getElementById('av-annexure').value,
        passThroughPct: document.getElementById('av-pass').value,
        roundingRule: document.getElementById('av-round').value,
        validityStart: validFrom ? isoToDisplayDate(validFrom) : '',
        validityEnd: validTo ? isoToDisplayDate(validTo) : '',
        firstDestination: document.getElementById('av-dest').value,
        firstVehicleType: document.getElementById('av-vehicle').value,
        firstWeight: document.getElementById('av-weight').value,
        firstBaseRate: document.getElementById('av-rate').value,
      });
      closeDialog();
      toast('Vendor added.', 'success');
      load(container);
    } catch (err) {
      errorEl.textContent = err.message || 'Could not add vendor.';
      errorEl.hidden = false;
    }
  });
}

function openAddDestinationDialog(vendorId, sheet, onChanged) {
  openDialog(`
    <div class="dialog-title">Add destination · ${escapeHtml(sheet.title)}</div>
    <div class="field"><label>Destination</label><input class="input" id="ad-dest"></div>
    ${sheet.cols.map((c, i) => `
      <div class="field"><label>Base rate · ${escapeHtml(c)}</label><input class="input num" id="ad-rate-${i}" type="number" min="0" step="1"></div>
    `).join('')}
    <div id="ad-error" class="inline-error" hidden></div>
    <div class="dialog-actions">
      <button class="btn btn-secondary" id="dlg-cancel">Cancel</button>
      <button class="btn btn-primary" id="dlg-confirm">Add destination</button>
    </div>
  `);
  document.getElementById('dlg-cancel').addEventListener('click', closeDialog);
  document.getElementById('dlg-confirm').addEventListener('click', async () => {
    const errorEl = document.getElementById('ad-error');
    const destination = document.getElementById('ad-dest').value;
    const baseRates = sheet.cols.map((_, i) => document.getElementById(`ad-rate-${i}`).value);
    try {
      await adminApi.addDestination(vendorId, { destination, baseRates });
      closeDialog();
      toast('Destination added.', 'success');
      onChanged();
    } catch (err) {
      errorEl.textContent = err.message || 'Could not add destination.';
      errorEl.hidden = false;
    }
  });
}
