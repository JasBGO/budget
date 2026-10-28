// Reads bank and card statements (CSV, OFX/QFX) into transactions, sorts them into categories,
// spots card payments and transfers, and skips anything already imported. Runs entirely on the phone.
import { merchantOf } from "./analysis.js";
import { pad, round2 } from "./util.js";

// ---------- CSV ----------
export function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const delim = [",", ";", "\t", "|"].map(d => [d, (text.split("\n")[0].match(new RegExp("\\" + d, "g")) || []).length])
    .sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell.trim()); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell.trim()); cell = "";
      if (row.some(x => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some(x => x !== "")) rows.push(row);
  return rows;
}

const H = {
  date: /^(transaction |trans\.? |posted |posting |value |booking )?date$|^date posted$|^trans date$|^datum$/i,
  desc: /description|payee|merchant|^name$|details|narrative|^memo$|transaction$|^particulars$/i,
  amount: /^(transaction )?amount( \(.*\))?$|^amt$|^value$/i,
  debit: /debit|withdrawal|money out|paid out|^out$|charges?$/i,
  credit: /credit|deposit|money in|paid in|^in$|payments?$/i
};
// Find the header row (some banks put account details above it) and guess each column's role.
export function detectMapping(rows) {
  let hi = -1;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const hits = rows[i].filter(c => Object.values(H).some(r => r.test(c))).length;
    const numbers = rows[i].filter(c => parseAmount(c) !== null).length;
    if (hits >= 2 && numbers === 0) { hi = i; break; }
  }
  const header = hi >= 0 ? rows[hi] : rows[0].map((_, i) => "Column " + (i + 1));
  const body = rows.slice(hi + 1).filter(r => r.length >= 2);
  const find = re => header.findIndex(h => re.test(h));
  let m = { date: find(H.date), desc: find(H.desc), amount: find(H.amount), debit: find(H.debit), credit: find(H.credit) };
  if (m.date < 0) m.date = header.findIndex(h => /date/i.test(h));
  if (m.amount >= 0) { m.debit = -1; m.credit = -1; }
  // No usable header: guess from the values themselves.
  const sample = body.slice(0, 30);
  const score = (i, test) => sample.filter(r => test(r[i] ?? "")).length;
  const cols = header.map((_, i) => i);
  if (m.date < 0) m.date = cols.sort((a, b) => score(b, isDateLike) - score(a, isDateLike))[0];
  // Headerless debit/credit layout (TD EasyWeb: date, description, debit, credit, balance):
  // two money columns that are each only sometimes filled, and never on the same row.
  if (hi < 0 && m.amount < 0 && m.debit < 0) {
    const money = cols.filter(i => i !== m.date && sample.some(r => parseAmount(r[i]) !== null));
    const partial = money.filter(i => sample.some(r => !(r[i] || "").trim()));
    if (partial.length >= 2) {
      const [a, b] = partial;
      if (!sample.some(r => (r[a] || "").trim() && (r[b] || "").trim())) { m.debit = a; m.credit = b; }
    }
  }
  if (m.amount < 0 && m.debit < 0) m.amount = [...cols].filter(i => i !== m.date).sort((a, b) => score(b, v => parseAmount(v) !== null) - score(a, v => parseAmount(v) !== null))[0];
  if (m.desc < 0) m.desc = [...cols].filter(i => i !== m.date && i !== m.amount).sort((a, b) => avgLen(sample, b) - avgLen(sample, a))[0];
  return { header, body, mapping: m, dateOrder: guessDateOrder(body.map(r => r[m.date])) };
}
const avgLen = (rows, i) => rows.reduce((t, r) => t + (isNaN(parseFloat(r[i])) ? (r[i] || "").length : 0), 0) / (rows.length || 1);
const isDateLike = v => /^\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}/.test(v) || /^\d{1,2} [A-Za-z]{3}/.test(v) || /^[A-Za-z]{3} \d{1,2}/.test(v);

