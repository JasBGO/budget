// The five screens and their forms.
import * as store from "./store.js";
import * as A from "./analysis.js";
import * as vault from "./vault.js";
import * as claude from "./claude.js";
import * as imp from "./importer.js";
import { sheet, closeSheet, confirmSheet, toast, icon, meter, levelOf, initials, renderAnswer } from "./ui.js";
import { esc, money, todayStr, addDays, periodRange, niceDate, monthLabel, monthStart, monthEnd, addMonths, daysBetween, relDay, sum, uid, round2, parseDate, MON, DOW, saveFile, weekStart } from "./util.js";

export const ui = { tab: "home", period: "day", anchor: todayStr(), acct: null, search: "", months: 3, chat: [], busy: false, budgetMonth: todayStr(), payoff: null };
const D = () => store.data;
const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
const go = tab => emit("app:go", tab);
const rerender = () => emit("app:render");
const warnPct = () => (D().settings.alertPct || 80) / 100;

function txnRow(t) {
  const c = store.catById(t.cat), a = store.acctById(t.acct);
  const name = t.merchant || t.desc || "Purchase";
  const kindLabel = t.kind === "transfer" ? "Transfer" : t.kind === "income" ? "Money in" : c.name;
  const color = t.kind === "spend" ? c.color : t.kind === "income" ? "var(--ok)" : "#8a968f";
  const amtCls = t.kind === "income" || (t.kind === "spend" && t.amt < 0) ? "in" : t.kind === "transfer" ? "xfer" : "";
  const shown = t.kind === "income" ? "+" + money(-t.amt) : t.amt < 0 ? "+" + money(-t.amt) : money(t.amt);
  return `<button class="item" data-txn="${esc(t.id)}">
    <span class="avatar" style="background:${esc(color)}">${esc(initials(name))}</span>
    <span class="grow"><div class="title">${esc(name)}</div><div class="sub">${esc(kindLabel)} · ${esc(a.name)}${t.note ? " · " + esc(t.note) : ""}</div></span>
    <span class="amt num ${amtCls}">${shown}</span></button>`;
}
function bindTxnRows(root) {
  root.querySelectorAll("[data-txn]").forEach(b => (b.onclick = () => openTxn(D().txns.find(t => t.id === b.dataset.txn))));
}
const topbar = (title, kicker, actions = "") => `<div class="topbar"><div>${kicker ? `<div class="label">${esc(kicker)}</div>` : ""}<h1>${esc(title)}</h1></div><div class="actions">${actions}</div></div>`;

// ====================================================== HOME
// One import slot per statement Jas downloads. Each finds its account by name, or creates it on first use.
const SLOTS = [
  { key: "td", short: "TD", name: "TD Chequing", type: "bank", color: "#2e8540", match: /\btd\b/i, how: "EasyWeb › account › Download" },
  { key: "pc", short: "PC", name: "PC Mastercard", type: "credit", color: "#d93a2b", match: /\bpc\b|president/i, how: "pcfinancial.ca › Transactions › Download" },
  { key: "tri", short: "▲", name: "Triangle Mastercard", type: "credit", color: "#c2477a", match: /triangle|canadian tire|ctfs/i, how: "Triangle app or website › Transactions › Download" }
];
const slotAcct = (d, sl) => d.accounts.find(a => a.slot === sl.key) || d.accounts.find(a => a.type === sl.type && sl.match.test(a.name));
function slotsHtml(d) {
  return `<div class="card"><h2>Add a statement</h2><div class="list">${SLOTS.map(sl => {
    const a = slotAcct(d, sl), ts = a ? d.txns.filter(t => t.acct === a.id && t.key) : [];
    const last = ts.reduce((m, t) => (t.date > m ? t.date : m), "");
    return `<label class="item" style="cursor:pointer"><span class="avatar" style="background:${esc(a?.color || sl.color)};color:#fff">${sl.short}</span>
      <span class="grow"><div class="title">${esc(a?.name || sl.name)}</div><div class="sub">${last ? "Has transactions up to " + esc(niceDate(last, true)) : esc(sl.how)}</div></span>
      <span class="btn small primary">Choose file</span><input type="file" data-slot="${sl.key}" accept=".csv,.ofx,.qfx,.txt,text/csv" hidden></label>`;
  }).join("")}</div></div>`;
}
function bindSlots(root) {
  root.querySelectorAll("[data-slot]").forEach(inp => (inp.onchange = () => {
    const f = inp.files[0], sl = SLOTS.find(x => x.key === inp.dataset.slot);
    if (!f || !sl) return;
    let a = slotAcct(D(), sl);
    if (!a) { a = { id: uid(), name: sl.name, type: sl.type, color: sl.color, slot: sl.key }; store.update(x => { x.accounts.push(a); }); }
    else if (!a.slot) store.update(x => { const y = x.accounts.find(v => v.id === a.id); if (y) y.slot = sl.key; });
    openImport(a.id, f);
  }));
}

const home = {
  html() {
    const d = D(), s = A.safeToday(d), today = todayStr();
    const al = A.alerts(d), up = A.upcoming(d, 14);
    const recent = [...d.txns].sort((a, b) => b.date.localeCompare(a.date) || (b.ts || 0) - (a.ts || 0)).slice(0, 6);
    const steps = [
      [d.accounts.some(a => a.type !== "cash"), "Add your bank accounts and Mastercards", "cards"],
      [d.txns.some(t => t.key), "Import a statement", "import"],
      [s.budget > 0, "Set your monthly budget", "budget"],
      [!!d.settings.apiKey, "Add your Claude key", "settings"]
    ];
    const setup = steps.some(x => !x[0]) ? `<div class="card"><h2>Get set up</h2><div class="list">${steps.map(([ok, label, to]) =>
      `<button class="item" data-to="${to}"><span class="avatar" style="background:${ok ? "var(--ok)" : "var(--surface-2)"};color:${ok ? "#fff" : "var(--muted)"}">${ok ? "✓" : "•"}</span><span class="grow"><div class="title" style="${ok ? "text-decoration:line-through;color:var(--muted)" : ""}">${label}</div></span><span class="muted">›</span></button>`).join("")}</div></div>` : "";
    const ratio = s.budget ? s.monthSpent / s.budget : 0;
    const pace = (daysBetween(monthStart(today), today)) / daysBetween(monthStart(today), monthEnd(today));
    const hero = s.budget > 0 ? `<div class="card hero">
        <div class="label">Safe to spend today</div>
        <div class="big num">${money(Math.max(0, s.safe))}</div>
        <div class="muted small">${s.safe < 0 ? `You're ${money(-s.safe)} over today's share. ` : ""}${money(Math.max(0, s.perDay))} a day for the ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left in ${MON[parseDate(today).getMonth()]}</div>
        <div style="margin-top:8px">${meter(ratio, ratio >= 1 ? "over" : "", pace)}</div>
        <div class="row small"><span>${money(s.monthSpent)} spent this month</span><span>${money(s.budget, 0)} budget</span></div>
      </div>` : `<div class="card hero"><div class="label">Spent today</div><div class="big num">${money(s.spentToday)}</div>
        <div class="muted small">Set a monthly budget to see what's safe to spend each day.</div></div>`;
    const alertsHtml = al.slice(0, 2).map(x => `<div class="banner ${x.level}"><span class="dot" style="background:${esc(x.cat.color)};margin-top:6px"></span><span><b>${esc(x.cat.name)}</b> ${x.level === "over"
      ? `is over budget: ${money(x.spent)} of ${money(+x.cat.budget, 0)}.` : `is at ${Math.round(x.ratio * 100)}% of its ${money(+x.cat.budget, 0)} budget with ${s.daysLeft} days to go.`}</span></div>`).join("")
      + (al.length > 2 ? `<button class="banner info" data-to="budget" style="border:0;text-align:left">${al.length - 2} more categor${al.length === 3 ? "y is" : "ies are"} near or over budget. See Budget ›</button>` : "");
    const upHtml = up.length ? `<div class="card"><div class="row"><h2>Coming up</h2><button class="link" data-to="cards">Bills</button></div><div class="list">${up.map(u => `
      <div class="item"><span class="grow"><div class="title">${esc(u.name)}</div><div class="sub">${u.kind === "statement" ? `Statement closes ${esc(niceDate(u.closes))} · pay by ${esc(relDay(u.due))} to report a low balance` : `${esc(niceDate(u.due))} · ${esc(relDay(u.due))}${u.kind === "card" && u.balance ? " · balance " + money(u.balance, 0) : ""}`}</div></span>
      ${u.paid ? `<span class="pill ok">Paid</span>` : `<span class="amt num">${u.kind === "statement" ? money(u.balance, 0) : u.amount ? money(u.amount) : ""}</span><button class="btn small" data-paid="${u.kind}:${esc(u.id)}:${u.kind === "statement" ? u.closes : u.due.slice(0, 7)}">${u.kind === "statement" ? "Done" : "Paid"}</button>`}</div>`).join("")}</div></div>` : "";
    const [ws, we] = periodRange("week", today);
    const wSpent = sum(A.spendIn(d, ws, we), t => t.amt), wBudget = A.budgetFor(d, ws, we);
    const week = `<div class="grid2">
      <div class="stat"><span class="label">Today</span><b class="num">${money(s.spentToday)}</b><span class="small muted">${A.spendIn(d, today, today).length} purchases</span></div>
      <div class="stat"><span class="label">This week</span><b class="num">${money(wSpent)}</b><span class="small ${wBudget && wSpent > wBudget ? "over" : "muted"}">${wBudget ? (wSpent > wBudget ? money(wSpent - wBudget, 0) + " over" : money(wBudget - wSpent, 0) + " left") : "no budget"}</span></div></div>`;
    const goals = d.goals.length ? `<div class="card"><div class="row"><h2>Savings goals</h2><button class="link" data-to="budget">All</button></div>${d.goals.slice(0, 3).map(g => `
      <div class="stack" style="gap:4px"><div class="row small"><b>${esc(g.name)}</b><span class="num">${money(+g.saved || 0, 0)} of ${money(+g.target || 0, 0)}</span></div>${meter((+g.saved || 0) / (+g.target || 1), "")}</div>`).join("")}</div>` : "";
    return topbar("Hi Jas", niceDate(today), `<button class="icon-btn" data-act="lock" aria-label="Lock">${icon("lock")}</button><button class="icon-btn" data-act="settings" aria-label="Settings">${icon("gear")}</button>`)
      + setup + hero + alertsHtml + slotsHtml(d) + week + upHtml
      + `<div class="card"><div class="row"><h2>Recent</h2><button class="link" data-to="activity">See all</button></div><div class="list">${recent.length ? recent.map(txnRow).join("") : `<div class="empty">No transactions yet. Import a statement or tap + to log a purchase.</div>`}</div></div>`
      + goals;
  },
  mount(root) {
    root.querySelectorAll("[data-to]").forEach(b => (b.onclick = () => {
      const to = b.dataset.to;
      if (to === "import") openImport(); else if (to === "settings") openSettings(); else go(to);
    }));
    root.querySelector("[data-act=lock]").onclick = () => emit("app:lock");
    root.querySelector("[data-act=settings]").onclick = () => openSettings();
    root.querySelectorAll("[data-paid]").forEach(b => (b.onclick = () => {
      const [kind, id, month] = b.dataset.paid.split(":");
      store.update(d => {
        const x = (kind === "bill" ? d.bills : d.accounts).find(v => v.id === id);
        if (x && kind === "statement") x.paidDownFor = month; else if (x) x.paidFor = month;
      });
      toast("Marked as paid");
    }));
    bindSlots(root);
    bindTxnRows(root);
  }
};

