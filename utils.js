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
  if (ok) { btn.textContent = "Copied!"; restore(); }
  else if (navigator.clipboard) {
    navigator.clipboard.writeText(text)
      .then(() => { btn.textContent = "Copied!"; restore(); })
      .catch(() => { btn.textContent = "Failed"; restore(); });
  } else { btn.textContent = "Failed"; restore(); }
}