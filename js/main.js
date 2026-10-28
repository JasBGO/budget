// Starts the app: lock screen first, then the five tabs.
import * as vault from "./vault.js";
import * as store from "./store.js";
import { icon, closeSheet, toast } from "./ui.js";
import { views, ui, openAdd, openSettings } from "./views.js";

const app = document.getElementById("app");
const TABS = [["home", "Home", "home"], ["activity", "Activity", "list"], ["budget", "Budget", "pie"], ["cards", "Cards", "card"], ["insights", "Insights", "spark"]];

// ---------- lock screen ----------
async function showLock(mode) {
  closeSheet();
  store.clear();
  const m = mode === "unlock" ? await vault.meta() : null;
  let entry = "", first = null;
  const title = { unlock: "Enter passcode", create: "Create a 6-digit passcode", confirm: "Enter it again" };
  let step = mode;
  app.innerHTML = `<div class="lock">
    <img class="logo" src="icons/icon-192.png" alt="">
    <div><h2 id="lockTitle"></h2><p class="muted small" id="lockSub" style="margin:6px 0 0"></p></div>
    <div class="dots" id="dots"></div>
    <div class="msg" id="lockMsg" role="alert"></div>
    <div class="keypad" id="keypad">
      ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join("")}
      <button class="plain" data-k="bio" ${m?.bio ? "" : "style=\"visibility:hidden\""} aria-label="Unlock with Face ID">${icon("face")}</button>
      <button data-k="0">0</button>
      <button class="plain" data-k="del" aria-label="Delete">Delete</button>
    </div>
    <button class="link" id="forgot" ${mode === "unlock" ? "" : "hidden"}>Forgot passcode?</button>
  </div>`;
  const $ = id => document.getElementById(id);
  const paint = () => {
    $("lockTitle").textContent = title[step];
    $("lockSub").textContent = step === "create" ? "Only this passcode (or your Face ID) opens the app. Your data is encrypted with it." : "";
    $("dots").innerHTML = Array.from({ length: 6 }, (_, i) => `<span class="${i < entry.length ? "on" : ""}"></span>`).join("");
  };
  const fail = msg => { $("lockMsg").textContent = msg; $("dots").classList.remove("shake"); void $("dots").offsetWidth; $("dots").classList.add("shake"); entry = ""; paint(); };
  paint();

  async function done() {
    if (step === "create") { first = entry; entry = ""; step = "confirm"; $("lockMsg").textContent = ""; return paint(); }
    if (step === "confirm") {
      if (entry !== first) { step = "create"; first = null; return fail("Those didn't match. Try again."); }
      $("lockMsg").textContent = "";
      await vault.create(entry, store.freshData());
      return start(await vault.load(), true);
    }
    try {
      $("lockSub").textContent = "Unlocking…";
      const d = await vault.unlockWithPasscode(entry);
      start(d);
    } catch (e) {
      $("lockSub").textContent = "";
      if (e.wait > 0) fail(`Too many tries. Wait ${Math.ceil(e.wait / 1000)} seconds.`);
      else fail("Wrong passcode");
    }
  }
  async function bio() {
    try { start(await vault.unlockWithFaceId()); }
    catch { $("lockMsg").textContent = "Face ID didn't work. Use your passcode."; }
  }
  $("keypad").onclick = e => {
    const k = e.target.closest("[data-k]")?.dataset.k;
    if (!k) return;
    if (k === "bio") return bio();
    if (k === "del") entry = entry.slice(0, -1);
    else if (entry.length < 6) entry += k;
    paint();
    if (entry.length === 6) setTimeout(done, 80);
  };
  document.onkeydown = e => {
    if (!document.getElementById("keypad")) return;
    if (/^\d$/.test(e.key) && entry.length < 6) { entry += e.key; paint(); if (entry.length === 6) setTimeout(done, 80); }
    if (e.key === "Backspace") { entry = entry.slice(0, -1); paint(); }
  };
  $("forgot").onclick = () => forgot();
}

