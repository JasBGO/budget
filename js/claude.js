// Claude inside the app. Calls go straight from the phone to the Claude API with Jas's own key.
// Claude gets a summary (totals by category and merchant, budgets, cards, goals). The one exception is
// readStatement, which sends the statement pictures or PDF that Jas chooses to have read.
import { Anthropic } from "../vendor/anthropic.js";
import { insights, totalBudget, safeToday, upcoming } from "./analysis.js";
import { round2, todayStr, monthLabel, toB64 } from "./util.js";

export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (best advice, a few cents per review)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (cheaper)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (cheapest, about a tenth of a cent)" }
];

function client(d) {
  return new Anthropic({ apiKey: d.settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

// Opus and Sonnet 5.5 accept server-side fallbacks, so a declined request is re-run on another model.
function extras(model) {
  return model === "claude-haiku-5-5" ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
}

export function summary(d) {
  const ins = insights(d, 3), s = safeToday(d), r = n => round2(n);
  return {
    today: todayStr(),
    currency: d.settings.currency,
    monthly_income: r(+d.settings.income || ins.income),
    window: { from: ins.start, to: ins.end, months: r(ins.monthsSpan) },
    average_monthly_spending: r(ins.perMonth),
    categories: d.categories.map(c => {
      const row = ins.catRows.find(x => x.cat.id === c.id);
      return { name: c.name, type: c.need ? "need" : "want", monthly_budget: +c.budget || 0, average_monthly_spend: r(row?.avg || 0) };
    }),
    this_month: { label: monthLabel(todayStr()), budget: totalBudget(d), spent_so_far: r(s.monthSpent), days_left: s.daysLeft },
    top_merchants: ins.merchants.slice(0, 25).map(m => ({ merchant: m.merchant, per_month: r(m.perMonth), visits: m.count, category: d.categories.find(c => c.id === m.cat)?.name })),
    repeating_charges: ins.recurring.map(x => ({ merchant: x.merchant, monthly: x.amount })),
    small_frequent_purchases: ins.small.map(m => ({ merchant: m.merchant, visits: m.count, per_month: r(m.perMonth) })),
    cards: d.accounts.filter(a => a.type === "credit").map(a => ({ name: a.name, balance: +a.balance || 0, limit: +a.limit || 0, apr: +a.apr || 0, min_payment: +a.minPay || 0, due_day: +a.dueDay || null })),
    upcoming_bills: upcoming(d, 30).map(u => ({ name: u.name, amount: u.amount, due: u.due })),
    savings_goals: d.goals.map(g => ({ name: g.name, target: +g.target, saved: +g.saved, by: g.by || null }))
  };
}

const SYSTEM = `You are the budgeting coach built into the person's private budgeting app on their iPhone.
You get a summary of their real spending (monthly averages over recent months), their budget, cards, bills and goals.
Be direct and practical, like a friend who is good with money. Use their actual numbers and merchant names.
Never invent transactions or figures that aren't in the data. If the data is thin (under a month), say so.
Write in short paragraphs and "- " bullet lists, with "## " headings when the answer has sections. Keep it under 300 words unless asked for more.
When you suggest cuts, give each one an estimated monthly saving.
When you propose a budget, end your answer with a fenced json block exactly like:
\`\`\`json
{"budget": {"<category name>": <monthly amount>, ...}}
\`\`\`
using the exact category names from the data and every category. The app shows an "Apply this budget" button for it.`;

// Streams an answer. `history` is [{role, content}] from earlier in this conversation.
export async function ask(d, question, history, onText) {
  const model = d.settings.model || "claude-opus-5-5";
  const messages = [...history, { role: "user", content: question }];
  const stream = client(d).beta.messages.stream({
    model, max_tokens: 8000,
    system: SYSTEM + "\n\nTheir data:\n" + JSON.stringify(summary(d)),
    messages, ...extras(model)
  });
  let text = "";
  stream.on("text", delta => { text += delta; onText(text); });
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") throw new Error("Claude declined to answer that. Try rewording the question.");
  return text;
}

// Sort merchants Claude can recognise into categories. Sends merchant names only.
export async function sortMerchants(d, merchants) {
  const model = d.settings.model || "claude-opus-5-5";
  const names = d.categories.map(c => c.name);
  const res = await client(d).beta.messages.create({
    model, max_tokens: 4000,
    messages: [{ role: "user", content:
      `Sort these card/bank statement merchants into one of these budget categories: ${JSON.stringify(names)}.
Use "Other" only if you really can't tell. Reply with only a JSON object mapping each merchant to a category name.
Merchants: ${JSON.stringify(merchants)}` }],
    ...extras(model)
  });
  if (res.stop_reason === "refusal") return {};
  const text = res.content.filter(b => b.type === "text").map(b => b.text).join("");
  const json = /\{[\s\S]*\}/.exec(text);
  if (!json) return {};
  const map = JSON.parse(json[0]), out = {};
  for (const [m, name] of Object.entries(map)) {
    const c = d.categories.find(c => c.name.toLowerCase() === String(name).toLowerCase());
    if (c) out[m] = c.id;
  }
  return out;
}

export async function testKey(d) {
  await client(d).messages.create({ model: "claude-haiku-5-5", max_tokens: 5, messages: [{ role: "user", content: "Reply OK" }] });
}

export function explainError(e) {
  if (e instanceof Anthropic.AuthenticationError) return "Your Claude API key was rejected. Check it in Settings.";
  if (e instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use that model.";
  if (e instanceof Anthropic.RateLimitError) return "Claude is busy or you've hit your spend limit. Try again in a minute.";
  if (e instanceof Anthropic.BadRequestError) return /credit|balance|billing/i.test(e.message) ? "Your Claude API credit has run out. Add more at console.anthropic.com." : "Claude couldn't process that request.";
  if (e instanceof Anthropic.APIConnectionError) return "Can't reach Claude. Check your internet connection.";
  if (e instanceof Anthropic.APIError) return "Claude had a problem (" + e.status + "). Try again shortly.";
  return e?.message || "Something went wrong talking to Claude.";
}

// ---------- Reading a statement from pictures or a PDF ----------
const STATEMENT_SCHEMA = {
  type: "object",
  properties: {
    transactions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          date: { type: "string", description: "Transaction date as YYYY-MM-DD" },
          description: { type: "string", description: "Merchant or description exactly as printed" },
          amount: { type: "number", description: "Positive for money out (purchases, fees, interest, withdrawals). Negative for money in (payments to the card, refunds, deposits)." }
        },
        required: ["date", "description", "amount"],
        additionalProperties: false
      }
    },
    // Card details printed on the statement. Empty string when the statement doesn't show it.
    statement_date: { type: "string", description: "Statement (closing) date as YYYY-MM-DD, or empty" },
    payment_due_date: { type: "string", description: "Payment due date as YYYY-MM-DD, or empty" },
    new_balance: { type: "string", description: "New/closing balance owed, digits only like 1840.25, or empty" },
    minimum_payment: { type: "string", description: "Minimum payment due, digits only, or empty" },
    credit_limit: { type: "string", description: "Credit limit, digits only, or empty" },
    purchase_apr: { type: "string", description: "Annual interest rate on purchases in percent, like 20.99, or empty" }
  },
  required: ["transactions", "statement_date", "payment_due_date", "new_balance", "minimum_payment", "credit_limit", "purchase_apr"],
  additionalProperties: false
};

// Photos from the iPhone camera can be HEIC and very large: redraw as a JPEG no wider than 2000px.
async function imageBlock(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("That picture couldn't be opened.")); i.src = url; });
    const k = Math.min(1, 2000 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.85));
    return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: toB64(await blob.arrayBuffer()) } };
  } finally { URL.revokeObjectURL(url); }
}
export const isPicture = f => /^image\//.test(f.type) || /\.(pdf|jpe?g|png|heic|heif|webp)$/i.test(f.name) || f.type === "application/pdf";

