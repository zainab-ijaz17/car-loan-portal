import { getVendors } from '../api/vendorsApi.js';
import { getDraft, updateDraft } from '../revisionDraft.js';
import { withAsyncState, escapeHtml, toast, isoToDisplayDate, displayToIsoDate } from '../ui.js';

export const title = 'Screen 2 · Select Vendors';

export function mount(container) {
  const draft = getDraft();
  if (!draft) {
    location.hash = '#/diesel-price';
    return () => {};
  }

  const controller = new AbortController();
  withAsyncState(container, getVendors, (vendors) => render(container, draft, vendors), {
    loadingLabel: 'Loading vendors…',
  });
  return () => controller.abort();
}

function render(container, draft, vendors) {
  const selected = new Set(draft.vendorIds.length ? draft.vendorIds : vendors.map((v) => v.id));

  container.innerHTML = `
    <div style="max-width:1180px">
      <h3 style="margin-bottom:3px">Select vendors</h3>
      <p class="muted" style="font-size:13px">Only checked contracts are simulated and repriced.</p>

      <div class="field" style="width:220px;margin-top:18px">
        <label for="rate-effective-from">Rates effective from</label>
        <input class="input num" id="rate-effective-from" type="date" required>
      </div>

      <table class="table" style="margin-top:18px">
        <thead><tr>
          <th style="width:34px"><input type="checkbox" id="toggle-all"></th>
          <th>Vendor</th><th>Annexure</th><th style="text-align:right">Pass-through %</th>
          <th>Rounding</th><th style="text-align:right">Rate lines</th><th style="text-align:right">Last revised</th>
        </tr></thead>
        <tbody id="vendor-rows"></tbody>
      </table>

      <div class="spread" style="margin-top:20px">
        <span class="muted" style="font-size:12px" id="sel-summary"></span>
        <div class="row-gap">
          <button class="btn btn-secondary" id="back-btn">Back</button>
          <button class="btn btn-primary" id="run-sim">Run Simulation</button>
        </div>
      </div>
    </div>
  `;

  const rowsEl = container.querySelector('#vendor-rows');
  const toggleAll = container.querySelector('#toggle-all');
  const summaryEl = container.querySelector('#sel-summary');
  const rateEffectiveFrom = container.querySelector('#rate-effective-from');
  rateEffectiveFrom.value = displayToIsoDate(draft.effectiveDate || draft.dieselEffectiveDate);

  function rowHtml(v) {
    return `
      <tr>
        <td><input type="checkbox" class="vendor-check" data-id="${v.id}" ${selected.has(v.id) ? 'checked' : ''}></td>
        <td>
          <span>${escapeHtml(v.name)}</span>
          ${v.stale ? '<span class="tag tag-outline" style="margin-left:8px;font-size:10px">not revised 90+ days</span>' : ''}
        </td>
        <td class="num">${escapeHtml(v.annexure)}</td>
        <td class="num" style="text-align:right">${v.passThroughPct.toFixed(2)}</td>
        <td>${escapeHtml(v.roundingRule)}</td>
        <td class="num" style="text-align:right">${v.rateLineCount}</td>
        <td class="num" style="text-align:right">${escapeHtml(v.lastRevisedDate)}</td>
      </tr>
    `;
  }

  function updateSummary() {
    const selVendors = vendors.filter((v) => selected.has(v.id));
    const lines = selVendors.reduce((sum, v) => sum + v.rateLineCount, 0);
    summaryEl.textContent = `${selVendors.length} vendors · ${lines} rate lines selected`;
    toggleAll.checked = selVendors.length === vendors.length;
    toggleAll.indeterminate = selVendors.length > 0 && selVendors.length < vendors.length;
  }

  rowsEl.innerHTML = vendors.map(rowHtml).join('');
  updateSummary();

  rowsEl.addEventListener('change', (e) => {
    if (!e.target.matches('.vendor-check')) return;
    const id = e.target.dataset.id;
    if (e.target.checked) selected.add(id); else selected.delete(id);
    updateSummary();
  });

  toggleAll.addEventListener('change', () => {
    if (toggleAll.checked) vendors.forEach((v) => selected.add(v.id));
    else selected.clear();
    rowsEl.innerHTML = vendors.map(rowHtml).join('');
    updateSummary();
  });

  container.querySelector('#back-btn').addEventListener('click', () => {
    location.hash = '#/diesel-price';
  });

  container.querySelector('#run-sim').addEventListener('click', () => {
    if (selected.size === 0) {
      toast('Select at least one vendor to simulate.', 'error');
      return;
    }
    if (!rateEffectiveFrom.value) {
      toast('Enter the date the new rates take effect.', 'error');
      return;
    }
    updateDraft({ vendorIds: [...selected], effectiveDate: isoToDisplayDate(rateEffectiveFrom.value) });
    location.hash = '#/review';
  });
}
