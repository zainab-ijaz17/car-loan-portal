// The notification bell in the top bar: unread count, a drop-down list,
// and a toast when something new arrives while the portal is open. Polls
// every 30 seconds; the shell re-renders on every navigation, so the poll
// timer is module-level and only restarted when the user or role changes.
import { getAlerts, markRead, markAllRead } from '../api/alertsApi.js';
import { getSession } from '../session.js';
import { escapeHtml, formatDateTime, toast } from '../ui.js';

const POLL_MS = 30_000;
const BELL_ICON = '<svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1.2 1.5H2.8L4 11.5Z"/><path d="M6.5 14.5a1.6 1.6 0 0 0 3 0"/></svg>';

let slot = null;
let timer = null;
let state = { unreadCount: 0, items: [] };
let seenIds = null; // ids already known — null until the first fetch, so old ones don't toast
let sessionKey = null;

function tone(kind) {
  if (kind.endsWith('approved')) return 'positive';
  if (kind.endsWith('rejected')) return 'negative';
  if (kind.endsWith('returned')) return 'warning';
  return 'neutral';
}

async function refresh() {
  const session = getSession();
  if (!session) return;
  try {
    state = await getAlerts();
  } catch {
    return; // the bell just keeps its last state; screens surface real errors
  }
  if (seenIds) {
    state.items
      .filter((a) => !a.read && !seenIds.has(a.id))
      .forEach((a) => toast(a.title, tone(a.kind) === 'negative' ? 'error' : 'success', 6000));
  }
  seenIds = new Set(state.items.map((a) => a.id));
  render();
}

function isOpen() {
  const panel = slot?.querySelector('.alerts-panel');
  return !!panel && !panel.hidden;
}

function render(open = isOpen()) {
  if (!slot || !slot.isConnected) return;
  slot.innerHTML = `
    <div class="alerts">
      <button class="btn btn-ghost alerts-bell" aria-label="Notifications${state.unreadCount ? `, ${state.unreadCount} unread` : ''}">
        ${BELL_ICON}${state.unreadCount ? `<span class="alerts-badge num">${state.unreadCount > 9 ? '9+' : state.unreadCount}</span>` : ''}
      </button>
      <div class="alerts-panel card elev-md" ${open ? '' : 'hidden'}>
        <div class="spread" style="margin-bottom:6px">
          <div class="hd">Notifications</div>
          ${state.unreadCount ? '<button class="btn btn-ghost alerts-readall">Mark all read</button>' : ''}
        </div>
        ${state.items.length ? state.items.map((a) => `
          <button class="alert-item alert-${tone(a.kind)}${a.read ? '' : ' unread'}" data-id="${a.id}" data-link="${escapeHtml(a.link || '')}">
            <span class="alert-title">${escapeHtml(a.title)}</span>
            ${a.body ? `<span class="alert-body">${escapeHtml(a.body)}</span>` : ''}
            <span class="alert-time num">${escapeHtml(formatDateTime(a.createdAt))}</span>
          </button>
        `).join('') : '<p class="muted" style="font-size:13px;margin:8px 0">No notifications yet.</p>'}
      </div>
    </div>
  `;
  const panel = slot.querySelector('.alerts-panel');
  slot.querySelector('.alerts-bell').addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
  });
  panel.addEventListener('click', (e) => e.stopPropagation());
  slot.querySelector('.alerts-readall')?.addEventListener('click', async () => {
    await markAllRead().catch(() => {});
    await refresh();
  });
  panel.querySelectorAll('.alert-item').forEach((el) => {
    el.addEventListener('click', () => {
      panel.hidden = true;
      markRead(el.dataset.id).then(refresh).catch(() => {});
      if (el.dataset.link) location.hash = el.dataset.link;
    });
  });
}

document.addEventListener('click', () => {
  const panel = slot?.querySelector('.alerts-panel');
  if (panel) panel.hidden = true;
});

export function mountAlerts(el) {
  slot = el;
  const session = getSession();
  const key = `${session.employeeId}|${session.role}`;
  if (key !== sessionKey) {
    stopAlerts();
    sessionKey = key;
    state = { unreadCount: 0, items: [] };
    timer = setInterval(refresh, POLL_MS);
  }
  render(false);
  refresh();
}

export function stopAlerts() {
  clearInterval(timer);
  timer = null;
  sessionKey = null;
  seenIds = null;
}