export function parseAmount(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/(-|\bDR)$/i.test(s)) { neg = true; s = s.replace(/(-|\bDR)$/i, ""); }
  s = s.replace(/\bCR$/i, "");
  s = s.replace(/[^\d.,\-]/g, "");
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  // "1.234,56" style
  if (/,\d{2}$/.test(s) && !/\.\d{2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  return neg ? -n : n;
}

function guessDateOrder(values) {
  for (const v of values) {
    const m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-]\d{2,4}/.exec(v || "");
    if (!m) continue;
    if (+m[1] > 12) return "dmy";
    if (+m[2] > 12) return "mdy";
  }
  return null;
}
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function parseDateStr(v, order) {
  v = String(v || "").trim();
  let m;
  if ((m = /^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/.exec(v))) return mk(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{4})(\d{2})(\d{2})/.exec(v))) return mk(+m[1], +m[2], +m[3]);
  if ((m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(v))) {
    let y = +m[3]; if (y < 100) y += 2000;
    return order === "dmy" ? mk(y, +m[2], +m[1]) : mk(y, +m[1], +m[2]);
  }
  if ((m = /^(\d{1,2})[ \-]([A-Za-z]{3})[a-z]*[ \-,]+(\d{2,4})/.exec(v))) { let y = +m[3]; if (y < 100) y += 2000; return mk(y, MONTHS[m[2].toLowerCase()], +m[1]); }
  if ((m = /^([A-Za-z]{3})[a-z]* (\d{1,2}),? (\d{4})/.exec(v))) return mk(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
  return null;
}
function mk(y, mo, d) {
  if (!y || !mo || !d || mo > 12 || d > 31) return null;
  return y + "-" + pad(mo) + "-" + pad(d);
}

// Rows from a CSV under a given mapping. `out` = which sign means money out ("neg" or "pos").
export function rowsFromCSV(parsed, mapping, dateOrder, out) {
  const res = [];
  for (const r of parsed.body) {
    const date = parseDateStr(r[mapping.date], dateOrder);
    let amt = null;
    if (mapping.amount >= 0) {
      const a = parseAmount(r[mapping.amount]);
      if (a !== null) amt = out === "pos" ? a : -a;
    } else {
      const db = parseAmount(r[mapping.debit]), cr = parseAmount(r[mapping.credit]);
      if (db) amt = Math.abs(db); else if (cr) amt = -Math.abs(cr);
    }
    if (!date || amt === null || amt === 0) continue;
    res.push({ date, amt: round2(amt), desc: (r[mapping.desc] || "").replace(/\s+/g, " ").trim() });
  }
  return res;
}
// Which sign is money out? Most lines on a statement are purchases.
export function guessOutSign(parsed, mapping) {
  if (mapping.amount < 0) return "pos";
  let neg = 0, pos = 0;
  for (const r of parsed.body) { const a = parseAmount(r[mapping.amount]); if (a < 0) neg++; else if (a > 0) pos++; }
  return neg >= pos ? "neg" : "pos";
}

// ---------- OFX / QFX ----------
export function parseOFX(text) {
  const out = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  const tag = (b, t) => (new RegExp("<" + t + ">([^<\\r\\n]*)", "i").exec(b) || [])[1]?.trim();
  for (const b of blocks) {
    const amt = parseFloat(tag(b, "TRNAMT"));
    const date = parseDateStr((tag(b, "DTPOSTED") || "").slice(0, 8));
    if (!date || !amt) continue;
    const desc = [tag(b, "NAME"), tag(b, "MEMO")].filter(Boolean).join(" ").replace(/&amp;/g, "&");
    out.push({ date, amt: round2(-amt), desc, fitid: tag(b, "FITID") });
  }
  return out;
}

