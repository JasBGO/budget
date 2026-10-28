// Builds the "Export to Google Sheets" workbook: transactions, monthly totals, budget, cards and bills.
// Everything is made on the phone; nothing is uploaded.
import { buildXlsx, ref } from "./xlsx.js";
import * as A from "./analysis.js";
import { monthStart, monthEnd, addMonths, monthLabel, todayStr, round2 } from "./util.js";

const money = v => ({ v: round2(+v || 0), fmt: "money" });
const KIND = { spend: "Spending", income: "Money in", transfer: "Transfer / card payment" };

export function workbook(d) {
  const acct = Object.fromEntries(d.accounts.map(a => [a.id, a.name]));
  const cat = Object.fromEntries(d.categories.map(c => [c.id, c.name]));
  const txns = [...d.txns].sort((a, b) => b.date.localeCompare(a.date) || (b.ts || 0) - (a.ts || 0));

  const tx = [["Date", "Account", "Merchant", "Description", "Category", "Type", "Money out", "Money in", "Note"],
    ...txns.map(t => [{ v: t.date, fmt: "date" }, acct[t.acct] || "", t.merchant || "", t.desc || "", t.kind === "spend" ? cat[t.cat] || "Other" : "", KIND[t.kind] || t.kind,
      t.amt > 0 ? money(t.amt) : null, t.amt < 0 ? money(-t.amt) : null, t.note || ""])];

  // One row per month from the first transaction to now, one column per category.
  const cats = d.categories, months = [];
  const first = txns.length ? txns[txns.length - 1].date : todayStr();
  for (let m = monthStart(first); m <= todayStr(); m = addMonths(m, 1)) months.push(m);
  const mo = [["Month", ...cats.map(c => c.name), "Total spent", "Money in"]];
  const last = cats.length; // column index of "Total spent"
  for (const m of months.reverse()) {
    const r = mo.length, items = A.spendIn(d, m, monthEnd(m)), by = A.byCategory(items);
    mo.push([monthLabel(m), ...cats.map(c => by[c.id] ? money(by[c.id]) : null),
      { f: `SUM(${ref(1, r)}:${ref(last, r)})`, fmt: "total" },
      money(d.txns.filter(t => t.kind === "income" && t.date >= m && t.date <= monthEnd(m)).reduce((s, t) => s - t.amt, 0))]);
  }

  const avg = A.insights(d, 3).catRows;
  const bu = [["Category", "Need or want", "Monthly budget", "Average spent (last 3 months)", "Left over"]];
  for (const c of cats) {
    const r = bu.length;
    bu.push([c.name, c.need ? "Need" : "Want", money(c.budget), money(avg.find(x => x.cat.id === c.id)?.avg || 0), { f: `${ref(2, r)}-${ref(3, r)}`, fmt: "money" }]);
  }
  const n = bu.length - 1;
  bu.push(["Total", "", { f: `SUM(C2:C${n + 1})`, fmt: "total" }, { f: `SUM(D2:D${n + 1})`, fmt: "total" }, { f: `SUM(E2:E${n + 1})`, fmt: "total" }]);

  const credit = d.accounts.filter(a => a.type === "credit");
  const ca = [["Card", "Balance", "Limit", "Used", "Interest (APR %)", "Minimum payment", "Statement day", "Due day", "Last paid", "Last payment"]];
  for (const a of credit) {
    const r = ca.length;
    ca.push([a.name, money(a.balance), a.limit ? money(a.limit) : null, a.limit ? { f: `${ref(1, r)}/${ref(2, r)}`, fmt: "pct" } : null,
      a.apr ? +a.apr : null, a.minPay ? money(a.minPay) : null, a.statementDay ? +a.statementDay : null, a.dueDay ? +a.dueDay : null,
      a.lastPaid?.date ? { v: a.lastPaid.date, fmt: "date" } : null, a.lastPaid?.amt ? money(a.lastPaid.amt) : null]);
  }
  if (credit.length) ca.push(["Total", { f: `SUM(B2:B${credit.length + 1})`, fmt: "total" }, { f: `SUM(C2:C${credit.length + 1})`, fmt: "total" }, { f: `B${credit.length + 2}/C${credit.length + 2}`, fmt: "pct" }]);

  const TYPE = { rent: "Rent / housing", plan: "Payment plan", bill: "Bill" };
  const bi = [["Bill", "Type", "Amount", "Due day", "Payments left", "Paid from"],
    ...d.bills.map(b => [b.name, TYPE[b.type || "bill"], money(b.amount), b.dueDay ? +b.dueDay : null, b.paymentsLeft === "" || b.paymentsLeft == null ? null : +b.paymentsLeft, acct[b.acct] || ""])];
  if (d.bills.length) bi.push(["Total each month", "", { f: `SUM(C2:C${d.bills.length + 1})`, fmt: "total" }]);

  return buildXlsx([
    { name: "Transactions", cols: [12, 18, 22, 36, 22, 22, 12, 12, 24], rows: tx },
    { name: "Monthly", cols: [12, ...cats.map(() => 14), 14, 12], rows: mo },
    { name: "Budget", cols: [24, 12, 16, 28, 14], rows: bu },
    { name: "Cards", cols: [22, 12, 12, 9, 15, 16, 14, 9, 12, 13], rows: ca },
    { name: "Bills", cols: [24, 16, 12, 9, 14, 18], rows: bi }
  ]);
}
