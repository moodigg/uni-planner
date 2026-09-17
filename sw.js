/* ============================================================
   Uni Planner — service worker (offline support)

   On every deploy: bump VERSION here AND the ?v= numbers in index.html
   so they match. The new worker then re-downloads everything, takes
   over quietly, and the new version shows the next time the app opens.
   Your reminders/classes live in localStorage and are never touched here.
   ============================================================ */
const VERSION = '13';
const SHELL = 'uniplanner-shell-v' + VERSION;
const FONTS = 'uniplanner-fonts-v1';

const ASSETS = [
  './',
  './index.html',
  './styles.css?v=' + VERSION,
  './themes.css?v=' + VERSION,
  './au.css?v=' + VERSION,
  './motion.js?v=' + VERSION,
  './app.js?v=' + VERSION,
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // cache: 'reload' skips the HTTP cache, so we never store a stale copy of index.html
    await cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' })));
    // fonts are nice-to-have: offline still works (with fallback fonts) if this fails
    try { await warmFonts(cache); } catch (err) { /* ignore */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('uniplanner-shell-') && k !== SHELL)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* ---------- notifications from the push worker ---------- */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Uni Planner', body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Uni Planner';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    data: { url: './' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const scope = self.registration.scope;
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = wins.find((w) => w.url.startsWith(scope));
    if (open) return open.focus();
    return self.clients.openWindow(scope);
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // the app page itself: always answer from the saved copy (instant, works offline)
  if (req.mode === 'navigate' && url.origin === self.location.origin && isAppPage(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      return (await cache.match('./index.html')) || fetch(req);
    })());
    return;
  }

  // app files (css/js/icons): saved copy first, network as a fallback
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL);
      return (await cache.match(req)) || fetch(req);
    })());
    return;
  }

  // Google Fonts stylesheet: use saved copy, refresh it in the background when online
  if (url.hostname === 'fonts.googleapis.com') {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // font files never change at a given URL: saved copy first
  if (url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req));
  }
});

function isAppPage(url) {
  const scope = new URL(self.registration.scope);
  if (!url.pathname.startsWith(scope.pathname)) return false;
  const rest = url.pathname.slice(scope.pathname.length);
  return rest === '' || rest === 'index.html';
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req, { ignoreVary: true });
  const refresh = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  return hit || (await refresh) || Response.error();
}

async function cacheFirst(req) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

/* Pre-download the latin font files every theme uses, so Paper/Glass look
   right offline even if you never opened them while online. */
async function warmFonts(shell) {
  const page = await shell.match('./index.html');
  if (!page) return;
  const html = await page.text();
  const m = html.match(/href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]+)"/);
  if (!m) return;
  const cssUrl = m[1].replace(/&amp;/g, '&');
  const fonts = await caches.open(FONTS);
  const cssRes = await fetch(cssUrl, { mode: 'cors', credentials: 'omit' });
  if (!cssRes.ok) return;
  await fonts.put(cssUrl, cssRes.clone());
  const css = await cssRes.text();
  const files = new Set();
  css.split('@font-face').forEach((block) => {
    // "latin" subset only — covers English text; other subsets load on demand when online
    if (!/unicode-range:\s*U\+0000-00FF/i.test(block)) return;
    const src = block.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/);
    if (src) files.add(src[1]);
  });
  await Promise.all([...files].map(async (u) => {
    if (await fonts.match(u)) return;
    const res = await fetch(u, { mode: 'cors', credentials: 'omit' });
    if (res.ok) await fonts.put(u, res);
  }));
}