// ---------- Sorting ----------
const KEYWORDS = [
  ["subs", /crave|cbc gem|netflix|spotify|hulu|disney ?\+|disney plus|hbo|\bmax\.com|youtube ?premium|youtubepremium|google ?one|google storage|icloud|apple\.com\/bill|apple music|amazon prime|prime video|audible|patreon|openai|chatgpt|anthropic|claude\.ai|adobe|microsoft ?365|office 365|xbox game pass|playstation ?plus|paramount|peacock|crunchyroll|duolingo|dropbox|sirius|onlyfans|twitch/i],
  ["dining", /a&w|harvey|swiss chalet|east side mario|boston pizza|pizza pizza|pizza nova|mary brown|osmow|freshii|second cup|skip ?the ?dishes|uber ?eats|doordash|grubhub|postmates|deliveroo|just ?eat|skip ?the ?dishes|mcdonald|starbucks|dunkin|chipotle|subway|taco bell|wendy|burger|pizza|domino|kfc|chick-?fil|panera|popeyes|five guys|shake shack|sonic drive|arby|jack in the box|dairy queen|tim hortons|panda express|wingstop|ihop|denny|applebee|olive garden|chili's|cafe|coffee|restaurant|grill|diner|bistro|sushi|ramen|bakery|kitchen|tavern|\bbar\b|\bpub\b|brew/i],
  ["groceries", /loblaw|superstore|real canadian|no frills|zehrs|fortinos|provigo|maxi |sobeys|safeway|foodland|freshco|food basics|metro |iga |save-on|longo|farm boy|t&t|independent grocer|valu-mart|walmart|wal-mart|kroger|safeway|costco|aldi|trader joe|whole foods|wholefds|publix|wegmans|h-?e-?b\b|food lion|giant eagle|stop & shop|sprouts|lidl|tesco|sainsbury|asda|morrisons|loblaw|no frills|sobeys|metro inc|woolworths|coles|meijer|winco|albertsons|vons|ralphs|fry's food|food 4 less|smart & final|save mart|piggly|hy-vee|instacart|grocery|supermarket|market\b/i],
  ["transport", /petro-?canada|esso|husky|ultramar|pioneer|irving|co-op gas|presto|ttc|translink|stm |go transit|via rail|westjet|air canada|porter air|flair air|impark|green p|honk|407 etr|\buber\b(?! ?eats)|lyft|shell|exxon|chevron|\bbp\b|mobil|texaco|sunoco|citgo|marathon|speedway|wawa|sheetz|racetrac|quiktrip|qt \d|circle k|7-eleven|valero|arco|76 |fuel|gas station|parking|park mobile|parkmobile|toll|e-?zpass|transit|metro card|\bmta\b|amtrak|greyhound|airline|delta air|united air|southwest|american air|jetblue|spirit air|frontier air|car wash|autozone|jiffy|o'reilly|advance auto|dmv/i],
  ["bills", /rogers|bell canada|bell mobility|telus|fido|koodo|virgin plus|freedom mobile|chatr|public mobile|shaw comm|shaw cable|videotron|hydro|enbridge|fortis|epcor|enmax|atco|toronto hydro|intact|desjardins ins|belairdirect|td insurance|cooperators|rent|mortgage|property|electric|energy|power co|water|sewer|utility|utilities|comcast|xfinity|verizon|at&t|att\*|t-mobile|tmobile|sprint|spectrum|cox comm|optimum|frontier comm|internet|insurance|geico|progressive|state farm|allstate|liberty mutual|usaa|loan|student ln|navient|nelnet|sallie|hoa|phone bill|cricket|metro by|boost mobile|mint mobile/i],
  ["health", /shoppers drug|rexall|london drugs|jean coutu|pharmasave|goodlife|pharmacy|cvs|walgreens|rite aid|boots|doctor|dental|dentist|clinic|hospital|medical|health|urgent care|optometr|vision|planet fitness|la fitness|24 hour fitness|anytime fitness|crunch fit|equinox|orangetheory|\bgym\b|fitness|labcorp|quest diag/i],
  ["fun", /cinema|theater|theatre|\bamc\b|regal|cinemark|ticketmaster|stubhub|eventbrite|live nation|steam|steampowered|playstation network|nintendo|xbox|epic games|roblox|bowling|golf|arcade|museum|concert|zoo|six flags|disneyland|bar & grill|casino|lottery|draftkings|fanduel/i],
  ["personal", /salon|barber|hair|nail|spa\b|ulta|sephora|beauty|massage|cosmetic/i],
  ["shopping", /canadian tire|dollarama|winners|homesense|marshalls|sport chek|mark's|giant tiger|hudson|the bay|indigo|staples|best buy|london drugs|simons|roots|amazon|amzn|target|best buy|ebay|etsy|ikea|home depot|lowe's|lowes|tj ?maxx|marshalls|ross stores|old navy|\bgap\b|h&m|zara|nike|adidas|shein|temu|macy|nordstrom|kohl|jcpenney|dollar tree|dollar general|five below|walgreens.com|apple store|wayfair|michaels|hobby lobby|petsmart|petco|bath & body|victoria|foot locker|uniqlo|primark/i]
];
const TRANSFER = /payment\s*(-\s*)?(thank|received|recvd)|thank you.*payment|autopay|auto pay|auto-pay|online payment|mobile payment|card payment|credit card|crd pmt|card pmt|cc pmt|pymt|ctfs|canadian tire bank|cdn tire mc|triangle (mc|mastercard|world)|epayment|e-payment|bill pay.*(card|mastercard|visa)|transfer|xfer|trnsfr|to savings|from savings|to checking|from checking|venmo cashout|zelle (to|from) (self|me)|mastercard pmt|capital one.*(pmt|payment|mobile)|chase.*(epay|card)|citi.*(payment|autopay)|amex.*(payment|epayment)|discover.*(payment|e-pay)|barclaycard/i;
const INCOME = /payroll|direct dep|dir dep|salary|paycheck|wages|irs treas|tax ref|deposit from|interest paid|interest earned|dividend/i;

export function categorize(desc, merchant, d) {
  const learned = d.rules[merchant.toUpperCase()];
  if (learned && d.categories.some(c => c.id === learned)) return learned;
  for (const [id, re] of KEYWORDS) if (re.test(desc) && d.categories.some(c => c.id === id)) return id;
  return d.categories.some(c => c.id === "other") ? "other" : d.categories[d.categories.length - 1].id;
}

// Turn raw rows into transactions for one account.
export function prepare(rows, account, d) {
  const cardNames = d.accounts.filter(a => a.type === "credit").map(a => a.name.toLowerCase()).filter(n => n.length > 2);
  const existing = new Set(d.txns.filter(t => t.acct === account.id && t.key).map(t => t.key));
  const seen = {};
  return rows.map(r => {
    const merchant = merchantOf(r.desc);
    const low = r.desc.toLowerCase();
    let kind = "spend";
    if (TRANSFER.test(r.desc) || cardNames.some(n => low.includes(n))) kind = "transfer";
    else if (r.amt < 0) kind = account.type === "credit" ? "spend" /* refund */ : (INCOME.test(r.desc) || r.amt <= -100 ? "income" : "spend");
    // A card's own payment lines are always transfers.
    if (account.type === "credit" && r.amt < 0 && /payment|thank you|autopay/i.test(r.desc)) kind = "transfer";
    const base = r.fitid ? "ofx:" + r.fitid : [r.date, Math.round(r.amt * 100), r.desc.toUpperCase()].join("|");
    seen[base] = (seen[base] || 0) + 1;
    const key = r.fitid ? base : base + "|" + seen[base];
    return {
      date: r.date, amt: r.amt, desc: r.desc, merchant, kind,
      cat: kind === "spend" ? categorize(r.desc, merchant, d) : null,
      key, duplicate: existing.has(key), include: !existing.has(key)
    };
  });
}
