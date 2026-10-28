// Numbers behind every screen. Pure functions over the app data.
import { addDays, daysBetween, daysInMonth, monthOf, monthStart, monthEnd, addMonths, todayStr, median, sum, round2, parseDate, fmtDate } from "./util.js";

// Amounts: positive = money out. kind: "spend" counts toward budgets, "income" is money in,
// "transfer" (card payments, moving money between your own accounts) is ignored.
export function spendIn(d, start, end, acct) {
  return d.txns.filter(t => t.kind === "spend" && t.date >= start && t.date <= end && (!acct || t.acct === acct));
}
export function txnsIn(d, start, end, acct) {
  return d.txns.filter(t => t.date >= start && t.date <= end && (!acct || t.acct === acct))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.ts || 0) - (a.ts || 0));
}
export function totalBudget(d) { return sum(d.categories, c => +c.budget || 0); }

// Budget for a date range, prorated day by day from the monthly amounts.
export function budgetFor(d, start, end, catId) {
  const monthly = catId ? (+d.categories.find(c => c.id === catId)?.budget || 0) : totalBudget(d);
  if (!monthly) return 0;
  let t = 0;
  for (let x = start; x <= end; x = addDays(x, 1)) t += monthly / daysInMonth(x);
  return t;
}

export function byCategory(items) {
  const m = {};
  for (const t of items) m[t.cat] = (m[t.cat] || 0) + t.amt;
  return m;
}

// "Safe to spend today": what's left of this month's budget, spread evenly over the days left,
// minus what has already gone out today.
export function safeToday(d) {
  const today = todayStr(), ms = monthStart(today), me = monthEnd(today);
  const budget = totalBudget(d);
  const before = sum(spendIn(d, ms, addDays(today, -1)), t => t.amt);
  const spentToday = sum(spendIn(d, today, today), t => t.amt);
  const daysLeft = daysBetween(today, me);
  const perDay = (budget - before) / daysLeft;
  return { budget, perDay, spentToday, safe: perDay - spentToday, daysLeft, monthSpent: before + spentToday };
}

// Categories at or past the alert threshold this month.
export function alerts(d) {
  const today = todayStr(), ms = monthStart(today);
  const spent = byCategory(spendIn(d, ms, today));
  const pct = (d.settings.alertPct || 80) / 100;
  const out = [];
  for (const c of d.categories) {
    if (!(+c.budget > 0)) continue;
    const s = spent[c.id] || 0, r = s / c.budget;
    if (r >= 1) out.push({ cat: c, spent: s, level: "over", ratio: r });
    else if (r >= pct) out.push({ cat: c, spent: s, level: "warn", ratio: r });
  }
  return out.sort((a, b) => b.ratio - a.ratio);
}

// ---------- Bills and card due dates ----------
function nextDue(dueDay, from) {
  const f = parseDate(from);
  for (let i = 0; i < 2; i++) {
    const y = f.getFullYear(), m = f.getMonth() + i;
    const dim = new Date(y, m + 1, 0).getDate();
    const d = fmtDate(new Date(y, m, Math.min(dueDay, dim)));
    if (d >= from) return d;
  }
}
export function upcoming(d, days = 14) {
  const today = todayStr(), until = addDays(today, days), out = [];
  for (const b of d.bills) {
    if (!b.dueDay) continue;
    const due = nextDue(+b.dueDay, today);
    if (due > until) continue;
    out.push({ kind: "bill", id: b.id, name: b.name, amount: +b.amount || 0, due, paid: b.paidFor === monthOf(due) });
  }
  for (const a of d.accounts) {
    if (a.type !== "credit" || !a.dueDay) continue;
    const due = nextDue(+a.dueDay, today);
    if (due > until) continue;
    out.push({ kind: "card", id: a.id, name: a.name + " payment", amount: +a.minPay || 0, balance: +a.balance || 0, due, paid: a.paidFor === monthOf(due) });
  }
  return out.sort((x, y) => x.due.localeCompare(y.due));
}

