const TOKEN_KEY = '24game_token';
const USER_KEY  = '24game_user';

export function getSession() {
  const token = localStorage.getItem(TOKEN_KEY);
  const raw   = localStorage.getItem(USER_KEY);
  if (!token || !raw) return null;
  try {
    return { token, user: JSON.parse(raw) };
  } catch {
    return null;
  }
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// Redirects to index.html if there is no valid session.
// Saves the current URL so auth.js can restore it after login.
// Returns the session object if authenticated.
export function requireAuth() {
  const session = getSession();
  if (!session) {
    sessionStorage.setItem('redirectAfterLogin', window.location.href);
    window.location.href = 'index.html';
    return null;
  }
  return session;
}
