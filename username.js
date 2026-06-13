import { requireAuth, getSession, setSession } from './session.js';

const session = requireAuth();
if (!session) throw new Error('redirecting');

const { token, user } = session;

// If user already has username in localStorage, redirect immediately
if (user.username) {
  window.location.href = 'dashboard.html';
  throw new Error('redirecting');
}

// Check server in case localStorage is stale (e.g., set on another device)
(async () => {
  try {
    const r = await fetch('/api/players/me', { headers: { Authorization: `Bearer ${token}` } });
    const { user: srv } = await r.json();
    if (srv?.username) {
      setSession(token, { ...user, username: srv.username });
      window.location.href = 'dashboard.html';
    }
  } catch {}
})();

const input  = document.getElementById('username-input');
const status = document.getElementById('username-status');
const btn    = document.getElementById('confirm-btn');

btn.disabled = true;

const VALID = /^[a-z0-9_-]{3,20}$/;
let debounceTimer = null;
let lastChecked = null;
let isAvailable = false;

input.addEventListener('input', () => {
  const val = input.value.toLowerCase().trim();
  clearTimeout(debounceTimer);
  btn.disabled = true;
  isAvailable = false;

  if (!VALID.test(val)) {
    status.textContent = val.length > 0 ? 'Must be 3–20 chars: a-z 0-9 _ -' : '';
    status.style.color = 'var(--danger)';
    return;
  }

  status.textContent = 'Checking…';
  status.style.color = 'var(--muted)';

  debounceTimer = setTimeout(async () => {
    if (lastChecked === val) return;
    lastChecked = val;
    try {
      const r = await fetch(`/api/auth/check-username/${encodeURIComponent(val)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const { available } = await r.json();
      if (input.value.toLowerCase().trim() !== val) return; // stale
      isAvailable = available;
      if (available) {
        status.textContent = `@${val} is available`;
        status.style.color = 'var(--success)';
        btn.disabled = false;
      } else {
        status.textContent = `@${val} is taken`;
        status.style.color = 'var(--danger)';
        btn.disabled = true;
      }
    } catch {
      status.textContent = 'Could not check availability';
      status.style.color = 'var(--danger)';
    }
  }, 400);
});

btn.addEventListener('click', async () => {
  if (btn.disabled) return;
  const val = input.value.toLowerCase().trim();
  btn.disabled = true;
  btn.textContent = 'Saving…';

  try {
    const r = await fetch('/api/auth/username', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify({ username: val })
    });
    const data = await r.json();
    if (!r.ok) {
      status.textContent = data.error || 'Could not save username';
      status.style.color = 'var(--danger)';
      btn.disabled = false;
      btn.textContent = 'Confirm';
      return;
    }
    // Update localStorage and redirect
    setSession(token, { ...user, username: data.username });
    window.location.href = 'dashboard.html';
  } catch {
    status.textContent = 'Network error — please try again';
    status.style.color = 'var(--danger)';
    btn.disabled = false;
    btn.textContent = 'Confirm';
  }
});
