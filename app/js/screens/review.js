import { simulateRevision, submitForApproval } from '../api/revisionsApi.js';
import { getDraft, clearDraft } from '../revisionDraft.js';
import { getSession } from '../session.js';
import { withAsyncState, escapeHtml, money, pct, toast } from '../ui.js';

export const title = 'Screen 3 · Review Before / After';

export function mount(container) {
  const draft = getDraft();
  if (!draft || !draft.vendorIds.length) {
    location.hash = '#/vendors';
    return () => {};
  }

  const controller = new AbortController();
  // { [vendorId]: { [rowIndex]: { [colIndex]: number } } } — rates typed
  // directly for lines with no base rate on file yet (see rateEngine.js's
  // computeWorksheet). Scoped to this screen instance: going back to
  // vendor selection and forward again starts fresh.
  const overrides = {};

  function load() {
    const loader = () => simulateRevision({
      dieselPrice: draft.dieselPrice,
      effectiveDate: draft.effectiveDate,
      vendorIds: draft.vendorIds,
      overrides,
    });
    withAsyncState(container, loader, (sim) => render(container, draft, sim, overrides, load), {
      loadingLabel: 'Running simulation…',
    });
  }
  load();
  return () => controller.abort();
}

function cell(v, kind) {
  if (v == null) return kind === 'rounded' ? null : kind === 'bal' ? '!' : '—';
  if (kind === 'bal') return v === 0 ? '0' : (v > 0 ? '+' : '') + money(v);
  return money(v);
}