// ====================================================== ACTIVITY
function barChart(days, totals, budgets, today) {
  const W = 340, H = 150, L = 34, R = 4, T = 8, B = 20;
  const maxRaw = Math.max(1, ...totals, ...budgets);
  const p = Math.pow(10, Math.floor(Math.log10(maxRaw / 3))), f = maxRaw / 3 / p;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p, max = Math.ceil(maxRaw / step) * step;
  const bw = (W - L - R) / days.length, y = v => T + (H - T - B) * (1 - v / max);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Spending per day">`;
  for (let v = 0; v <= max + 1e-9; v += step) s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${esc(money(v, 0))}</text>`;
  days.forEach((dd, i) => {
    const x = L + i * bw, v = Math.max(0, totals[i]);
    s += `<rect x="${x + bw * .18}" y="${y(v)}" width="${bw * .64}" height="${y(0) - y(v)}" rx="2" fill="${budgets[i] && v > budgets[i] ? "var(--over)" : "var(--accent)"}" opacity="${dd > today ? .3 : 1}"/>`;
    const n = parseDate(dd).getDate();
    const lbl = days.length <= 7 ? DOW[parseDate(dd).getDay()][0] : (n === 1 || n % 7 === 1 ? n : "");
    if (lbl !== "") s += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${lbl}</text>`;
  });
  if (budgets.some(b => b > 0)) s += `<polyline fill="none" stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="4 3" points="${days.map((_, i) => `${L + i * bw},${y(budgets[i])} ${L + (i + 1) * bw},${y(budgets[i])}`).join(" ")}"/>`;
  return s + "</svg>";
}
const activity = {
  html() {
    const d = D(), today = todayStr();
    const [start, end] = periodRange(ui.period, ui.anchor);
    const label = ui.period === "day" ? niceDate(start, true) : ui.period === "week" ? niceDate(start) + " – " + niceDate(end) : monthLabel(start);
    const searching = ui.search.trim().length > 0;
    let list = searching
      ? [...d.txns].filter(t => (t.merchant + " " + t.desc + " " + (t.note || "")).toLowerCase().includes(ui.search.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date))
      : A.txnsIn(d, start, end, ui.acct);
    if (searching && ui.acct) list = list.filter(t => t.acct === ui.acct);
    const spend = list.filter(t => t.kind === "spend"), spent = sum(spend, t => t.amt);
    const income = sum(list.filter(t => t.kind === "income"), t => -t.amt);
    const budget = ui.acct ? 0 : A.budgetFor(d, start, end);
    let chart = "";
    if (!searching && ui.period !== "day") {
      const days = []; for (let x = start; x <= end; x = addDays(x, 1)) days.push(x);
      chart = `<div class="card chart">${barChart(days, days.map(x => sum(spend.filter(t => t.date === x), t => t.amt)), days.map(x => ui.acct ? 0 : A.budgetFor(d, x, x)), today)}
        <div class="legend"><span><span class="dot" style="background:var(--accent)"></span> Spent</span><span><span class="dot" style="background:var(--over)"></span> Over the day's budget</span>${ui.acct ? "" : `<span class="warn">- - Daily budget</span>`}</div></div>`;
    }
    const groups = {};
    for (const t of list) (groups[t.date] ||= []).push(t);
    const listHtml = Object.keys(groups).length ? Object.entries(groups).map(([day, ts]) =>
      `<div class="dayhead"><span>${esc(niceDate(day))}</span><span class="num">${money(sum(ts.filter(t => t.kind === "spend"), t => t.amt))}</span></div>${ts.map(txnRow).join("")}`).join("")
      : `<div class="empty">${searching ? "Nothing matches that search." : "No transactions in this " + ui.period + "."}</div>`;
    return topbar("Activity", "", `<button class="icon-btn" data-act="import" aria-label="Import a statement">${icon("upload")}</button>`)
      + `<input class="input" id="search" type="search" placeholder="Search all transactions" value="${esc(ui.search)}">`
      + (searching ? "" : `<div class="seg" role="group" aria-label="Period">${["day", "week", "month"].map(p => `<button data-p="${p}" aria-pressed="${ui.period === p}">${p[0].toUpperCase() + p.slice(1)}</button>`).join("")}</div>
        <div class="nav"><button data-nav="-1" aria-label="Previous">‹</button><span class="range">${esc(label)}</span><button data-nav="1" aria-label="Next">›</button></div>`)
      + `<div class="chips">${[[null, "All accounts"], ...d.accounts.map(a => [a.id, a.name])].map(([id, n]) => `<button class="chip" data-acct="${id || ""}" aria-pressed="${ui.acct === id}">${esc(n)}</button>`).join("")}</div>`
      + `<div class="grid2"><div class="stat"><span class="label">Spent</span><b class="num">${money(spent)}</b><span class="small ${budget && spent > budget ? "over" : "muted"}">${budget ? (spent > budget ? money(spent - budget, 0) + " over budget" : money(budget - spent, 0) + " left of " + money(budget, 0)) : spend.length + " purchases"}</span></div>
        <div class="stat"><span class="label">Money in</span><b class="num ok">${money(income)}</b><span class="small muted">${list.filter(t => t.kind === "transfer").length} transfers not counted</span></div></div>`
      + chart + `<div class="card" style="gap:0">${listHtml}</div>`;
  },
  mount(root) {
    root.querySelector("[data-act=import]").onclick = () => openImport();
    const s = root.querySelector("#search");
    s.oninput = () => { ui.search = s.value; clearTimeout(s._t); s._t = setTimeout(() => { rerender(); const n = document.getElementById("search"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
    root.querySelectorAll("[data-p]").forEach(b => (b.onclick = () => { ui.period = b.dataset.p; rerender(); }));
    root.querySelectorAll("[data-nav]").forEach(b => (b.onclick = () => {
      const dir = +b.dataset.nav;
      ui.anchor = ui.period === "day" ? addDays(ui.anchor, dir) : ui.period === "week" ? addDays(ui.anchor, 7 * dir) : addMonths(ui.anchor, dir);
      rerender();
    }));
    root.querySelectorAll("[data-acct]").forEach(b => (b.onclick = () => { ui.acct = b.dataset.acct || null; rerender(); }));
    bindTxnRows(root);
  }
};

// ====================================================== BUDGET
const budget = {
  html() {
    const d = D(), today = todayStr();
    const ms = monthStart(ui.budgetMonth), me = monthEnd(ui.budgetMonth);
    const end = me < today ? me : today;
    const items = A.spendIn(d, ms, me), by = A.byCategory(items), spent = sum(items, t => t.amt);
    const total = A.totalBudget(d), income = +d.settings.income || 0;
    const isNow = ms === monthStart(today);
    const pace = isNow ? daysBetween(ms, today) / daysBetween(ms, me) : null;
    const rows = d.categories.map(c => {
      const s = by[c.id] || 0, b = +c.budget || 0, lv = levelOf(s, b, warnPct());
      return `<button class="item" data-cat="${esc(c.id)}"><span class="grow stack" style="gap:6px">
        <span class="row"><span class="title" style="display:flex;gap:8px;align-items:center"><span class="dot" style="background:${esc(c.color)}"></span>${esc(c.name)}</span>
        <span class="small num ${lv}">${money(s, 0)} / ${b ? money(b, 0) : "—"}</span></span>
        ${meter(b ? s / b : (s ? 1 : 0), lv || "", pace)}
        <span class="sub">${b ? (s > b ? `<span class="over">${money(s - b, 0)} over</span>` : money(b - s, 0) + " left") : "No budget set"} · ${c.need ? "Need" : "Want"}</span></span></button>`;
    }).join("");
    const goals = d.goals.map(g => {
      const mon = A.goalMonthly(g);
      return `<button class="item" data-goal="${esc(g.id)}"><span class="grow stack" style="gap:6px"><span class="row"><span class="title">${esc(g.name)}</span><span class="small num">${money(+g.saved || 0, 0)} of ${money(+g.target || 0, 0)}</span></span>
        ${meter((+g.saved || 0) / (+g.target || 1), "")}<span class="sub">${g.by ? `By ${esc(niceDate(g.by, true))} · save ${money(mon || 0, 0)} a month` : "No deadline"}</span></span></button>`;
    }).join("");
    return topbar("Budget", "Monthly plan", `<button class="icon-btn" data-act="addcat" aria-label="Add a category">${icon("plus")}</button>`)
      + `<div class="nav"><button data-nav="-1" aria-label="Previous month">‹</button><span class="range">${esc(monthLabel(ms))}</span><button data-nav="1" aria-label="Next month">›</button></div>`
      + `<div class="card"><div class="row"><div><div class="label">Spent</div><div style="font-size:1.8rem;font-weight:750" class="num">${money(spent)}</div></div>
          <div style="text-align:right"><div class="label">Budget</div><div class="num" style="font-weight:650">${money(total, 0)}</div></div></div>
          ${meter(total ? spent / total : 0, levelOf(spent, total, warnPct()), pace)}
          <div class="row small"><span class="muted">${total ? (spent > total ? `<span class="over">${money(spent - total, 0)} over</span>` : money(total - spent, 0) + " left") : "Tap a category to set its budget"}</span>
          <span class="muted">${isNow && total ? money(Math.max(0, A.safeToday(d).perDay), 0) + "/day left" : ""}</span></div>
          <button class="item" data-act="income" style="padding-bottom:0"><span class="grow"><div class="title">Monthly take-home income</div><div class="sub">${income ? `${money(total, 0)} planned · ${income - total >= 0 ? `<span class="ok">${money(income - total, 0)} left to save</span>` : `<span class="over">${money(total - income, 0)} more than you earn</span>`}` : "Add it to see what's left to save"}</div></span><span class="num">${income ? money(income, 0) : "Add"}</span></button></div>`
      + `<div class="grid2"><button class="btn" data-act="suggest">Suggest from my spending</button><button class="btn primary" data-act="askclaude">Ask Claude</button></div>`
      + `<div class="card" style="gap:0"><h2 style="margin-bottom:6px">Categories</h2>${rows}</div>`
      + `<div class="card" style="gap:0"><div class="row" style="margin-bottom:6px"><h2>Savings goals</h2><button class="btn small" data-act="addgoal">Add goal</button></div>${goals || `<div class="empty">Set a goal like "$1,000 emergency fund by March" and track it here.</div>`}</div>`;
  },
  mount(root) {
    root.querySelectorAll("[data-nav]").forEach(b => (b.onclick = () => { ui.budgetMonth = addMonths(ui.budgetMonth, +b.dataset.nav); rerender(); }));
    root.querySelectorAll("[data-cat]").forEach(b => (b.onclick = () => openCategory(b.dataset.cat)));
    root.querySelectorAll("[data-goal]").forEach(b => (b.onclick = () => openGoal(b.dataset.goal)));
    root.querySelector("[data-act=addcat]").onclick = () => openCategory(null);
    root.querySelector("[data-act=addgoal]").onclick = () => openGoal(null);
    root.querySelector("[data-act=income]").onclick = () => openIncome();
    root.querySelector("[data-act=suggest]").onclick = () => openSuggest();
    root.querySelector("[data-act=askclaude]").onclick = () => { go("insights"); setTimeout(() => askClaude("Build me a realistic budget for next month based on my spending. Say where to cut and by how much."), 50); };
  }
};

// ====================================================== CARDS & BILLS
const cards = {
  html() {
    const d = D();
    const credit = d.accounts.filter(a => a.type === "credit");
    const accts = d.accounts.map(a => {
      const util = a.type === "credit" && +a.limit ? (+a.balance || 0) / +a.limit : null;
      const lv = util == null ? "" : util >= .5 ? "over" : util >= .3 ? "warn" : "ok";
      return `<button class="item" data-acct="${esc(a.id)}"><span class="avatar" style="background:${esc(a.color || "#5b6a62")}">${esc(initials(a.name))}</span>
        <span class="grow"><div class="title">${esc(a.name)}</div><div class="sub">${a.type === "credit" ? `Credit card${a.statementDay ? " · statement on the " + ordinal(+a.statementDay) : ""}${a.dueDay ? " · due on the " + ordinal(+a.dueDay) : ""}${a.apr ? " · " + a.apr + "% APR" : ""}` : a.type === "cash" ? "Cash" : "Bank account"}</div>
        ${util != null ? `<div style="margin-top:6px">${meter(util, lv === "ok" ? "" : lv)}</div>` : ""}</span>
        <span style="text-align:right">${a.type === "credit" ? `<div class="num" style="font-weight:650">${money(+a.balance || 0, 0)}</div>${util != null ? `<span class="pill ${lv}">${Math.round(util * 100)}% used</span>` : ""}` : ""}</span></button>`;
    }).join("");
    const owed = sum(credit, a => +a.balance || 0);
    const mins = sum(credit.filter(a => +a.balance > 0), a => +a.minPay || Math.max(25, (+a.balance || 0) * .02));
    if (ui.payoff == null) ui.payoff = Math.ceil(mins * 1.5 / 10) * 10 || 100;
    let payoff = "";
    if (owed > 0) {
      const plan = A.payoffPlan(credit, ui.payoff), minOnly = A.payoffPlan(credit, mins);
      const done = plan.ok ? addMonths(todayStr(), plan.months) : null;
      payoff = `<div class="card"><h2>Pay off your cards</h2>
        <div class="row"><span class="muted">Total owed</span><b class="num">${money(owed)}</b></div>
        <label class="field"><span>I can pay this much a month in total</span><input class="input num" id="payAmt" type="number" inputmode="decimal" min="0" value="${ui.payoff}"></label>
        ${plan.ok ? `<div class="banner info"><span>Debt-free in <b>${plan.months} months</b> (${esc(monthLabel(done))}), paying about <b>${money(plan.interest, 0)}</b> in interest.${minOnly.ok && minOnly.months > plan.months ? ` Paying only the minimums would take ${minOnly.months} months and cost ${money(minOnly.interest, 0)}.` : ""}</span></div>
          <div class="stack small">${plan.order.map((o, i) => `<div class="row"><span>${i + 1}. ${esc(o.name)}</span><span class="muted">paid off in month ${o.month}</span></div>`).join("")}</div>
          <p class="muted small" style="margin:0">Pay every card's minimum, then put everything extra on the card with the highest APR.${credit.some(a => !+a.apr) ? " Add each card's APR for accurate numbers." : ""}</p>`
          : plan.never ? `<div class="banner over">That payment doesn't cover the interest. Try a higher amount.</div>` : `<div class="banner over">The minimum payments add up to ${money(plan.needed, 0)}. Enter at least that.</div>`}</div>`;
    }
    const bills = d.bills.map(b => `<button class="item" data-bill="${esc(b.id)}"><span class="grow"><div class="title">${esc(b.name)}</div><div class="sub">Due on the ${ordinal(+b.dueDay)}${b.acct ? " · " + esc(store.acctById(b.acct).name) : ""}</div></span><span class="num amt">${money(+b.amount || 0)}</span></button>`).join("");
    return topbar("Cards & bills", "", `<button class="icon-btn" data-act="addacct" aria-label="Add an account">${icon("plus")}</button>`)
      + `<div class="card" style="gap:0"><div class="row" style="margin-bottom:4px"><h2>Accounts</h2><button class="btn small" data-act="import">${"Import statement"}</button></div>${accts}</div>`
      + payoff
      + `<div class="card" style="gap:0"><div class="row" style="margin-bottom:4px"><h2>Bills & due dates</h2><button class="btn small" data-act="addbill">Add bill</button></div>
        ${bills || `<div class="empty">Add rent, phone, insurance and other bills to get reminders before they're due.</div>`}
        ${d.bills.length || credit.some(a => a.dueDay || a.statementDay) ? `<button class="btn block" data-act="calendar" style="margin-top:10px">Add reminders to my iPhone Calendar</button>` : ""}</div>`;
  },
  mount(root) {
    root.querySelectorAll("[data-acct]").forEach(b => (b.onclick = () => openAccount(b.dataset.acct)));
    root.querySelectorAll("[data-bill]").forEach(b => (b.onclick = () => openBill(b.dataset.bill)));
    root.querySelector("[data-act=addacct]").onclick = () => openAccount(null);
    root.querySelector("[data-act=import]").onclick = () => openImport();
    root.querySelector("[data-act=addbill]").onclick = () => openBill(null);
    const cal = root.querySelector("[data-act=calendar]"); if (cal) cal.onclick = () => exportCalendar();
    const p = root.querySelector("#payAmt");
    if (p) p.onchange = () => { ui.payoff = Math.max(0, +p.value || 0); rerender(); };
  }
};
const ordinal = n => n + (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");

// ====================================================== INSIGHTS
const insights = {
  html() {
    const d = D();
    const ins = A.insights(d, ui.months);
    const has = d.txns.some(t => t.kind === "spend");
    const subs = ins.recurring.filter(r => r.cat !== "bills"), subsTotal = sum(subs, r => r.amount);
    const chat = ui.chat.map(m => m.role === "user" ? `<div class="bubble-q">${esc(m.content)}</div>` : `<div class="answer">${renderAnswer(m.content)}${m.budget ? `<button class="btn primary block" data-apply="${ui.chat.indexOf(m)}">Apply this budget</button>` : ""}</div>`).join("");
    const claudeCard = d.settings.apiKey ? `<div class="card"><div class="row"><h2>Ask Claude</h2>${ui.chat.length ? `<button class="link" data-act="clearchat">Clear</button>` : ""}</div>
      ${chat || `<p class="muted small" style="margin:0">Claude sees your totals by category and merchant, your budget, cards and goals. It never sees full statements or card numbers.</p>`}
      ${ui.busy ? `<div class="muted small">Claude is thinking…</div>` : ""}
      ${ui.chat.length ? "" : `<div class="prompts">${["Where am I overspending?", "What should I cut?", "Build my budget for next month", "How do I pay off my cards faster?"].map(q => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>`}
      <form id="askForm" class="row"><input class="input" id="askIn" placeholder="Ask about your money…" autocomplete="off" ${ui.busy ? "disabled" : ""}><button class="btn primary" ${ui.busy ? "disabled" : ""}>Ask</button></form></div>`
      : `<div class="card"><h2>Ask Claude</h2><p class="muted small" style="margin:0">Add your Claude API key in Settings to get a personal spending review, ideas for what to cut, and a budget you can apply with one tap.</p><button class="btn primary" data-act="settings">Add Claude key</button></div>`;
    if (!has) return topbar("Insights") + claudeCard + `<div class="card"><div class="empty">Import a statement to see where your money goes.</div><button class="btn primary" data-act="import">Import a statement</button></div>`;
    const maxM = Math.max(1, ...ins.monthly.map(m => m.total));
    const monthlyChart = ins.monthly.length > 1 ? `<div class="card"><h2>Month by month</h2><div class="stack">${ins.monthly.map(m => `
      <div class="row small"><span style="width:58px" class="muted">${esc(MON[parseDate(m.month).getMonth()])} ${String(parseDate(m.month).getFullYear()).slice(2)}</span><span style="flex:1">${meter(m.total / maxM, A.totalBudget(d) && m.total > A.totalBudget(d) ? "over" : "")}</span><span class="num" style="width:72px;text-align:right">${money(m.total, 0)}</span></div>`).join("")}</div>
      ${A.totalBudget(d) ? `<div class="legend"><span><span class="dot" style="background:var(--over)"></span> Over your ${money(A.totalBudget(d), 0)} budget</span></div>` : ""}</div>` : "";
    const catTable = `<div class="card"><h2>Categories, per month</h2><div class="table-wrap"><table><thead><tr><th>Category</th><th class="r">Average</th><th class="r">Budget</th><th class="r">Difference</th></tr></thead><tbody>${ins.catRows.map(r => {
      const diff = r.budget ? r.avg - r.budget : null;
      return `<tr><td><span class="dot" style="background:${esc(r.cat.color)}"></span> ${esc(r.cat.name)}</td><td class="r num">${money(r.avg, 0)}</td><td class="r num">${r.budget ? money(r.budget, 0) : "—"}</td><td class="r num ${diff > 0 ? "over" : diff != null ? "ok" : ""}">${diff == null ? "" : (diff > 0 ? "+" : "") + money(diff, 0)}</td></tr>`;
    }).join("")}</tbody></table></div></div>`;
    const list = (title, rows, note) => `<div class="card" style="gap:0"><h2 style="margin-bottom:4px">${title}</h2>${note ? `<p class="muted small" style="margin:0 0 6px">${note}</p>` : ""}${rows}</div>`;
    return topbar("Insights", "Where your money goes")
      + claudeCard
      + `<div class="seg" role="group" aria-label="Time range">${[[1, "1 month"], [3, "3 months"], [6, "6 months"], [12, "12 months"]].map(([m, l]) => `<button data-m="${m}" aria-pressed="${ui.months === m}">${l}</button>`).join("")}</div>`
      + `<div class="grid2"><div class="stat"><span class="label">Spend per month</span><b class="num">${money(ins.perMonth, 0)}</b><span class="small muted">average since ${esc(niceDate(ins.start))}</span></div>
         <div class="stat"><span class="label">Income per month</span><b class="num">${ins.income || +d.settings.income ? money(+d.settings.income || ins.income, 0) : "—"}</b><span class="small ${(+d.settings.income || ins.income) - ins.perMonth < 0 ? "over" : "ok"}">${ins.income || +d.settings.income ? ((+d.settings.income || ins.income) - ins.perMonth >= 0 ? money((+d.settings.income || ins.income) - ins.perMonth, 0) + " left over" : money(ins.perMonth - (+d.settings.income || ins.income), 0) + " short") : "add it in Budget"}</span></div></div>`
      + monthlyChart + catTable
      + list("Subscriptions and repeating charges", subs.length ? subs.map(r => `<div class="item"><span class="grow"><div class="title">${esc(r.merchant)}</div><div class="sub">Last charged ${esc(niceDate(r.last))} · ${r.months} months</div></span><span class="num amt">${money(r.amount)}/mo</span></div>`).join("") : `<div class="empty">No repeating charges found yet. This needs at least 2 months of statements.</div>`,
        subs.length ? `About <b>${money(subsTotal, 0)} a month</b>, or ${money(subsTotal * 12, 0)} a year. Cancel any you don't use.` : "")
      + (ins.small.length ? list("Small buys that add up", ins.small.map(m => `<div class="item"><span class="grow"><div class="title">${esc(m.merchant)}</div><div class="sub">${m.count} times · about ${money(m.total / m.count)} each</div></span><span class="num amt">${money(m.perMonth, 0)}/mo</span></div>`).join(""), "") : "")
      + list("Top places you spend", ins.top.map(m => `<div class="item"><span class="avatar" style="background:${esc(store.catById(m.cat).color)}">${esc(initials(m.merchant))}</span><span class="grow"><div class="title">${esc(m.merchant)}</div><div class="sub">${m.count} purchases · ${esc(store.catById(m.cat).name)}</div></span><span class="num amt">${money(m.perMonth, 0)}/mo</span></div>`).join(""), "");
  },
  mount(root) {
    root.querySelectorAll("[data-m]").forEach(b => (b.onclick = () => { ui.months = +b.dataset.m; rerender(); }));
    root.querySelectorAll("[data-act=settings]").forEach(b => (b.onclick = () => openSettings()));
    root.querySelectorAll("[data-act=import]").forEach(b => (b.onclick = () => openImport()));
    root.querySelectorAll("[data-q]").forEach(b => (b.onclick = () => askClaude(b.dataset.q)));
    const clr = root.querySelector("[data-act=clearchat]"); if (clr) clr.onclick = () => { ui.chat = []; rerender(); };
    const f = root.querySelector("#askForm");
    if (f) f.onsubmit = e => { e.preventDefault(); const q = root.querySelector("#askIn").value.trim(); if (q) askClaude(q); };
    root.querySelectorAll("[data-apply]").forEach(b => (b.onclick = () => applyBudget(ui.chat[+b.dataset.apply].budget, "Claude's budget applied")));
  }
};

async function askClaude(q) {
  if (ui.busy) return;
  const d = D();
  if (!d.settings.apiKey) return openSettings();
  const history = ui.chat.map(m => ({ role: m.role, content: m.content }));
  ui.chat.push({ role: "user", content: q });
  const answer = { role: "assistant", content: "" };
  ui.chat.push(answer);
  ui.busy = true; rerender();
  let painted = 0;
  try {
    await claude.ask(d, q, history, text => {
      answer.content = text;
      // Repaint at most a few times a second while it streams.
      if (Date.now() - painted > 300) { painted = Date.now(); paintChat(); }
    });
    answer.budget = claude.budgetFrom(answer.content, d);
    store.update(x => { x.claude.lastReview = answer.content; x.claude.lastReviewAt = new Date().toISOString(); });
  } catch (e) {
    ui.chat.pop(); ui.chat.pop();
    toast(claude.explainError(e));
  } finally { ui.busy = false; rerender(); }
}
function paintChat() {
  const last = ui.chat[ui.chat.length - 1];
  const nodes = document.querySelectorAll(".answer");
  if (nodes.length) nodes[nodes.length - 1].innerHTML = renderAnswer(last.content);
  else rerender();
}
function applyBudget(map, msg) {
  store.update(d => { for (const c of d.categories) if (map[c.id] != null) c.budget = map[c.id]; });
  toast(msg);
}

export const views = { home, activity, budget, cards, insights };

// ====================================================== SHEETS
function opts(list, sel) { return list.map(([v, l]) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(l)}</option>`).join(""); }
const catOpts = sel => opts(D().categories.map(c => [c.id, c.name]), sel);
const acctOpts = sel => opts(D().accounts.map(a => [a.id, a.name]), sel);

// Add or edit a transaction.
export function openAdd() { openTxn(null); }
function openTxn(t) {
  const d = D(), isNew = !t;
  t = t || { id: uid(), date: todayStr(), amt: 0, kind: "spend", cat: d.categories[0].id, acct: d.accounts[0].id, desc: "", merchant: "", note: "" };
  const shownAmt = t.amt ? Math.abs(t.amt) : "";
  sheet(isNew ? "Add a purchase" : "Transaction", `
    <input class="big-input num" id="tAmt" type="number" inputmode="decimal" step="0.01" placeholder="0.00" value="${shownAmt}" aria-label="Amount">
    <div class="seg" id="tKind">${[["spend", "Spending"], ["refund", "Refund"], ["income", "Money in"], ["transfer", "Transfer"]].map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${(t.kind === "spend" && t.amt < 0 ? "refund" : t.kind) === k}">${l}</button>`).join("")}</div>
    <label class="field"><span>Where</span><input class="input" id="tMer" value="${esc(t.merchant || t.desc)}" placeholder="e.g. Starbucks"></label>
    <label class="field" id="tCatF"><span>Category</span><select class="input" id="tCat">${catOpts(t.cat)}</select></label>
    <label class="check" id="tRuleF" ${isNew ? "hidden" : ""}><input type="checkbox" id="tRule"> Always put ${esc(t.merchant || "this place")} in this category</label>
    <div class="grid2"><label class="field"><span>Account</span><select class="input" id="tAcct">${acctOpts(t.acct)}</select></label>
    <label class="field"><span>Date</span><input class="input" id="tDate" type="date" value="${t.date}"></label></div>
    <label class="field"><span>Note</span><input class="input" id="tNote" value="${esc(t.note || "")}" maxlength="80"></label>
    ${!isNew && t.desc && t.desc !== t.merchant ? `<p class="muted small" style="margin:0">On the statement: ${esc(t.desc)}</p>` : ""}
    <button class="btn primary block" id="tSave">${isNew ? "Add" : "Save"}</button>
    ${isNew ? "" : `<button class="btn danger block" id="tDel">Delete</button>`}`, (b, close) => {
    let kind = t.kind === "spend" && t.amt < 0 ? "refund" : t.kind;
    const syncKind = () => { b.querySelectorAll("#tKind button").forEach(x => x.setAttribute("aria-pressed", x.dataset.k === kind)); b.querySelector("#tCatF").hidden = !(kind === "spend" || kind === "refund"); };
    syncKind();
    b.querySelector("#tKind").onclick = e => { const k = e.target.closest("[data-k]")?.dataset.k; if (k) { kind = k; syncKind(); } };
    if (isNew) setTimeout(() => b.querySelector("#tAmt").focus(), 100);
    b.querySelector("#tSave").onclick = () => {
      const amt = round2(Math.abs(parseFloat(b.querySelector("#tAmt").value)));
      if (!(amt > 0)) return toast("Enter an amount");
      const mer = b.querySelector("#tMer").value.trim() || "Purchase";
      const before = A.alerts(d).map(x => x.cat.id + x.level).join();
      const rec = {
        ...t, amt: kind === "income" || kind === "refund" ? -amt : amt, kind: kind === "refund" ? "spend" : kind,
        merchant: mer, desc: t.desc && !isNew ? t.desc : mer, cat: kind === "spend" || kind === "refund" ? b.querySelector("#tCat").value : null,
        acct: b.querySelector("#tAcct").value, date: b.querySelector("#tDate").value || todayStr(), note: b.querySelector("#tNote").value.trim(), ts: t.ts || Date.now()
      };
      const rule = b.querySelector("#tRule").checked;
      store.update(x => {
        const i = x.txns.findIndex(y => y.id === rec.id);
        if (i >= 0) x.txns[i] = rec; else x.txns.push(rec);
        if (rule && rec.cat) {
          x.rules[rec.merchant.toUpperCase()] = rec.cat;
          for (const y of x.txns) if (y.kind === "spend" && y.merchant === rec.merchant) y.cat = rec.cat;
        }
      });
      close();
      announceAlerts(before, isNew ? "Added " + money(amt) : "Saved");
    };
    const del = b.querySelector("#tDel");
    if (del) del.onclick = () => { store.update(x => { x.txns = x.txns.filter(y => y.id !== t.id); }); close(); toast("Deleted"); };
  });
}
// After spending changes, say so if a category crossed its alert line.
function announceAlerts(before, fallback) {
  const now = A.alerts(D());
  const fresh = now.filter(x => !before.split(",").includes(x.cat.id + x.level));
  if (fresh.length) {
    const x = fresh[0];
    toast(x.level === "over" ? `${x.cat.name} is now over budget` : `${x.cat.name} has reached ${Math.round(x.ratio * 100)}% of its budget`);
  } else toast(fallback);
}

function openCategory(id) {
  const d = D(), c = id ? d.categories.find(x => x.id === id) : { id: "c" + uid(), name: "", budget: 0, color: "#5e8f7f", need: false };
  sheet(id ? c.name : "New category", `
    <label class="field"><span>Monthly budget</span><input class="input num" id="cB" type="number" inputmode="decimal" min="0" value="${+c.budget || ""}" placeholder="0"></label>
    <label class="field"><span>Name</span><input class="input" id="cN" value="${esc(c.name)}" maxlength="30"></label>
    <div class="grid2"><label class="field"><span>Type</span><select class="input" id="cT">${opts([["need", "Need (bills, food)"], ["want", "Want (extras)"]], c.need ? "need" : "want")}</select></label>
    <label class="field"><span>Colour</span><input class="input" id="cC" type="color" value="${esc(c.color)}" style="height:46px;padding:4px"></label></div>
    <p class="muted small" style="margin:0">Weekly and daily budgets are worked out from the monthly amount.</p>
    <button class="btn primary block" id="cS">Save</button>${id ? `<button class="btn danger block" id="cD">Delete category</button>` : ""}`, (b, close) => {
    setTimeout(() => b.querySelector(id ? "#cB" : "#cN").focus(), 100);
    b.querySelector("#cS").onclick = () => {
      const name = b.querySelector("#cN").value.trim();
      if (!name) return toast("Give it a name");
      store.update(x => {
        const rec = { ...c, name, budget: Math.max(0, +b.querySelector("#cB").value || 0), need: b.querySelector("#cT").value === "need", color: b.querySelector("#cC").value };
        const i = x.categories.findIndex(y => y.id === c.id);
        if (i >= 0) x.categories[i] = rec; else x.categories.push(rec);
      });
      close(); toast("Saved");
    };
    const del = b.querySelector("#cD");
    if (del) del.onclick = () => confirmSheet("Delete " + c.name + "?", "Its transactions move to Other. This can't be undone.", "Delete category", () => {
      store.update(x => {
        x.categories = x.categories.filter(y => y.id !== c.id);
        const fallback = x.categories.find(y => y.id === "other")?.id || x.categories[0]?.id;
        for (const t of x.txns) if (t.cat === c.id) t.cat = fallback;
        for (const k in x.rules) if (x.rules[k] === c.id) delete x.rules[k];
      });
    });
  });
}

function openIncome() {
  sheet("Monthly income", `<label class="field"><span>Take-home pay per month, after tax</span><input class="input num" id="iI" type="number" inputmode="decimal" min="0" value="${+D().settings.income || ""}"></label>
    <button class="btn primary block" id="iS">Save</button>`, (b, close) => {
    setTimeout(() => b.querySelector("#iI").focus(), 100);
    b.querySelector("#iS").onclick = () => { store.update(x => (x.settings.income = Math.max(0, +b.querySelector("#iI").value || 0))); close(); toast("Saved"); };
  });
}

function openSuggest() {
  const d = D();
  if (!d.txns.some(t => t.kind === "spend")) return toast("Import a statement first");
  const { budget: sug, basis } = A.suggestBudget(d, 3);
  const rows = d.categories.map(c => {
    const avg = basis.catRows.find(r => r.cat.id === c.id)?.avg || 0;
    return `<tr><td>${esc(c.name)}</td><td class="r num">${money(avg, 0)}</td><td class="r num">${+c.budget ? money(+c.budget, 0) : "—"}</td><td class="r num"><b>${money(sug[c.id] || 0, 0)}</b></td></tr>`;
  }).join("");
  sheet("Suggested budget", `<p class="muted small" style="margin:0">Based on your average spending since ${esc(niceDate(basis.start))}. Needs stay at what you spend. Wants are trimmed by 15%, and more if your spending is above your income.</p>
    <div class="table-wrap"><table><thead><tr><th>Category</th><th class="r">Average</th><th class="r">Now</th><th class="r">Suggested</th></tr></thead><tbody>${rows}
    <tr><td><b>Total</b></td><td class="r num">${money(basis.perMonth, 0)}</td><td class="r num">${money(A.totalBudget(d), 0)}</td><td class="r num"><b>${money(sum(Object.values(sug)), 0)}</b></td></tr></tbody></table></div>
    <button class="btn primary block" id="sA">Use this budget</button>`, (b, close) => {
    b.querySelector("#sA").onclick = () => { applyBudget(sug, "Budget updated"); close(); };
  });
}

function openGoal(id) {
  const d = D(), g = id ? d.goals.find(x => x.id === id) : { id: uid(), name: "", target: "", saved: 0, by: "" };
  sheet(id ? g.name : "New savings goal", `
    ${id ? `<div class="card"><div class="row"><b>${money(+g.saved || 0)}</b><span class="muted">of ${money(+g.target || 0)}</span></div>${meter((+g.saved || 0) / (+g.target || 1), "")}
      <div class="row"><input class="input num" id="gAdd" type="number" inputmode="decimal" placeholder="Amount"><button class="btn primary" id="gAddB">Add money</button></div></div>` : ""}
    <label class="field"><span>Goal</span><input class="input" id="gN" value="${esc(g.name)}" placeholder="Emergency fund" maxlength="40"></label>
    <div class="grid2"><label class="field"><span>Target</span><input class="input num" id="gT" type="number" inputmode="decimal" value="${g.target}"></label>
    <label class="field"><span>Saved so far</span><input class="input num" id="gS" type="number" inputmode="decimal" value="${+g.saved || 0}"></label></div>
    <label class="field"><span>Reach it by (optional)</span><input class="input" id="gBy" type="date" value="${g.by || ""}"></label>
    <button class="btn ${id ? "" : "primary"} block" id="gSave">Save</button>${id ? `<button class="btn danger block" id="gDel">Delete goal</button>` : ""}`, (b, close) => {
    const save = extra => {
      const name = b.querySelector("#gN").value.trim(), target = +b.querySelector("#gT").value;
      if (!name || !(target > 0)) return toast("Add a name and a target");
      store.update(x => {
        const rec = { ...g, name, target, saved: round2((+b.querySelector("#gS").value || 0) + (extra || 0)), by: b.querySelector("#gBy").value };
        const i = x.goals.findIndex(y => y.id === g.id);
        if (i >= 0) x.goals[i] = rec; else x.goals.push(rec);
      });
      close(); toast(extra ? "Added " + money(extra) : "Saved");
    };
    b.querySelector("#gSave").onclick = () => save(0);
    const add = b.querySelector("#gAddB"); if (add) add.onclick = () => { const v = +b.querySelector("#gAdd").value; if (v) save(v); };
    const del = b.querySelector("#gDel"); if (del) del.onclick = () => { store.update(x => { x.goals = x.goals.filter(y => y.id !== g.id); }); close(); toast("Goal deleted"); };
  });
}

function openAccount(id) {
  const d = D(), a = id ? d.accounts.find(x => x.id === id) : { id: uid(), name: "", type: "credit", color: "#c2477a" };
  const count = id ? d.txns.filter(t => t.acct === id).length : 0;
  sheet(id ? a.name : "Add an account", `
    <label class="field"><span>Name</span><input class="input" id="aN" value="${esc(a.name)}" placeholder="e.g. PC Mastercard" maxlength="40"></label>
    <div class="grid2"><label class="field"><span>Type</span><select class="input" id="aT">${opts([["credit", "Credit card"], ["bank", "Bank account"], ["cash", "Cash"]], a.type)}</select></label>
    <label class="field"><span>Colour</span><input class="input" id="aC" type="color" value="${esc(a.color || "#5b6a62")}" style="height:46px;padding:4px"></label></div>
    <div id="aCredit" class="stack">
      <div class="grid2"><label class="field"><span>Balance owed now</span><input class="input num" id="aB" type="number" inputmode="decimal" value="${a.balance ?? ""}"></label>
      <label class="field"><span>Credit limit</span><input class="input num" id="aL" type="number" inputmode="decimal" value="${a.limit ?? ""}"></label></div>
      <div class="grid2"><label class="field"><span>APR %</span><input class="input num" id="aR" type="number" inputmode="decimal" step="0.01" value="${a.apr ?? ""}"></label>
      <label class="field"><span>Minimum payment</span><input class="input num" id="aM" type="number" inputmode="decimal" value="${a.minPay ?? ""}"></label></div>
      <div class="grid2"><label class="field"><span>Statement date (day)</span><input class="input num" id="aSt" type="number" inputmode="numeric" min="1" max="31" value="${a.statementDay ?? ""}"></label>
      <label class="field"><span>Payment due (day)</span><input class="input num" id="aD" type="number" inputmode="numeric" min="1" max="31" value="${a.dueDay ?? ""}"></label></div>
      <p class="muted small" style="margin:0">Find these at the top of your latest statement. With the statement date, the app reminds you to pay the card down 3 days before it closes, so a low balance is reported to the credit bureaus.</p>
    </div>
    <button class="btn primary block" id="aS">Save</button>
    ${id ? `<button class="btn block" id="aI">Import a statement for this account</button>` : ""}
    ${id && d.accounts.length > 1 ? `<button class="btn danger block" id="aX">Delete account${count ? " and its " + count + " transactions" : ""}</button>` : ""}`, (b, close) => {
    const sync = () => (b.querySelector("#aCredit").hidden = b.querySelector("#aT").value !== "credit");
    sync(); b.querySelector("#aT").onchange = sync;
    if (!id) setTimeout(() => b.querySelector("#aN").focus(), 100);
    b.querySelector("#aS").onclick = () => {
      const name = b.querySelector("#aN").value.trim();
      if (!name) return toast("Give it a name");
      const num = s => { const v = b.querySelector(s).value; return v === "" ? undefined : +v; };
      const rec = { ...a, name, type: b.querySelector("#aT").value, color: b.querySelector("#aC").value };
      if (rec.type === "credit") Object.assign(rec, { balance: num("#aB"), limit: num("#aL"), apr: num("#aR"), minPay: num("#aM"), dueDay: num("#aD"), statementDay: num("#aSt") });
      store.update(x => { const i = x.accounts.findIndex(y => y.id === a.id); if (i >= 0) x.accounts[i] = rec; else x.accounts.push(rec); });
      close(); toast("Saved");
    };
    const imp2 = b.querySelector("#aI"); if (imp2) imp2.onclick = () => openImport(id);
    const del = b.querySelector("#aX");
    if (del) del.onclick = () => confirmSheet("Delete " + a.name + "?", count ? `This also deletes its ${count} transactions. It can't be undone.` : "This can't be undone.", "Delete", () => {
      store.update(x => { x.accounts = x.accounts.filter(y => y.id !== a.id); x.txns = x.txns.filter(t => t.acct !== a.id); });
      toast("Account deleted");
    });
  });
}

function openBill(id) {
  const d = D(), bl = id ? d.bills.find(x => x.id === id) : { id: uid(), name: "", amount: "", dueDay: "", acct: "", cat: "bills" };
  sheet(id ? bl.name : "Add a bill", `
    <label class="field"><span>Bill</span><input class="input" id="bN" value="${esc(bl.name)}" placeholder="Rent, phone, car insurance…" maxlength="40"></label>
    <div class="grid2"><label class="field"><span>Amount</span><input class="input num" id="bA" type="number" inputmode="decimal" value="${bl.amount}"></label>
    <label class="field"><span>Due day of the month</span><input class="input num" id="bD" type="number" inputmode="numeric" min="1" max="31" value="${bl.dueDay}"></label></div>
    <label class="field"><span>Paid from</span><select class="input" id="bAc"><option value="">Not set</option>${acctOpts(bl.acct)}</select></label>
    <button class="btn primary block" id="bS">Save</button>${id ? `<button class="btn danger block" id="bX">Delete bill</button>` : ""}`, (b, close) => {
    if (!id) setTimeout(() => b.querySelector("#bN").focus(), 100);
    b.querySelector("#bS").onclick = () => {
      const name = b.querySelector("#bN").value.trim(), day = +b.querySelector("#bD").value;
      if (!name || !(day >= 1 && day <= 31)) return toast("Add a name and a due day from 1 to 31");
      store.update(x => {
        const rec = { ...bl, name, amount: +b.querySelector("#bA").value || 0, dueDay: day, acct: b.querySelector("#bAc").value };
        const i = x.bills.findIndex(y => y.id === bl.id); if (i >= 0) x.bills[i] = rec; else x.bills.push(rec);
      });
      close(); toast("Saved");
    };
    const del = b.querySelector("#bX"); if (del) del.onclick = () => { store.update(x => { x.bills = x.bills.filter(y => y.id !== bl.id); }); close(); toast("Bill deleted"); };
  });
}

// One calendar file with a monthly event per bill and card, each with an alert 2 days before.
async function exportCalendar() {
  const d = D(), today = todayStr().replace(/-/g, "");
  const items = [...d.bills.map(b => ({ id: b.id, name: b.name, day: +b.dueDay, amt: +b.amount || 0 })),
    ...d.accounts.filter(a => a.type === "credit" && a.dueDay).map(a => ({ id: a.id, name: a.name + " payment", day: +a.dueDay, amt: +a.minPay || 0 })),
    ...d.accounts.filter(a => a.type === "credit" && a.statementDay).map(a => ({ id: a.id + "-stmt", name: "Pay down " + a.name + " before statement", day: Math.max(1, +a.statementDay - 3), amt: 0 }))];
  const icsEsc = s => String(s).replace(/[\\;,]/g, m => "\\" + m);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Budget//EN", "CALSCALE:GREGORIAN"];
  for (const it of items) {
    const start = new Date(); start.setDate(Math.min(it.day, 28));
    const dt = start.getFullYear() + String(start.getMonth() + 1).padStart(2, "0") + String(Math.min(it.day, 28)).padStart(2, "0");
    lines.push("BEGIN:VEVENT", "UID:" + it.id + "@budget", "DTSTAMP:" + today + "T000000Z", "DTSTART;VALUE=DATE:" + dt,
      "RRULE:FREQ=MONTHLY;BYMONTHDAY=" + (it.day > 28 ? "-1" : it.day), "SUMMARY:" + icsEsc(it.name + (/^Pay down/.test(it.name) ? "" : " due") + (it.amt ? " (" + money(it.amt) + ")" : "")),
      "BEGIN:VALARM", "TRIGGER:-P2D", "ACTION:DISPLAY", "DESCRIPTION:" + icsEsc(it.name + " is due in 2 days"), "END:VALARM", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  await saveFile("bill-reminders.ics", lines.join("\r\n"), "text/calendar");
  toast("Open the file to add the reminders to Calendar");
}

// ====================================================== IMPORT
export function openImport(acctId, file) {
  const d = D();
  const statementAccts = d.accounts.filter(a => a.type !== "cash");
  sheet("Import a statement", `
    <p class="muted small" style="margin:0">On your bank or card's website or app, look for <b>Download transactions</b> or <b>Export</b> and choose <b>CSV</b> (or OFX/QFX). The file is read on this phone only.</p>
    <label class="field"><span>Account</span><select class="input" id="iA">${opts(statementAccts.map(a => [a.id, a.name]), acctId || statementAccts[0]?.id)}<option value="__new">+ Add a new account…</option></select></label>
    <div id="iNew" class="grid2" hidden><input class="input" id="iNN" placeholder="Account name"><select class="input" id="iNT">${opts([["credit", "Credit card"], ["bank", "Bank account"]], "credit")}</select></div>
    <label class="field"><span>Statement file</span><input class="input" id="iF" type="file" accept=".csv,.ofx,.qfx,.txt,text/csv"></label>
    <div id="iStep2"></div>`, (b) => {
    const sel = b.querySelector("#iA");
    const syncNew = () => (b.querySelector("#iNew").hidden = sel.value !== "__new");
    if (!statementAccts.length) sel.value = "__new";
    syncNew(); sel.onchange = () => { syncNew(); if (state) build(); };
    let state = null;
    const account = () => {
      if (sel.value !== "__new") return store.acctById(sel.value);
      return { id: "new", name: b.querySelector("#iNN").value.trim() || "New account", type: b.querySelector("#iNT").value };
    };
    const load = async f => {
      if (!f) return;
      const text = await f.text();
      if (/<OFX>|OFXHEADER|<STMTTRN>/i.test(text)) state = { kind: "ofx", raw: imp.parseOFX(text) };
      else {
        const rows = imp.parseCSV(text);
        if (rows.length < 2) return toast("That file doesn't look like a statement");
        const p = imp.detectMapping(rows);
        state = { kind: "csv", p, mapping: p.mapping, dateOrder: p.dateOrder || d.settings.dateOrder || "mdy" };
        state.out = imp.guessOutSign(p, p.mapping);
      }
      build();
    };
    b.querySelector("#iF").onchange = e => load(e.target.files[0]);
    if (file) { b.querySelector("#iF").closest(".field").hidden = true; load(file); }
    function build() {
      const acc = account();
      const raw = state.kind === "ofx" ? state.raw : imp.rowsFromCSV(state.p, state.mapping, state.dateOrder, state.out);
      state.rows = imp.prepare(raw, acc, d);
      paint();
    }
    function paint() {
      const step = b.querySelector("#iStep2"), rows = state.rows;
      const fresh = rows.filter(r => !r.duplicate), dup = rows.length - fresh.length;
      const inc = rows.filter(r => r.include);
      const mapping = state.kind === "csv" ? `<details class="card" ${rows.length ? "" : "open"}><summary><b>Columns</b> <span class="muted small">(check these if the amounts look wrong)</span></summary>
        <div class="stack" style="margin-top:10px">
        ${[["date", "Date"], ["desc", "Description"], ["amount", "Amount"], ["debit", "Money out column"], ["credit", "Money in column"]].map(([k, l]) => `<label class="field"><span>${l}</span><select class="input" data-map="${k}"><option value="-1">None</option>${state.p.header.map((h, i) => `<option value="${i}" ${state.mapping[k] === i ? "selected" : ""}>${esc(h || "Column " + (i + 1))}</option>`).join("")}</select></label>`).join("")}
        <div class="grid2"><label class="field"><span>Dates are</span><select class="input" id="iDO">${opts([["mdy", "Month/Day/Year"], ["dmy", "Day/Month/Year"]], state.dateOrder)}</select></label>
        <label class="field"><span>Purchases show as</span><select class="input" id="iSign">${opts([["neg", "Minus amounts"], ["pos", "Plus amounts"]], state.out)}</select></label></div></div></details>` : "";
      const uncats = [...new Set(inc.filter(r => r.kind === "spend" && r.cat === "other").map(r => r.merchant))];
      step.innerHTML = mapping + `
        <div class="banner info"><span><b>${fresh.length}</b> new transaction${fresh.length === 1 ? "" : "s"}${dup ? ` · ${dup} already imported` : ""} · ${rows.filter(r => r.kind === "transfer").length} card payments or transfers (not counted as spending)</span></div>
        ${uncats.length && d.settings.apiKey ? `<button class="btn block" id="iClaude">Let Claude sort ${uncats.length} unknown place${uncats.length === 1 ? "" : "s"}</button>` : ""}
        <button class="btn primary block" id="iGo" ${inc.length ? "" : "disabled"}>Import ${inc.length} transaction${inc.length === 1 ? "" : "s"}</button>
        <div class="card" style="gap:0;padding:6px 12px">${rows.slice(0, 400).map((r, i) => `
          <div class="item" style="align-items:flex-start;${r.duplicate ? "opacity:.5" : ""}">
            <input type="checkbox" data-inc="${i}" ${r.include ? "checked" : ""} aria-label="Include" style="width:20px;height:20px;margin-top:4px;accent-color:var(--accent)">
            <span class="grow stack" style="gap:4px"><span class="row"><span class="title">${esc(r.merchant)}</span><span class="num amt ${r.amt < 0 ? "in" : ""}">${r.amt < 0 ? "+" + money(-r.amt) : money(r.amt)}</span></span>
              <span class="sub">${esc(niceDate(r.date, true))} · ${esc(r.desc)}</span>
              <span class="grid2"><select class="input" data-kind="${i}" style="padding:6px 8px;font-size:14px">${opts([["spend", r.amt < 0 ? "Refund" : "Spending"], ["income", "Money in"], ["transfer", "Transfer / payment"]], r.kind)}</select>
              ${r.kind === "spend" ? `<select class="input" data-cat="${i}" style="padding:6px 8px;font-size:14px">${catOpts(r.cat)}</select>` : "<span></span>"}</span></span></div>`).join("")}
          ${rows.length > 400 ? `<div class="empty">Showing the first 400 of ${rows.length}. All ${inc.length} selected will be imported.</div>` : ""}</div>`;
      step.querySelectorAll("[data-map]").forEach(s => (s.onchange = () => { state.mapping = { ...state.mapping, [s.dataset.map]: +s.value }; build(); }));
      const dO = step.querySelector("#iDO"); if (dO) dO.onchange = () => { state.dateOrder = dO.value; build(); };
      const sg = step.querySelector("#iSign"); if (sg) sg.onchange = () => { state.out = sg.value; build(); };
      step.querySelectorAll("[data-inc]").forEach(c => (c.onchange = () => { rows[+c.dataset.inc].include = c.checked; paint(); }));
      step.querySelectorAll("[data-kind]").forEach(s => (s.onchange = () => { const r = rows[+s.dataset.kind]; r.kind = s.value; r.cat = r.kind === "spend" ? (r.cat || imp.categorize(r.desc, r.merchant, d)) : null; paint(); }));
      step.querySelectorAll("[data-cat]").forEach(s => (s.onchange = () => {
        const r = rows[+s.dataset.cat]; r.cat = s.value;
        for (const o of rows) if (o.merchant === r.merchant && o.kind === "spend") o.cat = s.value; // same place, same category
        r.learn = true; paint();
      }));
      const cl = step.querySelector("#iClaude");
      if (cl) cl.onclick = async () => {
        cl.disabled = true; cl.textContent = "Claude is sorting…";
        try {
          const map = await claude.sortMerchants(d, uncats);
          let n = 0;
          for (const r of rows) if (r.kind === "spend" && r.cat === "other" && map[r.merchant]) { r.cat = map[r.merchant]; r.learn = true; n++; }
          toast(`Sorted ${n} transaction${n === 1 ? "" : "s"}`); paint();
        } catch (e) { toast(claude.explainError(e)); cl.disabled = false; cl.textContent = "Try again"; }
      };
      step.querySelector("#iGo").onclick = () => {
        let acc = account();
        const before = A.alerts(d).map(x => x.cat.id + x.level).join();
        store.update(x => {
          if (acc.id === "new") { acc = { ...acc, id: uid(), color: acc.type === "credit" ? "#c2477a" : "#3b6fb6" }; x.accounts.push(acc); }
          const now = Date.now();
          for (const r of rows) {
            if (!r.include) continue;
            x.txns.push({ id: uid(), acct: acc.id, date: r.date, amt: r.amt, desc: r.desc, merchant: r.merchant, kind: r.kind, cat: r.kind === "spend" ? r.cat : null, key: r.key, note: "", ts: now, src: "import" });
            if (r.learn && r.cat) x.rules[r.merchant.toUpperCase()] = r.cat;
          }
          if (state.kind === "csv") x.settings.dateOrder = state.dateOrder;
        });
        closeSheet();
        announceAlerts(before, `Imported ${inc.length} transactions into ${acc.name}`);
      };
    }
  });
}

// ====================================================== SETTINGS
export async function openSettings() {
  const d = D(), m = await vault.meta();
  const s = d.settings;
  sheet("Settings", `
    <div class="card"><h2>Claude</h2>
      <label class="field"><span>Claude API key</span><input class="input" id="sK" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…" value="${esc(s.apiKey)}"></label>
      <label class="field"><span>Model</span><select class="input" id="sM">${opts(claude.MODELS.map(x => [x.id, x.label]), s.model)}</select></label>
      <div class="grid2"><button class="btn primary" id="sKS">Save key</button><button class="btn" id="sKT">Test it</button></div>
      <p class="muted small" style="margin:0">The key is stored encrypted on this phone. Claude only gets totals by category and merchant, never full statements or card numbers.</p></div>
    <div class="card"><h2>Security</h2>
      <div class="row"><span>Face ID</span>${m.bio ? `<button class="btn small danger" id="sFOff">Turn off</button>` : `<button class="btn small primary" id="sFOn">Turn on</button>`}</div>
      <label class="field"><span>Lock automatically</span><select class="input" id="sL">${opts([["0", "As soon as I leave the app"], ["1", "After 1 minute"], ["5", "After 5 minutes"], ["15", "After 15 minutes"]], String(s.autoLockMin))}</select></label>
      <button class="btn block" id="sP">Change passcode</button></div>
    <div class="card"><h2>Budget</h2>
      <div class="grid2"><label class="field"><span>Currency symbol</span><input class="input" id="sC" value="${esc(s.currency)}" maxlength="4"></label>
      <label class="field"><span>Warn me at</span><select class="input" id="sW">${opts([["70", "70% of a budget"], ["80", "80% of a budget"], ["90", "90% of a budget"]], String(s.alertPct))}</select></label></div></div>
    <div class="card"><h2>Backup</h2>
      <p class="muted small" style="margin:0">Save an encrypted copy to Files or iCloud Drive. It opens only with your current passcode. Make one after each import.</p>
      <button class="btn primary block" id="sB">Save a backup</button>
      <label class="field"><span>Restore from a backup (replaces everything here)</span><input class="input" id="sRF" type="file" accept=".json,application/json"></label></div>
    <div class="card"><h2>Erase</h2><p class="muted small" style="margin:0">Deletes all your data from this phone. Type ERASE to confirm.</p><input class="input" id="sE" autocapitalize="characters"><button class="btn danger block" id="sEB">Erase everything</button></div>
    <p class="muted small" style="margin:0;text-align:center">Your data is encrypted and never leaves this phone, except the summary sent to Claude when you ask it something.</p>`, (b, close) => {
    const saveKey = () => store.update(x => { x.settings.apiKey = b.querySelector("#sK").value.trim(); x.settings.model = b.querySelector("#sM").value; });
    b.querySelector("#sKS").onclick = () => { saveKey(); toast("Saved"); };
    b.querySelector("#sM").onchange = () => saveKey();
    b.querySelector("#sKT").onclick = async () => {
      saveKey(); const btn = b.querySelector("#sKT"); btn.disabled = true; btn.textContent = "Testing…";
      try { await claude.testKey(D()); toast("Your key works"); } catch (e) { toast(claude.explainError(e)); }
      btn.disabled = false; btn.textContent = "Test it";
    };
    const on = b.querySelector("#sFOn");
    if (on) on.onclick = async () => {
      try { await vault.enableFaceId(); toast("Face ID is on"); openSettings(); }
      catch (e) { toast(e.message === "unsupported" ? "Face ID unlock needs iOS 18 or later" : "Face ID wasn't set up"); }
    };
    const off = b.querySelector("#sFOff"); if (off) off.onclick = async () => { await vault.disableFaceId(); toast("Face ID is off"); openSettings(); };
    b.querySelector("#sL").onchange = e => store.update(x => (x.settings.autoLockMin = +e.target.value));
    b.querySelector("#sC").onchange = e => store.update(x => (x.settings.currency = e.target.value.trim() || "$"));
    b.querySelector("#sW").onchange = e => store.update(x => (x.settings.alertPct = +e.target.value));
    b.querySelector("#sP").onclick = () => openPasscode();
    b.querySelector("#sB").onclick = async () => {
      await vault.flush(() => D());
      await saveFile("budget-backup-" + todayStr() + ".json", await vault.exportBackup(), "application/json");
    };
    b.querySelector("#sRF").onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      sheet("Restore backup", `<p style="margin:0">Enter the passcode this backup was made with. Everything on this phone is replaced by the backup.</p>
        <input class="input" id="rP" type="password" inputmode="numeric" autocomplete="off"><button class="btn primary block" id="rG">Restore</button>`, (bb, cl) => {
        bb.querySelector("#rG").onclick = async () => {
          try { const data = await vault.restoreBackup(await f.text(), bb.querySelector("#rP").value); store.setData(data); cl(); rerender(); toast("Backup restored"); }
          catch (err) { toast(err.message === "wrong passcode" ? "That passcode doesn't open this backup" : "That file isn't a backup from this app"); }
        };
      });
    };
    b.querySelector("#sEB").onclick = async () => {
      if (b.querySelector("#sE").value.trim() !== "ERASE") return toast("Type ERASE to confirm");
      await vault.wipe(); close(); location.hash = ""; location.reload();
    };
  });
}

function openPasscode() {
  sheet("Change passcode", `<input class="input" id="pO" type="password" inputmode="numeric" maxlength="6" placeholder="Current passcode" autocomplete="off">
    <input class="input" id="pN" type="password" inputmode="numeric" maxlength="6" placeholder="New 6-digit passcode" autocomplete="off">
    <input class="input" id="pC" type="password" inputmode="numeric" maxlength="6" placeholder="New passcode again" autocomplete="off">
    <button class="btn primary block" id="pS">Change passcode</button>
    <p class="muted small" style="margin:0">Backups you saved before still open with the old passcode.</p>`, (b, close) => {
    b.querySelector("#pS").onclick = async () => {
      const o = b.querySelector("#pO").value, n = b.querySelector("#pN").value, c = b.querySelector("#pC").value;
      if (!/^\d{6}$/.test(n)) return toast("Use 6 digits");
      if (n !== c) return toast("The new passcodes don't match");
      try { await vault.changePasscode(o, n); close(); toast("Passcode changed"); } catch { toast("The current passcode is wrong"); }
    };
  });
}
