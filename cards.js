// Shared card rendering module for game.js and practice.js
// Uses inline styles exclusively — zero CSS dependency

const BASE_CARD = [
  "box-sizing:border-box",
  "border-radius:12px",
  "display:flex",
  "align-items:center",
  "justify-content:center",
  "cursor:pointer",
  "transition:opacity 0.15s,transform 0.15s",
  "overflow:hidden",
  "user-select:none",
  "-webkit-user-select:none",
  "font-family:'Bebas Neue',sans-serif",
].join(";") + ";";

// Solid backgrounds — no opacity tricks that could make cards invisible
const STYLE = {
  idle:    BASE_CARD + "background:#0d3d48;color:#67e8f9;border:2px solid #67e8f9;font-size:2.8rem;",
  result:  BASE_CARD + "background:#1a1040;color:#a5b4fc;border:2px solid #818cf8;font-size:2.4rem;",
  ops:     BASE_CARD + "background:#1a1a2e;border:2px solid #818cf8;cursor:default;padding:0;",
  pending: BASE_CARD + "background:#1a1040;color:#a5b4fc;border:2px solid #818cf8;font-size:2.2rem;flex-direction:column;gap:4px;",
  pick2c:  BASE_CARD + "background:#0d3d48;color:#67e8f9;border:2px solid #67e8f9;font-size:2.8rem;",
  pick2a:  BASE_CARD + "background:#1a1040;color:#a5b4fc;border:2px solid #818cf8;font-size:2.4rem;",
  empty:   BASE_CARD + "background:#111;border:2px dashed #333;cursor:default;opacity:0.35;",
};

export function fmt(v) {
  if (Number.isInteger(v)) return String(v);
  return String(parseFloat(v.toFixed(3)));
}

export function renderCards(gridId, cards, selectedIdx, selectedOp, onSelect, onOp, onCombine) {
  const grid = document.getElementById(gridId);
  if (!grid) { console.error("renderCards: element #" + gridId + " not found"); return; }

  // Force grid layout via JS so it always applies regardless of CSS
  grid.style.display               = "grid";
  grid.style.gridTemplateColumns   = "1fr 1fr";
  grid.style.gridTemplateRows      = "140px 140px";
  grid.style.gap                   = "10px";
  grid.style.width                 = "100%";
  grid.style.marginBottom          = "14px";
  grid.innerHTML                   = "";

  cards.forEach((card, i) => {
    const div = document.createElement("div");

    if (card.used) {
      div.style.cssText = STYLE.empty;

    } else if (i === selectedIdx && selectedOp === null) {
      div.style.cssText = STYLE.ops;
      div.style.height = "100%";

      // 2×2 operator grid
      const og = document.createElement("div");
      og.style.cssText = "display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;width:100%;height:100%;";
      ["+","−","×","÷"].forEach((sym, idx) => {
        const b = document.createElement("button");
        b.style.cssText = "border:none;background:transparent;font-size:2rem;" +
          "font-family:'Bebas Neue',sans-serif;cursor:pointer;color:#aaa;" +
          "display:flex;align-items:center;justify-content:center;transition:background 0.1s,color 0.1s;";
        const br = "1px solid #333";
        if (idx===0) { b.style.borderRight=br; b.style.borderBottom=br; }
        if (idx===1)   b.style.borderBottom = br;
        if (idx===2)   b.style.borderRight  = br;
        b.textContent = sym;
        b.onmouseenter = () => { b.style.background="#818cf833"; b.style.color="#a5b4fc"; };
        b.onmouseleave = () => { b.style.background="transparent"; b.style.color="#aaa"; };
        b.onclick = e => { e.stopPropagation(); onOp(sym); };
        og.appendChild(b);
      });
      div.appendChild(og);
      div.onclick = () => onSelect(null); // tap again to deselect

    } else if (i === selectedIdx && selectedOp !== null) {
      div.style.cssText = STYLE.pending;
      const ns = document.createElement("span"); ns.textContent = fmt(card.value);
      const os = document.createElement("span");
      os.style.cssText = "font-family:'Space Mono',monospace;font-size:0.8rem;opacity:0.6;";
      os.textContent = selectedOp;
      div.appendChild(ns); div.appendChild(os);

    } else if (selectedOp !== null) {
      div.style.cssText = card.isResult ? STYLE.pick2a : STYLE.pick2c;
      div.textContent = fmt(card.value);
      div.onclick = () => onCombine(i);
      // Pulse via JS interval (no CSS animation dependency)
      let bright = false;
      const pulse = setInterval(() => {
        if (!div.isConnected) { clearInterval(pulse); return; }
        bright = !bright;
        div.style.opacity = bright ? "1" : "0.65";
      }, 400);

    } else {
      div.style.cssText = card.isResult ? STYLE.result : STYLE.idle;
      div.textContent = fmt(card.value);
      div.onmouseenter = () => { div.style.transform="translateY(-2px)"; div.style.opacity="0.85"; };
      div.onmouseleave = () => { div.style.transform=""; div.style.opacity="1"; };
      div.onclick = () => onSelect(i);
    }

    grid.appendChild(div);
  });

  // Update hint
  const hint = document.getElementById("card-hint");
  if (hint) {
    if      (selectedIdx===null) hint.textContent = "Pick a number";
    else if (selectedOp ===null) hint.textContent = "Choose an operation";
    else                         hint.textContent = "Pick a second number";
  }
}