// `rounded` is editable for a blocked line (base == null) — that's how a
// destination gets its first-ever rate: typed here rather than computed
// from a prior one, then written to the rate sheet like any other
// approved line. Everywhere else base has a real value, so the whole
// before/after band is server-computed and read-only.
function worksheetTable(sheet) {
  const n = sheet.cols.length;
  const groupHeader = (label, color) => `<th colspan="${n}" style="text-align:center;color:${color || 'var(--color-text)'}">${label}</th>`;
  const colHeaderRow = () => sheet.cols.map((c) => `<th style="text-align:right">${escapeHtml(c)}</th>`).join('');
  const weightRow = () => sheet.weights.map((w) => `<th style="text-align:right;text-transform:none;letter-spacing:0">${escapeHtml(w)}</th>`).join('');

  return `
    <div class="table-scroll">
    <table class="table" style="min-width:1240px;font-size:13px">
      <thead>
        <tr>
          <th style="width:34px"></th><th style="min-width:190px"></th><th style="width:10px"></th>
          ${groupHeader('Base rate · previous revision')}<th style="width:10px"></th>
          ${groupHeader('Increase in PKR')}<th style="width:10px"></th>
          ${groupHeader('Sum with increase')}<th style="width:10px"></th>
          ${groupHeader('New rates · rounded', 'var(--color-accent-300)')}<th style="width:10px"></th>
          ${groupHeader('Balancing')}
        </tr>
        <tr>
          <th style="text-align:right">S.No</th><th>Destination</th><th></th>
          ${colHeaderRow()}<th></th>${colHeaderRow()}<th></th>${colHeaderRow()}<th></th>${colHeaderRow()}<th></th>${colHeaderRow()}
        </tr>
        <tr>
          <th></th><th style="text-align:left;text-transform:none;letter-spacing:0">Average weight</th><th></th>
          ${weightRow()}<th></th>${weightRow()}<th></th>${weightRow()}<th></th>${weightRow()}<th></th>${weightRow()}
        </tr>
      </thead>
      <tbody>
        ${sheet.rows.map((r, i) => `
          <tr>
            <td class="num" style="text-align:right;color:color-mix(in srgb,var(--color-text) 45%,transparent)">${r.no}</td>
            <td style="line-height:1.35">${escapeHtml(r.dest)}</td>
            <td></td>
            ${r.base.map((v) => `<td class="num" style="text-align:right;color:color-mix(in srgb,var(--color-text) 70%,transparent)">${cell(v, 'base')}</td>`).join('')}
            <td></td>
            ${r.inc.map((v) => `<td class="num" style="text-align:right;color:color-mix(in srgb,var(--color-text) 70%,transparent)">${cell(v, 'inc')}</td>`).join('')}
            <td></td>
            ${r.sum.map((v) => `<td class="num" style="text-align:right;color:color-mix(in srgb,var(--color-text) 70%,transparent)">${cell(v, 'sum')}</td>`).join('')}
            <td></td>
            ${r.rounded.map((v, j) => `
              <td class="num" style="text-align:right;font-weight:600">
                ${r.base[j] == null
                  ? `<input class="cell-in num" style="text-align:right;width:90px" type="number" min="0" step="1" placeholder="new rate" value="${v == null ? '' : v}" data-row="${i}" data-col="${j}">`
                  : cell(v, 'rounded')}
              </td>
            `).join('')}
            <td></td>
            ${r.bal.map((v) => `<td class="num" style="text-align:right;color:color-mix(in srgb,var(--color-text) 35%,transparent)">${cell(v, 'bal')}</td>`).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>
  `;
}

function render(container, draft, sim, overrides, reload, preferredVendorId) {
  let activeVendorId = sim.vendors.some((v) => v.id === preferredVendorId) ? preferredVendorId : sim.vendors[0].id;

  container.innerHTML = `
    <div class="screen-wide">
      <h3 style="margin-bottom:3px">Review before / after</h3>
      <p class="muted" style="font-size:13px">Nothing is written to the ledger until an approver releases it.</p>

      <div class="grid-4" style="margin:22px 0 6px">
        <div><div class="hd">Vendors selected</div><div class="num" style="font-size:40px;line-height:1.1">${sim.totals.vendorCount}</div></div>
        <div><div class="hd">Rate lines affected</div><div class="num" style="font-size:40px;line-height:1.1">${sim.totals.rateLineCount}</div></div>
        <div><div class="hd">Diesel price change</div><div class="num" style="font-size:40px;line-height:1.1;color:var(--color-accent-300)">${pct(sim.overallUpliftPct)}</div></div>
        <div><div class="hd">Total cost impact</div><div class="num" style="font-size:40px;line-height:1.1;color:var(--color-accent-300)">+PKR ${money(Math.round(sim.totals.totalIncreasePkr))}</div></div>
      </div>

      <div id="blocked-banner"></div>

      <div style="display:flex;gap:12px;align-items:flex-end;margin-top:22px">
        <div class="field" style="width:280px"><label>Vendor</label>
          <select class="input" id="sim-vendor">
            ${sim.vendors.map((v) => `<option value="${v.id}" ${v.id === activeVendorId ? 'selected' : ''}>${escapeHtml(v.name)}</option>`).join('')}
          </select>
        </div>
        <div class="row-gap" style="align-items:baseline;padding-bottom:7px">
          <span class="hd">Uplift factor</span>
          <span class="num" style="font-size:17px;color:var(--color-accent-300)" id="uplift-factor"></span>
        </div>
      </div>

      <div id="sheet-header" style="margin-top:16px;padding:14px 16px 12px;border-radius:var(--radius-md) var(--radius-md) 0 0;background:var(--color-surface);box-shadow:var(--shadow-sm)"></div>
      <div id="sheet-table"></div>

      <p class="muted" style="font-size:11.5px;margin-top:10px">Base and computed bands are read-only. A line with no base rate on file yet takes its rate typed directly under "New rates" — that becomes its rate going forward. Balancing must be 0 on every line before submission.</p>

      <div class="end" style="margin-top:22px">
        <button class="btn btn-secondary" id="back-btn">Back</button>
        <button class="btn btn-secondary" id="export-btn">Export to Excel</button>
        <button class="btn btn-primary" id="submit-btn" ${sim.blocked ? 'disabled' : ''}>Submit for Approval</button>
      </div>
    </div>
  `;

  if (sim.blocked) {
    container.querySelector('#blocked-banner').innerHTML = `
      <div class="error-banner">
        <span class="error-banner-dot">●</span>
        <span>One or more rate lines have no rate on file — their balancing column reads <span class="num">!</span>. Type a rate for each under "New rates · rounded" to resolve it before submitting.</span>
      </div>
    `;
  }

  const vendorSelect = container.querySelector('#sim-vendor');
  const upliftFactorEl = container.querySelector('#uplift-factor');
  const sheetHeaderEl = container.querySelector('#sheet-header');
  const sheetTableEl = container.querySelector('#sheet-table');

  function renderVendor(vendorId) {
    activeVendorId = vendorId;
    const v = sim.vendors.find((v) => v.id === vendorId);
    const sheet = sim.worksheets[vendorId];
    upliftFactorEl.textContent = pct(v.upliftPct, 4);
    sheetHeaderEl.innerHTML = `
      <div style="font-family:var(--font-heading);font-size:17px">${escapeHtml(sheet.title)}</div>
      <div style="font-size:12.5px;color:color-mix(in srgb,var(--color-text) 65%,transparent)">Annexure ${escapeHtml(sheet.annexure)}</div>
      <div class="num" style="font-size:12.5px;color:color-mix(in srgb,var(--color-text) 65%,transparent)">Freight rates w.e.f. ${escapeHtml(sim.effectiveDate)}</div>
    `;
    sheetTableEl.innerHTML = worksheetTable(sheet);
  }
  renderVendor(activeVendorId);
  vendorSelect.addEventListener('change', () => renderVendor(vendorSelect.value));

  sheetTableEl.addEventListener('change', (e) => {
    if (!e.target.matches('input[data-row]')) return;
    const row = Number(e.target.dataset.row);
    const col = Number(e.target.dataset.col);
    overrides[activeVendorId] = overrides[activeVendorId] || {};
    overrides[activeVendorId][row] = overrides[activeVendorId][row] || {};
    overrides[activeVendorId][row][col] = e.target.value;
    reresimulate();
  });

  async function reresimulate() {
    try {
      const newSim = await simulateRevision({
        dieselPrice: draft.dieselPrice,
        effectiveDate: draft.effectiveDate,
        vendorIds: draft.vendorIds,
        overrides,
      });
      render(container, draft, newSim, overrides, reload, activeVendorId);
    } catch (err) {
      toast(err.message || 'Could not recompute.', 'error');
    }
  }

  container.querySelector('#back-btn').addEventListener('click', () => { location.hash = '#/vendors'; });
  container.querySelector('#export-btn').addEventListener('click', () => {
    toast('Export to Excel isn’t available yet.', 'info');
  });

  const submitBtn = container.querySelector('#submit-btn');
  submitBtn.addEventListener('click', async () => {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';
    try {
      const session = getSession();
      const result = await submitForApproval({
        dieselPrice: draft.dieselPrice,
        dieselEffectiveDate: draft.dieselEffectiveDate,
        effectiveDate: draft.effectiveDate,
        fuelType: draft.fuelType,
        source: draft.source,
        notificationId: draft.notificationId,
        notificationFileName: draft.notificationFileName,
        remarks: draft.remarks,
        vendorIds: draft.vendorIds,
        overrides,
        submittedBy: { employeeId: session.employeeId, name: session.name },
      });
      clearDraft();
      toast(`Revision ${result.revisionNo} submitted for approval.`, 'success');
      location.hash = '#/diesel-price';
    } catch (err) {
      toast(err.message || 'Submission failed.', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit for Approval';
    }
  });
}
