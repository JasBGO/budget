// Sheets, toasts and icons shared by every screen.
import { esc } from "./util.js";

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1.2"/><circle cx="3.5" cy="12" r="1.2"/><circle cx="3.5" cy="18" r="1.2"/>',
  pie: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  face: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9v1M15 9v1M12 9v4h-1M9 16c1.7 1.3 4.3 1.3 6 0"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  bill: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  bank: '<path d="M3 9.5 12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20.5h18"/>'
};
export function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name]}</svg>`;
}

// One sheet at a time. `mount` wires up the sheet's own inputs; returns a close function.
let current = null;
export function sheet(title, html, mount) {
  closeSheet();
  const bg = document.createElement("div");
  bg.className = "sheet-bg";
  bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${icon("close")}</button></div>
    <div class="sheet-body">${html}</div></div>`;
  bg.addEventListener("click", e => { if (e.target === bg || e.target.closest("[data-close]")) closeSheet(); });
  document.body.appendChild(bg);
  current = bg;
  const body = bg.querySelector(".sheet-body");
  mount?.(body, closeSheet);
  return body;
}
export function closeSheet() { current?.remove(); current = null; }
export const sheetOpen = () => !!current;

// A confirmation inside the page (the iPhone home-screen app has no confirm() dialogs worth using).
export function confirmSheet(title, text, yesLabel, onYes, danger = true) {
  sheet(title, `<p style="margin:0">${esc(text)}</p>
    <button class="btn block ${danger ? "danger" : "primary"}" data-yes>${esc(yesLabel)}</button>
    <button class="btn block" data-close>Cancel</button>`, (b, close) => {
    b.querySelector("[data-yes]").onclick = () => { close(); onYes(); };
  });
}

let toastTimer;
export function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2600);
}

export function meter(ratio, cls, pace) {
  const w = Math.max(0, Math.min(1, ratio || 0)) * 100;
  return `<div class="meter"><i class="${cls || ""}" style="width:${w}%"></i>${pace != null ? `<span class="pace" style="left:${pace * 100}%"></span>` : ""}</div>`;
}
export function levelOf(spent, budget, warnPct = 0.8) {
  if (!(budget > 0)) return spent > 0 ? "" : "";
  const r = spent / budget;
  return r >= 1 ? "over" : r >= warnPct ? "warn" : "";
}
export function initials(name) {
  const w = String(name || "?").replace(/[^A-Za-z0-9 ]/g, "").trim().split(/\s+/);
  return ((w[0]?.[0] || "?") + (w[1]?.[0] || "")).toUpperCase();
}

// Minimal, safe rendering of Claude's answers: headings, bullets, bold, paragraphs.
export function renderAnswer(text) {
  const out = []; let list = false;
  const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  const lines = text.replace(/```json[\s\S]*?(```|$)/g, "").split("\n");
  for (const raw of lines) {
    const l = raw.trim();
    if (/^[-*•] /.test(l)) { if (!list) { out.push("<ul>"); list = true; } out.push("<li>" + inline(l.slice(2)) + "</li>"); continue; }
    if (list) { out.push("</ul>"); list = false; }
    if (!l) continue;
    if (/^#{1,4} /.test(l)) out.push("<h4>" + inline(l.replace(/^#+ /, "")) + "</h4>");
    else out.push("<p>" + inline(l) + "</p>");
  }
  if (list) out.push("</ul>");
  return out.join("");
}
