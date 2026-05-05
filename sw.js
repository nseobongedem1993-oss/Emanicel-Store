// ══════════════════════════════════════════════════════
//  Emanicel Business Portal — Service Worker
//  Strategy:
//    • App shell  → Cache-first (instant load)
//    • CDN assets → Cache-first (fonts, icons, libs)
//    • Supabase   → Network-only (live data)
//    • Navigate   → Network-first → cache fallback
// ══════════════════════════════════════════════════════

const CACHE_VERSION = 'v2';
const SHELL_CACHE   = `emanicel-shell-${CACHE_VERSION}`;
const CDN_CACHE     = `emanicel-cdn-${CACHE_VERSION}`;
const DATA_CACHE    = `emanicel-data-${CACHE_VERSION}`;
const ALL_CACHES    = [SHELL_CACHE, CDN_CACHE, DATA_CACHE];

// App shell — files hosted on YOUR origin
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// CDN scripts — pre-cached on install so app loads fully offline
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.39.3/dist/umd/supabase.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
  'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
  'https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap',
];

// CDN assets — external libraries (cache on first fetch)
const CDN_ORIGINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
];

// Supabase origins — network-first with cache fallback for offline support
const SUPABASE_ORIGINS = [
  'supabase.co',
  'supabase.io',
];

// ── INSTALL: pre-cache app shell + CDN scripts ────────
self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_ASSETS)),
      caches.open(CDN_CACHE).then(cache =>
        Promise.allSettled(CDN_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('SW: failed to pre-cache', url, err))
        ))
      ),
    ]).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: clean up old caches ─────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => !ALL_CACHES.includes(key))
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())  // take control immediately
  );
});

// ── FETCH: route requests ──────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and browser-extension requests
  if (request.method !== 'GET') return;
  if (!['http:', 'https:'].includes(url.protocol)) return;

  // Supabase → network-first, cache fallback (works offline with last known data)
  if (SUPABASE_ORIGINS.some(o => url.hostname.includes(o))) {
    event.respondWith(networkFirstData(request));
    return;
  }

  // CDN assets → cache-first
  if (CDN_ORIGINS.some(o => url.hostname.includes(o))) {
    event.respondWith(cacheFirst(request, CDN_CACHE));
    return;
  }

  // Navigation (HTML page) → network-first, fallback to cache
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Own-origin assets → cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }
});

// ── Strategies ────────────────────────────────────────

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()); // store for next time
    }
    return response;
  } catch {
    return new Response('Offline — resource not cached.', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    // Last resort: return the cached index.html for offline SPA support
    const fallback = await caches.match('./index.html');
    return fallback || new Response(offlinePage(), {
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

// Network-first for Supabase — caches responses so data available offline
async function networkFirstData(request) {
  const cache = await caches.open(DATA_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'offline', message: 'No cached data available' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Minimal offline fallback page (shown if index.html isn't cached yet)
function offlinePage() {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Emanicel — Offline</title>
  <style>
    body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;
      justify-content:center;min-height:100vh;background:#f5f4f0;color:#1a2e1a;text-align:center;padding:20px}
    .icon{font-size:4rem;margin-bottom:16px}
    h1{font-size:1.4rem;font-weight:800;margin-bottom:8px}
    p{font-size:.9rem;color:#5a7a5a;max-width:300px;line-height:1.6}
    button{margin-top:24px;padding:12px 28px;background:#1a5c2e;color:#fff;border:none;
      border-radius:12px;font-size:.9rem;font-weight:700;cursor:pointer}
  </style></head>
  <body>
    <div class="icon">📶</div>
    <h1>You're Offline</h1>
    <p>Emanicel needs a connection to load for the first time. Please check your internet and try again.</p>
    <button onclick="location.reload()">Try Again</button>
  </body></html>`;
}

// ── MESSAGE: skip waiting on demand (from update toast) ──
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
