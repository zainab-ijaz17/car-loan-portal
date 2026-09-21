import { getSession, hasRole, clearSession } from '../session.js';
import { escapeHtml, initials } from '../ui.js';

const NAV_ITEMS = [
  { path: '/diesel-price', num: '1', label: 'Enter diesel price', roles: ['Rate Maintainer'] },
  { path: '/vendors', num: '2', label: 'Select vendors', roles: ['Rate Maintainer'] },
  { path: '/review', num: '3', label: 'Review before / after', roles: ['Rate Maintainer'] },
  { path: '/approve', num: '4', label: 'Approve and release', roles: ['Approver'] },
  { path: '/lookup', num: '5', label: 'Rate lookup', roles: ['Rate Maintainer', 'Approver', 'Display'] },
  { path: '/admin', num: '6', label: 'Master data', roles: ['Administrator'] },
];

export function renderShell(appRoot, { activePath, screenTitle, roleLabel }) {
  const session = getSession();
  const items = NAV_ITEMS.filter((item) => item.roles.some((r) => hasRole(r)));

  appRoot.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div>
          <div class="sidebar-brand">Freight Rates</div>
          <div class="sidebar-sub">Diesel-indexed · PKR</div>
        </div>
        <nav class="sidebar-nav">
          ${items.map((item) => `
            <button class="rail-item${item.path === activePath ? ' active' : ''}" data-nav="${item.path}">
              <span class="rail-item-num num">${item.num}</span>
              <span>${escapeHtml(item.label)}</span>
            </button>
          `).join('')}
        </nav>
        <div class="sidebar-foot">Freight Rate Portal<br>Approval separation enforced</div>
      </aside>
      <main class="main">
        <header class="topbar">
          <div class="topbar-title">${escapeHtml(screenTitle || '')}</div>
          <span class="tag tag-neutral">${escapeHtml(roleLabel || '')}</span>
          <div class="row-gap">
            <span style="font-size:13px">${escapeHtml(session?.name || '')}</span>
            <span class="avatar">${escapeHtml(session ? initials(session.name) : '')}</span>
          </div>
          <button class="btn btn-ghost" data-action="logout">Log out</button>
        </header>
        <div class="screen" id="screen-root"></div>
      </main>
    </div>
  `;

  appRoot.querySelectorAll('[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => { location.hash = '#' + btn.dataset.nav; });
  });
  appRoot.querySelector('[data-action="logout"]').addEventListener('click', () => {
    clearSession();
    location.hash = '#/login';
  });
}
