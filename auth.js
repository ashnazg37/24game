import { getSession } from './session.js';

// Already logged in — skip to dashboard (or the originally-requested page)
const existing = getSession();
if (existing) {
  const redirect = sessionStorage.getItem('redirectAfterLogin');
  sessionStorage.removeItem('redirectAfterLogin');
  window.location.replace(redirect || 'dashboard.html');
}

async function init() {
  let googleClientId;
  try {
    const res = await fetch('/api/config');
    ({ googleClientId } = await res.json());
  } catch {
    showError('Could not load sign-in config. Is the server running?');
    return;
  }

  // ux_mode:'redirect' — no popup. Google redirects the page to sign-in,
  // then POSTs the credential to login_uri. Avoids all popup/iframe issues.
  google.accounts.id.initialize({
    client_id:  googleClientId,
    ux_mode:    'redirect',
    login_uri:  `${window.location.origin}/api/auth/google-redirect`
  });

  google.accounts.id.renderButton(
    document.getElementById('sign-in-btn'),
    { theme: 'filled_black', size: 'large', text: 'signin_with', shape: 'rectangular' }
  );
}

function showError(msg) {
  let el = document.getElementById('auth-error');
  if (!el) {
    el = Object.assign(document.createElement('p'), { id: 'auth-error' });
    el.style.cssText = 'color:var(--danger);font-size:0.85rem;margin-top:16px;';
    document.querySelector('.landing-card').appendChild(el);
  }
  el.textContent = msg;
}

// GIS script has defer, module scripts also defer — document order guarantees
// google.accounts is available by the time this module executes.
init();
