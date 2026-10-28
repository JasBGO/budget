// App state: one plain object, saved encrypted after every change.
import * as vault from "./vault.js";
import { uid, setCurrency } from "./util.js";

export const DEFAULT_CATEGORIES = [
  { id: "groceries", name: "Groceries", budget: 0, color: "#2f8a4c", need: true },
  { id: "rent", name: "Rent & housing", budget: 0, color: "#8a5a44", need: true },
  { id: "bills", name: "Bills & utilities", budget: 0, color: "#7d5ba6", need: true },
  { id: "plans", name: "Payment plans & loans", budget: 0, color: "#4a6670", need: true },
  { id: "transport", name: "Transport & gas", budget: 0, color: "#3b6fb6", need: true },
  { id: "health", name: "Health", budget: 0, color: "#1c9aa0", need: true },
  { id: "dining", name: "Eating out", budget: 0, color: "#d9822b", need: false },
  { id: "shopping", name: "Shopping", budget: 0, color: "#c2477a", need: false },
  { id: "subs", name: "Subscriptions", budget: 0, color: "#5b6ee1", need: false },
  { id: "fun", name: "Entertainment", budget: 0, color: "#d4a514", need: false },
  { id: "personal", name: "Personal care", budget: 0, color: "#b5651d", need: false },
  { id: "other", name: "Other", budget: 0, color: "#7b8a84", need: false }
];

export function freshData() {
  return {
    v: 1,
    settings: { currency: "$", income: 0, alertPct: 80, autoLockMin: 1, apiKey: "", model: "claude-opus-5-5", dateOrder: "mdy" },
    accounts: [{ id: "cash", name: "Cash", type: "cash", color: "#2f8a4c" }],
    categories: structuredClone(DEFAULT_CATEGORIES),
    txns: [],
    rules: {},
    bills: [],
    goals: [],
    claude: { lastReview: "", lastReviewAt: "" },
    alertsShown: {}
  };
}

export let data = null;
const listeners = new Set();
export function onChange(fn) { listeners.add(fn); }

export function setData(d) {
  data = d;
  // Fill in anything a newer version added.
  const f = freshData();
  for (const k in f) if (data[k] === undefined) data[k] = f[k];
  for (const k in f.settings) if (data.settings[k] === undefined) data.settings[k] = f.settings[k];
  // Rent and payment plans became their own categories; add them to older vaults.
  for (const [i, c] of DEFAULT_CATEGORIES.entries()) {
    if (["rent", "plans"].includes(c.id) && !data.categories.some(x => x.id === c.id)) data.categories.splice(Math.min(i, data.categories.length), 0, structuredClone(c));
  }
  const bills = data.categories.find(c => c.id === "bills");
  if (bills?.name === "Bills & rent") bills.name = "Bills & utilities";
  setCurrency(data.settings.currency);
}
export function clear() { data = null; }

// Every mutation goes through here so the vault is saved and the screen redrawn.
export function update(fn) {
  fn(data);
  setCurrency(data.settings.currency);
  vault.saveSoon(() => data);
  listeners.forEach(l => l());
}

export const catById = id => data.categories.find(c => c.id === id) || { id, name: "Uncategorized", color: "#7b8a84", budget: 0, need: false };
export const acctById = id => data.accounts.find(a => a.id === id) || { id, name: "Unknown account", type: "bank", color: "#7b8a84" };
export const newId = uid;
