/* Caddie Voice course-data service  —  GET/POST /api/course?lat=..&lon=..

   Phones ask this first for a course's map data (greens, tees, holes…).
   - Saved copy (Netlify Blobs) less than 30 days old → returned right away.
   - Otherwise this fetches it from OpenStreetMap's public Overpass servers,
     trying each one, saves it, and returns it.
   - If a phone had to fetch from OpenStreetMap itself, it POSTs the result
     here so the course is saved for everyone.

   Response: { ts, area, near, cached? , stale? }
     area = Overpass JSON for features inside the golf course boundary
     near = Overpass JSON for golf features within 1.5 km (fallback)
   The queries must match courseQuery / nearQuery in index.html. */

const SERVERS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const TTL = 30 * 864e5;            // keep a course for 30 days
const EMPTY_TTL = 864e5;           // "nothing mapped here" is rechecked after a day
const BUDGET_MS = 9000;            // Netlify stops functions at 10 s
const MAX_POST = 3e6;
const UA = 'CaddieVoice/1.0 (personal golf yardage app; https://github.com/daniradler/GolfApp)';

export const areaQuery = (la, lo) => `[out:json][timeout:25];
(way["leisure"="golf_course"](around:500,${la},${lo});relation["leisure"="golf_course"](around:500,${la},${lo}););
out geom;
map_to_area->.a;
(way["golf"](area.a);node["golf"](area.a);relation["golf"](area.a);way["natural"~"^(water|sand)$"](area.a);relation["natural"="water"](area.a););
out geom;`;
export const nearQuery = (la, lo) => `[out:json][timeout:25];
(way["golf"](around:1500,${la},${lo});node["golf"](around:1500,${la},${lo});relation["golf"](around:1500,${la},${lo});way["natural"~"^(water|sand)$"](around:1200,${la},${lo}););
out geom;`;

const els = j => (j && Array.isArray(j.elements)) ? j.elements : [];
const golfCount = j => els(j).filter(e => e.tags && e.tags.golf).length;
const isEmpty = rec => golfCount(rec.area) + golfCount(rec.near) === 0;
const holeCount = rec => [rec.area, rec.near].reduce((n, j) => n + els(j).filter(e => e.tags && e.tags.golf === 'hole').length, 0);

function json(body, status, headers){
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

async function overpass(query, fetchFn, deadline){
  let last = new Error('out of time');
  for (const url of SERVERS){
    const left = deadline - Date.now();
    if (left < 1500) break;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), Math.min(left - 300, 8000));
    try {
      const r = await fetchFn(url, { method: 'POST', body: 'data=' + encodeURIComponent(query), signal: ctl.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      if (!Array.isArray(j.elements)) throw new Error('bad answer');
      return j;
    } catch (e){ last = e; }
    finally { clearTimeout(t); }
  }
  throw last;
}

/* Built as a factory so it can be tested without Netlify. */
export function createHandler({ store, fetchFn = fetch, now = () => Date.now(), budgetMs = BUDGET_MS }){
  return async (req) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    const lat = Number(url.searchParams.get('lat')), lon = Number(url.searchParams.get('lon'));
    if (!url.searchParams.get('lat') || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      return json({ error: 'lat and lon are required' }, 400, cors);
    const key = `v1/${lat.toFixed(4)},${lon.toFixed(4)}`;
    const la = lat.toFixed(5), lo = lon.toFixed(5);
    const read = () => store.get(key, { type: 'json' }).catch(() => null);

    /* A phone that fetched the data itself shares it. */
    if (req.method === 'POST'){
      const text = await req.text();
      if (text.length > MAX_POST) return json({ error: 'too large' }, 413, cors);
      let body; try { body = JSON.parse(text); } catch { return json({ error: 'not JSON' }, 400, cors); }
      const rec = { ts: now(), area: body && body.area && Array.isArray(body.area.elements) ? body.area : null,
                    near: body && body.near && Array.isArray(body.near.elements) ? body.near : null, from: 'phone' };
      if (!rec.area && !rec.near) return json({ error: 'expected area / near' }, 400, cors);
      if (isEmpty(rec)) return json({ saved: false, reason: 'empty' }, 200, cors);
      const old = await read();
      if (old && now() - old.ts < TTL && holeCount(old) >= holeCount(rec) && !isEmpty(old)) return json({ saved: false, reason: 'have it' }, 200, cors);
      await store.setJSON(key, rec);
      return json({ saved: true }, 200, cors);
    }
    if (req.method !== 'GET') return json({ error: 'GET or POST' }, 405, cors);

    const fresh = url.searchParams.get('fresh') === '1';
    const cached = await read();
    if (cached && !fresh && now() - cached.ts < (isEmpty(cached) ? EMPTY_TTL : TTL))
      return json({ ...cached, cached: true }, 200, { ...cors, 'Cache-Control': 'public, max-age=3600' });

    /* Both lookups at once so they fit inside Netlify's time limit. */
    const deadline = Date.now() + budgetMs;
    const [a, n] = await Promise.allSettled([overpass(areaQuery(la, lo), fetchFn, deadline), overpass(nearQuery(la, lo), fetchFn, deadline)]);
    const rec = { ts: now(), area: a.status === 'fulfilled' ? a.value : null, near: n.status === 'fulfilled' ? n.value : null, from: 'server' };

    if (!rec.area && !rec.near){
      if (cached) return json({ ...cached, cached: true, stale: true }, 200, cors);      // old copy beats nothing
      const why = (a.reason || n.reason || {}).message || 'unknown';
      return json({ error: 'OpenStreetMap did not answer', why }, 502, cors);
    }
    if (!(cached && !isEmpty(cached) && isEmpty(rec))) await store.setJSON(key, rec).catch(() => {});
    return json(rec, 200, { ...cors, 'Cache-Control': 'public, max-age=3600' });
  };
}

export default async (req) => {
  const { getStore } = await import('@netlify/blobs');
  return createHandler({ store: getStore('course-maps') })(req);
};

export const config = { path: '/api/course' };
