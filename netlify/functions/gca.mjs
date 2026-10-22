/* GolfCourseAPI pass-through  —  GET /api/gca?search=…   or   GET /api/gca?id=7k2m9qb4

   Keeps the GolfCourseAPI key on Netlify (environment variable GOLFCOURSEAPI_KEY)
   so it never appears in the website, and saves answers (Netlify Blobs) so the
   free plan's 35 requests a day go a long way:
     course scorecards  → saved 90 days
     searches           → saved 3 days
   API docs: https://api.golfcourseapi.com/docs/api/  (openapi.yml there) */

const API = 'https://api.golfcourseapi.com';
const COURSE_TTL = 90 * 864e5, SEARCH_TTL = 3 * 864e5;
const ID_RE = /^[0-9abcdefghjkmnpqrstvwxyz]{8}$/;

function json(body, status, extra){
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...extra } });
}

export function createHandler({ store, key, fetchFn = fetch, now = () => Date.now() }){
  return async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,OPTIONS' } });
    if (req.method !== 'GET') return json({ error: 'GET only' }, 405);
    if (!key) return json({ error: 'not set up', why: 'GOLFCOURSEAPI_KEY is not set on Netlify' }, 503);

    const url = new URL(req.url);
    const id = (url.searchParams.get('id') || '').toLowerCase().trim();
    const q = (url.searchParams.get('search') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
    let path, cacheKey, ttl;
    if (id){
      if (!ID_RE.test(id)) return json({ error: 'bad course id' }, 400);
      path = `/v1/courses/${id}`; cacheKey = `course/${id}`; ttl = COURSE_TTL;
    } else if (q.length >= 3){
      path = `/v1/search?search_query=${encodeURIComponent(q)}`; cacheKey = `search/${q.toLowerCase()}`; ttl = SEARCH_TTL;
    } else return json({ error: 'search (3+ letters) or id is required' }, 400);

    const saved = await store.get(cacheKey, { type: 'json' }).catch(() => null);
    if (saved && now() - saved.ts < ttl) return json({ ...saved.body, cached: true }, 200, { 'Cache-Control': 'public, max-age=3600' });

    let r;
    try {
      const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
      r = await fetchFn(API + path, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }, signal: ctl.signal });
      clearTimeout(t);
    } catch (e){
      if (saved) return json({ ...saved.body, cached: true, stale: true }, 200);
      return json({ error: 'GolfCourseAPI did not answer', why: e.message }, 502);
    }
    if (!r.ok){
      if (saved) return json({ ...saved.body, cached: true, stale: true }, 200);
      const why = r.status === 401 ? 'API key is missing or wrong' : r.status === 429 ? 'daily request limit reached' : r.status === 404 ? 'course not found' : 'HTTP ' + r.status;
      return json({ error: 'GolfCourseAPI refused', status: r.status, why }, r.status === 404 ? 404 : 502);
    }
    const body = await r.json();
    await store.setJSON(cacheKey, { ts: now(), body }).catch(() => {});
    return json(body, 200, { 'Cache-Control': 'public, max-age=3600' });
  };
}

export default async (req) => {
  const { getStore } = await import('@netlify/blobs');
  return createHandler({ store: getStore('golfcourseapi'), key: process.env.GOLFCOURSEAPI_KEY })(req);
};

export const config = { path: '/api/gca' };