// Returns { rows: [{date, desc, amt}] in the same shape as a parsed CSV, info: card details found or null }.
export async function readStatement(d, files) {
  const model = d.settings.model || "claude-opus-5-5";
  const blocks = [];
  for (const f of files) {
    if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: toB64(await f.arrayBuffer()) } });
    else blocks.push(await imageBlock(f));
  }
  blocks.push({ type: "text", text: `These are pages or screenshots of one bank or credit card statement. Today is ${todayStr()}.
List every transaction exactly once, in order. Skip balances, subtotals, totals, summaries and repeated rows that appear on more than one page or screenshot.
If a date has no year, use the statement period to work it out; otherwise assume the most recent date not after today.` });
  const stream = client(d).beta.messages.stream({
    model, max_tokens: 32000,
    output_config: { format: { type: "json_schema", schema: STATEMENT_SCHEMA } },
    messages: [{ role: "user", content: blocks }], ...extras(model)
  });
  const msg = await stream.finalMessage();
  if (msg.stop_reason === "refusal") throw new Error("Claude declined to read that. Try a clearer picture.");
  if (msg.stop_reason === "max_tokens") throw new Error("That statement is too long to read at once. Try fewer pages.");
  const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
  const res = JSON.parse(text), out = res.transactions || [];
  const day = v => /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : null, num = v => { const n = parseFloat(String(v || "").replace(/[^\d.]/g, "")); return isFinite(n) ? n : null; };
  const info = { statementDate: day(res.statement_date), dueDate: day(res.payment_due_date), balance: num(res.new_balance), minPay: num(res.minimum_payment), limit: num(res.credit_limit), apr: num(res.purchase_apr) };
  const rows = out.filter(t => /^\d{4}-\d{2}-\d{2}$/.test(t.date) && isFinite(+t.amount) && t.description).map(t => ({ date: t.date, desc: String(t.description).trim(), amt: round2(+t.amount) }));
  return { rows, info: Object.values(info).some(v => v != null) ? info : null };
}

// Pull the {"budget": {...}} block out of an answer, mapped to category ids.
export function budgetFrom(text, d) {
  const m = /```json\s*([\s\S]*?)```/.exec(text);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[1]).budget;
    const out = {};
    for (const [name, amt] of Object.entries(obj || {})) {
      const c = d.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
      if (c && isFinite(+amt)) out[c.id] = Math.max(0, Math.round(+amt));
    }
    return Object.keys(out).length ? out : null;
  } catch { return null; }
}
