/* Caddie Voice service worker: lets the app open with weak or no signal.
   - The app page: try the network first (so updates show up), fall back to the saved copy.
   - App files, map library, fonts: saved on first use, served from the phone after that.
   - Satellite and OpenStreetMap map tiles: saved as you view them (up to ~1500), so a course you've
     looked at before still shows its photo with poor signal.
   - Hand-made course maps (GolfCourseMaps/): newest when online, saved copy offline.
   - Course search and map data are NOT handled here; the app already saves those itself.
   Bump VERSION whenever this file changes. */
const VERSION = 'v4';
const SHELL = `cv-shell-${VERSION}`, TILES = 'cv-tiles', MAX_TILES = 1500;
const SHELL_FILES = ['./', './index.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './icons/favicon-64.png'];
const LIBS = ['https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
  'https://cdn.jsdelivr.net/npm/leaflet-rotate@0.2.8/dist/leaflet-rotate-src.js'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll(SHELL_FILES);
    await Promise.allSettled(LIBS.map(u => c.add(new Request(u, { mode: 'no-cors' }))));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('cv-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function trimTiles(){
  const c = await caches.open(TILES), keys = await c.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await c.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // The app page itself: network first, saved copy when offline.
  if (req.mode === 'navigate'){
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        const c = await caches.open(SHELL); c.put('./index.html', res.clone());
        return res;
      } catch {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // Hand-made course maps (GolfCourseMaps/): newest copy when there's signal, saved copy when not.
  if (url.origin === self.location.origin && url.pathname.includes('/GolfCourseMaps/')){
    e.respondWith((async () => {
      const c = await caches.open(SHELL);
      try { const res = await fetch(req, { cache:'no-store' }); if (res.ok) c.put(req, res.clone()); return res; }
      catch { return (await c.match(req)) || Response.error(); }
    })());
    return;
  }

  // Satellite tiles: saved copy first, otherwise download and save.
  if (url.hostname === 'server.arcgisonline.com' || url.hostname === 'tile.openstreetmap.org'){
    e.respondWith((async () => {
      const c = await caches.open(TILES), hit = await c.match(req);
      if (hit) return hit;
      try { const res = await fetch(req); if (res.ok || res.type === 'opaque'){ c.put(req, res.clone()); trimTiles(); } return res; }
      catch { return Response.error(); }
    })());
    return;
  }

  // App files, map library and fonts: saved copy first, refreshed in the background.
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin || url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'cdn.jsdelivr.net' || url.hostname.endsWith('fonts.googleapis.com') || url.hostname.endsWith('fonts.gstatic.com')){
    e.respondWith((async () => {
      const c = await caches.open(SHELL), hit = await c.match(req);
      const fresh = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => null);
      return hit || (await fresh) || Response.error();
    })());
  }
  // Everything else (course search, OpenStreetMap) goes straight to the network.
});
