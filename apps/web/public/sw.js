/*
 * Precious's service worker. Precious is online-only: it needs your server for every
 * piece of data, so nothing from /api or /media is ever cached. The service worker only
 * makes the app installable and quick to open:
 * - built files (/assets, hashed names) come from the cache once fetched;
 * - pages always come from the network, with a short message when it can't be reached.
 */
const ASSETS = 'precious-assets-v1';
const KEEP = 120;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name !== ASSETS) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Precious</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#16181d;color:#e9ebf0;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px}
b{display:block;font-size:1.3rem;margin-bottom:6px}button{margin-top:16px;padding:8px 16px;border-radius:9px;border:1px solid #2a2e38;background:#1a1d24;color:inherit;font:inherit}</style></head>
<body><div><b>Precious can't reach your server</b>Check your connection (or that the server is running), then try again.<br><button onclick="location.reload()">Try again</button></div></body></html>`;

async function trim(cache) {
  const keys = await cache.keys();
  for (const req of keys.slice(0, Math.max(0, keys.length - KEEP))) await cache.delete(req);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/media/')) return;

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(ASSETS);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) {
          await cache.put(req, res.clone());
          event.waitUntil(trim(cache));
        }
        return res;
      })(),
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => new Response(OFFLINE, { headers: { 'content-type': 'text/html; charset=utf-8' } })),
    );
  }
});