// ---------- Merchants ----------
const PREFIX = /^(POS |DEBIT CARD PURCHASE |DEBIT PURCHASE |PURCHASE AUTHORIZED ON \d\d\/\d\d |PURCHASE |CHECKCARD \d* ?|CARD PURCHASE |RECURRING PAYMENT |PREAUTHORIZED DEBIT |ACH DEBIT |SQ ?\*|TST\* ?|PAYPAL \*|PP\*|IN \*|SP \* ?|DD \*|APL\* ?|AMZN MKTP |)/;
const STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC ON BC AB QC".split(" "));
export function merchantOf(desc) {
  const up = String(desc || "").toUpperCase().trim();
  if (/AMZN|AMAZON/.test(up)) return /PRIME/.test(up) ? "Amazon Prime" : "Amazon";
  if (/^APPLE\.COM|^APPLE COM|^APL\*/.test(up)) return "Apple";
  let s = up.replace(PREFIX, "");
  s = s.replace(/https?:\/\/\S+/g, " ").replace(/\.(COM|NET|ORG|CO)\b/g, " ").replace(/[#*]\s*\d+/g, " ").replace(/\b\d[\d-]{2,}\b/g, " ")
    .replace(/\bX{2,}\d*\b/g, " ").replace(/\b(INC|LLC|LTD|STORE|ACH|PAYMENTS?|PMT|ONLINE|AUTOPAY|DEBIT|POS|PURCHASE)\b\.?/g, " ")
    .replace(/[^A-Z&' ]/g, " ").replace(/\s+/g, " ").trim();
  let words = s.split(" ").filter(w => w.length > 1 || w === "&");
  // Drop a trailing "CITY ST" location.
  if (words.length >= 2 && (STATES.has(words[words.length - 1]) || /^(US|USA)$/.test(words[words.length - 1]))) {
    words.pop();
    if (words.length >= 2) words.pop();
  }
  words = words.slice(0, 3);
  const name = words.join(" ") || String(desc || "").trim().slice(0, 24) || "Unknown";
  return name.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()).replace(/'S\b/g, "'s");
}

// Spending in a window, as monthly averages. `months` back from today (0 = everything).
export function windowRange(d, months) {
  const today = todayStr();
  const first = d.txns.reduce((m, t) => (t.date < m ? t.date : m), today);
  let start = months ? addDays(addMonths(today, -months + 1), 0) : first;
  if (months) start = monthStart(start);
  if (start < first) start = first;
  const days = Math.max(14, daysBetween(start, today));
  return { start, end: today, monthsSpan: days / 30.44 };
}

export function insights(d, months) {
  const { start, end, monthsSpan } = windowRange(d, months);
  const items = spendIn(d, start, end);
  const total = sum(items, t => t.amt);
  const perMonth = total / monthsSpan;
  const cats = byCategory(items);
  const catRows = d.categories.map(c => ({ cat: c, avg: (cats[c.id] || 0) / monthsSpan, budget: +c.budget || 0 }))
    .filter(r => r.avg > 0 || r.budget > 0).sort((a, b) => b.avg - a.avg);

  const byM = {};
  for (const t of items) {
    const k = t.merchant || merchantOf(t.desc);
    (byM[k] ||= { merchant: k, total: 0, count: 0, amts: [], months: new Set(), cat: t.cat });
    byM[k].total += t.amt; byM[k].count++; byM[k].amts.push(t.amt); byM[k].months.add(monthOf(t.date));
  }
  const merchants = Object.values(byM).map(m => ({ ...m, perMonth: m.total / monthsSpan }))
    .sort((a, b) => b.total - a.total);

  const small = merchants.filter(m => m.count >= 6 && m.total / m.count <= 15)
    .sort((a, b) => b.perMonth - a.perMonth).slice(0, 6);

  const income = sum(d.txns.filter(t => t.kind === "income" && t.date >= start && t.date <= end), t => -t.amt) / monthsSpan;

  // Month-by-month totals for the chart (last 6 months that have data).
  const monthly = [];
  for (let m = monthStart(start); m <= end; m = addMonths(m, 1)) {
    const me = monthEnd(m);
    monthly.push({ month: m, total: sum(spendIn(d, m, me), t => t.amt) });
  }

  return { start, end, monthsSpan, total, perMonth, catRows, merchants, top: merchants.slice(0, 8), small, recurring: recurring(d), income, monthly: monthly.slice(-12) };
}

// Charges that repeat each month at about the same price: subscriptions, memberships, plans.
export function recurring(d) {
  const groups = {};
  for (const t of d.txns) {
    if (t.kind !== "spend" || t.amt <= 0) continue;
    const k = t.merchant || merchantOf(t.desc);
    (groups[k] ||= []).push(t);
  }
  const out = [];
  for (const [merchant, list] of Object.entries(groups)) {
    const months = new Set(list.map(t => monthOf(t.date)));
    if (months.size < 2) continue;
    if (list.length > months.size * 1.5) continue; // several a month: a habit, not a subscription
    const amts = list.map(t => t.amt), med = median(amts);
    const close = amts.filter(a => Math.abs(a - med) <= Math.max(1, med * 0.15)).length;
    if (close / amts.length < 0.75) continue;
    const last = list.reduce((m, t) => (t.date > m ? t.date : m), "");
    if (daysBetween(last, todayStr()) > 45) continue; // looks cancelled
    out.push({ merchant, amount: round2(med), months: months.size, last, cat: list[list.length - 1].cat });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

// A budget built from what you actually spend: needs at their average, wants trimmed 15%,
// and if that still costs more than your income, wants are cut further (to half at most).
export function suggestBudget(d, months = 3) {
  const ins = insights(d, months);
  const avg = Object.fromEntries(ins.catRows.map(r => [r.cat.id, r.avg]));
  const r5 = x => Math.ceil(x / 5) * 5;
  const out = {};
  let needs = 0, wants = 0;
  for (const c of d.categories) {
    const a = avg[c.id] || 0;
    if (c.need) { out[c.id] = r5(a); needs += out[c.id]; }
    else { out[c.id] = r5(a * 0.85); wants += out[c.id]; }
  }
  const income = +d.settings.income || ins.income;
  const room = income ? income * 0.9 - needs : Infinity;
  if (income && wants > room && wants > 0) {
    const f = Math.max(0.5, room / wants);
    for (const c of d.categories) if (!c.need) out[c.id] = r5((avg[c.id] || 0) * 0.85 * f);
  }
  return { budget: out, basis: ins };
}

// ---------- Card payoff ----------
// Pay every card's minimum, put the rest on the highest-interest card first (the avalanche method).
export function payoffPlan(cards, monthly) {
  let bal = cards.map(c => ({ id: c.id, name: c.name, b: +c.balance || 0, r: (+c.apr || 0) / 1200, min: +c.minPay || Math.max(25, (+c.balance || 0) * 0.02) }))
    .filter(c => c.b > 0);
  if (!bal.length) return { months: 0, interest: 0, order: [], ok: true };
  const mins = sum(bal, c => Math.min(c.min, c.b));
  if (monthly < mins) return { ok: false, needed: mins };
  let months = 0, interest = 0; const order = [];
  while (bal.some(c => c.b > 0.005) && months < 600) {
    months++;
    for (const c of bal) { const i = c.b * c.r; interest += i; c.b += i; }
    let left = monthly;
    for (const c of bal) { const p = Math.min(c.b, c.min); c.b -= p; left -= p; }
    for (const c of [...bal].sort((x, y) => y.r - x.r)) { if (left <= 0) break; const p = Math.min(c.b, left); c.b -= p; left -= p; }
    for (const c of bal) if (c.b <= 0.005 && !order.find(o => o.id === c.id)) order.push({ id: c.id, name: c.name, month: months });
  }
  if (months >= 600) return { ok: false, never: true };
  return { ok: true, months, interest, order };
}

export function goalMonthly(g) {
  const left = Math.max(0, (+g.target || 0) - (+g.saved || 0));
  if (!g.by) return null;
  const months = Math.max(1, (parseDate(g.by) - parseDate(todayStr())) / (864e5 * 30.44));
  return left / months;
}