function forgot() {
  import("./ui.js").then(({ sheet }) => sheet("Forgot passcode", `
    <p style="margin:0">Your data is encrypted with your passcode, so nobody can reset it, not even Claude. You have two options:</p>
    <div class="card"><h3>Restore a backup</h3><p class="muted small" style="margin:0">If you remember the passcode a backup was made with, choose the backup file.</p>
      <input type="file" id="rf" accept=".json,application/json" class="input"><input id="rp" class="input" inputmode="numeric" type="password" placeholder="That backup's passcode"><button class="btn primary" id="rb">Restore</button></div>
    <div class="card"><h3>Start over</h3><p class="muted small" style="margin:0">Erases everything on this phone. Type ERASE to confirm.</p>
      <input id="ec" class="input" autocapitalize="characters"><button class="btn danger" id="eb">Erase and start over</button></div>`, (b, close) => {
    b.querySelector("#rb").onclick = async () => {
      const f = b.querySelector("#rf").files[0];
      if (!f) return toast("Choose the backup file first");
      try { const d = await vault.restoreBackup(await f.text(), b.querySelector("#rp").value); close(); start(d); toast("Backup restored"); }
      catch (e) { toast(e.message === "wrong passcode" ? "That passcode doesn't open this backup" : "That file isn't a backup from this app"); }
    };
    b.querySelector("#eb").onclick = async () => {
      if (b.querySelector("#ec").value.trim() !== "ERASE") return toast("Type ERASE to confirm");
      await vault.wipe(); close(); showLock("create");
    };
  }));
}

// ---------- the unlocked app ----------
function start(d, isNew) {
  document.onkeydown = null;
  store.setData(d || store.freshData());
  ui.tab = location.hash.slice(1) && views[location.hash.slice(1)] ? location.hash.slice(1) : "home";
  app.innerHTML = `<main id="screen"></main>
    <button class="fab" id="fab" aria-label="Add a purchase">${icon("plus")}</button>
    <div class="tabbar"><nav>${TABS.map(([id, label, ic]) => `<button data-tab="${id}">${icon(ic)}<span>${label}</span></button>`).join("")}</nav></div>`;
  app.querySelector(".tabbar").onclick = e => { const b = e.target.closest("[data-tab]"); if (b) go(b.dataset.tab); };
  document.getElementById("fab").onclick = () => openAdd();
  render();
  if (isNew) toast("Your app is set up and encrypted");
  updateBadge();
}
export function go(tab) { ui.tab = tab; history.replaceState(null, "", "#" + tab); render(); window.scrollTo(0, 0); }
function render() {
  const screen = document.getElementById("screen");
  if (!screen || !store.data) return;
  app.querySelectorAll("[data-tab]").forEach(b => b.setAttribute("aria-current", b.dataset.tab === ui.tab ? "page" : "false"));
  screen.innerHTML = `<div class="screen">${views[ui.tab].html()}</div>`;
  views[ui.tab].mount?.(screen);
}
store.onChange(() => { render(); updateBadge(); });
window.addEventListener("app:render", render);
window.addEventListener("app:go", e => go(e.detail));
window.addEventListener("app:lock", () => lockNow());
window.addEventListener("app:settings", () => openSettings());

async function updateBadge() {
  if (!navigator.setAppBadge || !store.data) return;
  const { upcoming, alerts } = await import("./analysis.js");
  const n = upcoming(store.data, 3).filter(u => !u.paid).length + alerts(store.data).length;
  (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}

async function lockNow() {
  if (store.data) await vault.flush(() => store.data);
  vault.lock();
  if (updated) return location.reload();
  showLock("unlock");
}

// Auto-lock when the app has been in the background for a while.
let hiddenAt = 0;
document.addEventListener("visibilitychange", async () => {
  if (!store.data) return;
  if (document.hidden) { hiddenAt = Date.now(); await vault.flush(() => store.data); }
  else if (Date.now() - hiddenAt >= (store.data.settings.autoLockMin ?? 1) * 60000) lockNow();
});
window.addEventListener("pagehide", () => { if (store.data) vault.flush(() => store.data); });

// A new version takes over: reload right away on the lock screen, otherwise at the next lock.
let updated = false;
if ("serviceWorker" in navigator && location.protocol === "https:") {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js").then(reg => {
    document.addEventListener("visibilitychange", () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return;
    updated = true;
    if (!store.data) location.reload();
  });
}
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

vault.hasVault().then(has => showLock(has ? "unlock" : "create")).catch(() => {
  app.innerHTML = `<div class="lock"><h2>Storage is blocked</h2><p class="muted">This app needs to save encrypted data on your phone. Private Browsing blocks that. Open it in normal Safari, then Add to Home Screen.</p></div>`;
});
