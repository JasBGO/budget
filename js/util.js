// Small shared helpers: dates as local "YYYY-MM-DD" strings, money, HTML escaping.

export const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const pad = n => String(n).padStart(2, "0");
export const fmtDate = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
export const todayStr = () => fmtDate(new Date());
export function parseDate(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
export function addDays(s, n) { const d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); }
export function addMonths(s, n) { const d = parseDate(s); return fmtDate(new Date(d.getFullYear(), d.getMonth() + n, 1)); }
export function daysInMonth(s) { const d = parseDate(s); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
export const monthOf = s => s.slice(0, 7);
export const monthStart = s => s.slice(0, 8) + "01";
export const monthEnd = s => s.slice(0, 8) + pad(daysInMonth(s));
export function weekStart(s) { const d = parseDate(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return fmtDate(d); }
export function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 864e5) + 1; }
export function periodRange(p, anchor) {
  if (p === "day") return [anchor, anchor];
  if (p === "week") { const s = weekStart(anchor); return [s, addDays(s, 6)]; }
  return [monthStart(anchor), monthEnd(anchor)];
}
export function niceDate(s, withYear) {
  const d = parseDate(s);
  return DOW[d.getDay()] + " " + d.getDate() + " " + MON[d.getMonth()] + (withYear ? " " + d.getFullYear() : "");
}
export function monthLabel(s) { const d = parseDate(monthStart(s)); return MON[d.getMonth()] + " " + d.getFullYear(); }
export function relDay(s) {
  const n = daysBetween(todayStr(), s) - 1;
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? "in " + n + " days" : -n + " days ago";
}

let currency = "$";
export function setCurrency(c) { currency = c || "$"; }
export function money(n, dp = 2) {
  const v = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return (n < 0 ? "−" : "") + currency + v;
}
export const round2 = n => Math.round(n * 100) / 100;

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
export const sum = (arr, f = x => x) => arr.reduce((t, x) => t + f(x), 0);
export function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// Base64 helpers that work on large buffers.
export function toB64(buf) {
  const bytes = new Uint8Array(buf); let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromB64(b64) { const s = atob(b64); const out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }

// Offer a file to the person: the iOS share sheet when available (Save to Files, AirDrop),
// otherwise a normal download.
export async function saveFile(name, text, type) {
  const blob = new Blob([text], { type });
  const file = new File([blob], name, { type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return true; }
    catch (e) { if (e.name === "AbortError") return false; }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return true;
}
