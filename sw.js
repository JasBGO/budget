// Keeps the app working offline. Bump VERSION whenever any file changes so phones pick up the update.
const VERSION = "budget-v6";
const FILES = ["./", "index.html", "manifest.webmanifest", "css/app.css",
  "js/main.js", "js/views.js", "js/ui.js", "js/store.js", "js/vault.js", "js/analysis.js", "js/importer.js", "js/claude.js", "js/util.js",
  "vendor/anthropic.js", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png"];

// "reload" skips the browser's HTTP cache, so a new version caches new files.
self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES.map(f => new Request(f, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// App files: from the cache first, updated in the background. Claude API calls are never cached.
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request.url, { cache: "no-cache" }).then(r => { if (r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});
