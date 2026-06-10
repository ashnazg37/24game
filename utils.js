// ── COPY TO CLIPBOARD ─────────────────────────────────────────
// The textarea approach is universally reliable.
// The key fix: use el.style.cssText = "..." not el.style = "..."
// (el.style is a CSSStyleDeclaration object, not a string)
export function copyText(text, btn, label) {
  const el = document.createElement("textarea");
  el.value = text;
  el.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
  document.body.appendChild(el);
  el.focus();
  el.select();

  let ok = false;
  try { ok = document.execCommand("copy"); } catch {}
  document.body.removeChild(el);

  const restore = () => setTimeout(() => { btn.textContent = label; }, 2000);

  if (ok) {
    btn.textContent = "Copied!"; restore();
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text)
      .then(() => { btn.textContent = "Copied!"; restore(); })
      .catch(() => { btn.textContent = "Failed"; restore(); });
  } else {
    btn.textContent = "Failed"; restore();
  }
}

// ── DARK / LIGHT THEME ────────────────────────────────────────
export function initTheme() {
  // The inline <script> in <head> already set data-theme from localStorage.
  // This just makes sure the toggle button icon is correct on load.
  updateIcon();
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("theme", next);
  updateIcon();
}

function updateIcon() {
  const btn = document.getElementById("theme-btn");
  if (!btn) return;
  const dark = document.documentElement.dataset.theme !== "light";
  btn.textContent = dark ? "☀" : "☾";
  btn.title       = dark ? "Switch to light mode" : "Switch to dark mode";
}