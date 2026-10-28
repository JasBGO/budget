// Encrypted storage. All app data is one JSON document encrypted with AES-GCM under a random
// data key. The data key is stored only in wrapped (encrypted) form: once under a key derived
// from the passcode (PBKDF2), and optionally once under a key from a Face ID passkey (WebAuthn PRF).
// Nothing readable is ever written to disk, and nothing leaves the phone.

import { toB64, fromB64 } from "./util.js";

const DB = "budget-vault", STORE = "kv", ITER = 600000;
const enc = new TextEncoder(), dec = new TextDecoder();
const rand = n => crypto.getRandomValues(new Uint8Array(n));

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode), req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); res(req?.result); };
    t.onerror = () => { db.close(); rej(t.error); };
  });
}
const kvGet = k => tx("readonly", s => s.get(k));
const kvSet = (k, v) => tx("readwrite", s => s.put(v, k));
const kvClear = () => tx("readwrite", s => s.clear());

async function passKey(passcode, salt, iter) {
  const base = await crypto.subtle.importKey("raw", enc.encode(passcode), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function prfKey(prfOutput) {
  const base = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: enc.encode("budget-faceid") }, base,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function seal(key, bytes) {
  const iv = rand(12);
  return { iv: toB64(iv), ct: toB64(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes)) };
}
async function unseal(key, box) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(box.iv) }, key, fromB64(box.ct)));
}
const dataKey = raw => crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);

// The unlocked session. `raw` is the data key, kept in memory only while unlocked so the
// passcode or Face ID wrapping can be changed.
let session = null;

export const isUnlocked = () => !!session;
export async function hasVault() { return !!(await kvGet("meta")); }
export async function meta() { return kvGet("meta"); }

export async function create(passcode, initialData) {
  const raw = rand(32), salt = rand(16);
  const m = { v: 1, salt: toB64(salt), iter: ITER, pass: await seal(await passKey(passcode, salt, ITER), raw), fails: 0 };
  await kvClear();
  await kvSet("meta", m);
  session = { raw, key: await dataKey(raw) };
  await save(initialData);
}

export async function unlockWithPasscode(passcode) {
  const m = await kvGet("meta");
  const wait = lockoutLeft(m);
  if (wait > 0) throw Object.assign(new Error("locked"), { wait });
  try {
    const raw = await unseal(await passKey(passcode, fromB64(m.salt), m.iter), m.pass);
    m.fails = 0; m.lockUntil = 0; await kvSet("meta", m);
    session = { raw, key: await dataKey(raw) };
    return load();
  } catch {
    m.fails = (m.fails || 0) + 1;
    // After 5 wrong tries, wait 30 s, then double it each time.
    if (m.fails >= 5) m.lockUntil = Date.now() + 30000 * 2 ** (m.fails - 5);
    await kvSet("meta", m);
    throw Object.assign(new Error("wrong"), { fails: m.fails, wait: lockoutLeft(m) });
  }
}
function lockoutLeft(m) { return Math.max(0, (m.lockUntil || 0) - Date.now()); }

export async function load() {
  const box = await kvGet("data");
  if (!box) return null;
  return JSON.parse(dec.decode(await unseal(session.key, box)));
}

let pending = null, saving = Promise.resolve();
export function save(data) {
  if (!session) return Promise.resolve();
  const bytes = enc.encode(JSON.stringify(data));
  const key = session.key;
  saving = saving.then(async () => kvSet("data", await seal(key, bytes)));
  return saving;
}
// Coalesce bursts of edits into one encrypted write.
export function saveSoon(getData) {
  clearTimeout(pending);
  pending = setTimeout(() => save(getData()), 250);
}
export async function flush(getData) { clearTimeout(pending); if (session) await save(getData()); }

export function lock() { clearTimeout(pending); session = null; }

export async function changePasscode(current, next) {
  const m = await kvGet("meta");
  const raw = await unseal(await passKey(current, fromB64(m.salt), m.iter), m.pass);
  const salt = rand(16);
  m.salt = toB64(salt); m.iter = ITER; m.pass = await seal(await passKey(next, salt, ITER), raw);
  await kvSet("meta", m);
}

export async function wipe() { session = null; await kvClear(); }

// ---------- Face ID (WebAuthn passkey with the PRF extension) ----------
export function faceIdPossible() { return !!(window.PublicKeyCredential && navigator.credentials); }

export async function enableFaceId() {
  if (!session) throw new Error("locked");
  const prfSalt = rand(32);
  const cred = await navigator.credentials.create({ publicKey: {
    rp: { name: "Budget", id: location.hostname },
    user: { id: rand(16), name: "budget", displayName: "Budget app" },
    challenge: rand(32),
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "required" },
    extensions: { prf: { eval: { first: prfSalt } } }
  } });
  const ext = cred.getClientExtensionResults?.() || {};
  if (!ext.prf || ext.prf.enabled === false) throw new Error("unsupported");
  const credId = new Uint8Array(cred.rawId);
  let out = ext.prf.results?.first;
  if (!out) out = await prfOutput(credId, prfSalt);
  const m = await kvGet("meta");
  m.bio = { credId: toB64(credId), prfSalt: toB64(prfSalt), box: await seal(await prfKey(out), session.raw) };
  await kvSet("meta", m);
}
async function prfOutput(credId, prfSalt) {
  const a = await navigator.credentials.get({ publicKey: {
    challenge: rand(32), userVerification: "required",
    allowCredentials: [{ type: "public-key", id: credId }],
    extensions: { prf: { eval: { first: prfSalt } } }
  } });
  const out = a.getClientExtensionResults?.().prf?.results?.first;
  if (!out) throw new Error("unsupported");
  return out;
}
export async function unlockWithFaceId() {
  const m = await kvGet("meta");
  if (!m.bio) throw new Error("not set up");
  const out = await prfOutput(fromB64(m.bio.credId), fromB64(m.bio.prfSalt));
  const raw = await unseal(await prfKey(out), m.bio.box);
  m.fails = 0; m.lockUntil = 0; await kvSet("meta", m);
  session = { raw, key: await dataKey(raw) };
  return load();
}
export async function disableFaceId() { const m = await kvGet("meta"); delete m.bio; await kvSet("meta", m); }

// ---------- Backups ----------
// A backup is the encrypted vault as-is: it opens only with the passcode that was set when it was made.
export async function exportBackup() {
  const m = await kvGet("meta"), data = await kvGet("data");
  const { bio, fails, lockUntil, ...rest } = m;
  return JSON.stringify({ app: "jas-budget-backup", v: 1, made: new Date().toISOString(), meta: rest, data });
}
export async function restoreBackup(text, passcode) {
  const b = JSON.parse(text);
  if (b.app !== "jas-budget-backup" || !b.meta?.pass || !b.data) throw new Error("not a backup");
  const raw = await unseal(await passKey(passcode, fromB64(b.meta.salt), b.meta.iter), b.meta.pass).catch(() => { throw new Error("wrong passcode"); });
  const key = await dataKey(raw);
  const data = JSON.parse(dec.decode(await unseal(key, b.data)));
  await kvClear();
  await kvSet("meta", { ...b.meta, fails: 0 });
  await kvSet("data", b.data);
  session = { raw, key };
  return data;
}
