// Small render/formatting helpers shared by every screen. No framework —
// screens build HTML strings and wire listeners after inserting them.

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function money(n) {
  return Number(n).toLocaleString('en-US');
}

// Diesel price is entered and stored to 3 decimals (Section 5); every
// other currency amount in the portal is a whole-rupee rate line, which
// uses money() instead.
export function priceStr(n) {
  return Number(n).toFixed(3);
}

export function pct(n, decimals = 2) {
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(decimals)}%`;
}

export function initials(name) {
  return name.trim().split(/\s+/).slice(-1)[0].slice(0, 2).toUpperCase();
}

// Dates travel through the app as 'DD.MM.YYYY' strings (matching the rest
// of the portal's data), converted from/to <input type="date">'s
// 'YYYY-MM-DD' only at the form boundary.
export function isoToDisplayDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function displayToIsoDate(display) {
  if (!display) return '';
  const [d, m, y] = display.split('.');
  return `${y}-${m}-${d}`;
}

export function parseDisplayDate(display) {
  const [d, m, y] = display.split('.').map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetween(displayA, displayB) {
  const ms = parseDisplayDate(displayA) - parseDisplayDate(displayB);
  return Math.round(ms / 86400000);
}

// --- loading / error / empty state blocks, for screens to drop into a
// container while a fetch is in flight or has failed ---

export function loadingBlock(label = 'Loading…') {
  return `<div class="state-block"><div class="spinner"></div><div class="muted">${escapeHtml(label)}</div></div>`;
}

export function errorBlock(err, { retryLabel = 'Retry' } = {}) {
  const message = err?.message || 'Something went wrong.';
  return `
    <div class="error-banner" style="margin-top:0">
      <span class="error-banner-dot">●</span>
      <span>${escapeHtml(message)}</span>
    </div>
    <button class="btn btn-secondary" style="margin-top:12px" data-action="retry">${escapeHtml(retryLabel)}</button>
  `;
}

/**
 * Runs an async loader, rendering a spinner into `container` while it's in
 * flight and an error banner (with a working Retry button) if it rejects.
 * On success calls `render(data)` to draw the real screen content.
 */
export async function withAsyncState(container, loader, render, opts) {
  container.innerHTML = loadingBlock(opts?.loadingLabel);
  try {
    const data = await loader();
    render(data);
  } catch (err) {
    container.innerHTML = errorBlock(err, opts);
    container.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
      withAsyncState(container, loader, render, opts);
    });
  }
}

// --- toast ---

function toastRoot() {
  let root = document.getElementById('toast-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'toast-root';
    document.body.appendChild(root);
  }
  return root;
}

export function toast(message, type = 'info', timeoutMs = 4000) {
  const root = toastRoot();
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' toast-error' : type === 'success' ? ' toast-success' : ''}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), timeoutMs);
}

// --- dialog ---
// A single backdrop mounted once in index.html (#dialog-root). openDialog
// replaces its content and shows it; closeDialog hides it. Screens attach
// their own listeners to the buttons they render inside `bodyHtml`.

export function openDialog(bodyHtml) {
  const root = document.getElementById('dialog-root');
  root.innerHTML = `<div class="dialog-backdrop"><div class="dialog">${bodyHtml}</div></div>`;
  root.hidden = false;
  return root;
}

export function closeDialog() {
  const root = document.getElementById('dialog-root');
  if (root) {
    root.hidden = true;
    root.innerHTML = '';
  }
}
