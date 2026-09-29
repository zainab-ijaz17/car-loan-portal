import { login, chooseRole } from '../api/authApi.js';
import { setSession } from '../session.js';
import { defaultRouteForSession } from '../router.js';
import { escapeHtml, showInlineError } from '../ui.js';

export const title = 'Sign in';

export function mount(container) {
  const controller = new AbortController();
  renderCredentialsStep(container, controller);
  return () => controller.abort();
}

function renderCredentialsStep(container, controller) {
  container.innerHTML = `
    <div class="login-page">
      <form class="login-card card elev-md" id="login-form" style="padding:28px">
        <div>
          <div class="login-brand">Freight Rates</div>
          <div class="muted" style="font-size:13px;margin-top:2px">Sign in with your SAP employee ID</div>
        </div>
        <div class="login-form">
          <div class="field">
            <label for="employeeId">Employee ID</label>
            <input class="input" id="employeeId" name="employeeId" autocomplete="username" required>
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input class="input" id="password" name="password" type="password" autocomplete="current-password" required>
          </div>
          <div id="login-error" class="inline-error" hidden></div>
          <button class="btn btn-primary btn-block" type="submit" id="login-submit">Log in</button>
        </div>
      </form>
    </div>
  `;

  const form = container.querySelector('#login-form');
  const errorEl = container.querySelector('#login-error');
  const submitBtn = container.querySelector('#login-submit');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.hidden = true;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Signing in…';

    const employeeId = form.employeeId.value.trim();
    const password = form.password.value;

    try {
      const profile = await login(employeeId, password);
      if (!profile.activeRole) {
        renderRoleChoiceStep(container, controller, profile);
      } else {
        setSession({ employeeId: profile.employeeId, name: profile.name, role: profile.activeRole, token: profile.token });
        location.hash = defaultRouteForSession();
      }
    } catch (err) {
      showInlineError(errorEl, err, 'Sign in failed.');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Log in';
    }
  }, { signal: controller.signal });
}

// Accounts with more than one assigned role (see server/roles.js) pick
// which one to use for the session here, since everything downstream
// (router.js's route guards, session.hasRole) works off a single active role.
function renderRoleChoiceStep(container, controller, profile) {
  container.innerHTML = `
    <div class="login-page">
      <form class="login-card card elev-md" id="role-form" style="padding:28px">
        <div>
          <div class="login-brand">Freight Rates</div>
          <div class="muted" style="font-size:13px;margin-top:2px">Signed in as ${escapeHtml(profile.name)} · choose a role</div>
        </div>
        <div class="login-form">
          <div class="field">
            <label for="role">Role</label>
            <select class="input" id="role" name="role" required>
              ${profile.roles.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('')}
            </select>
          </div>
          <div id="role-error" class="inline-error" hidden></div>
          <button class="btn btn-primary btn-block" type="submit">Continue</button>
        </div>
      </form>
    </div>
  `;

  const form = container.querySelector('#role-form');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await chooseRole(profile.token, form.role.value);
      setSession({ employeeId: profile.employeeId, name: profile.name, role: form.role.value, token: profile.token });
      location.hash = defaultRouteForSession();
    } catch (err) {
      showInlineError(container.querySelector('#role-error'), err, 'Could not set the role.');
    }
  }, { signal: controller.signal });
}
