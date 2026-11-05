/* iGolf course data  —  GET /api/igolf?action=…

   Ready for the iGolf Connect partnership. Everything is built except the two
   pieces that need iGolf's partner documentation (they only give it to partners):

     ① igolf.send()       how a request is signed and sent          (look for ①)
     ② igolf.toCourses() / igolf.toNeutral()   their field names    (look for ②)

   Fill those in, add the keys on Netlify, and the app starts using iGolf:
   search results, scorecards, and GPS hole maps (exact front/center/back,
   colored tee boxes, hazards, outlines) — playing exactly like a hand-made map.

   Netlify settings (Site configuration → Environment variables, mark as secret):
     IGOLF_API_KEY      application API key from iGolf
     IGOLF_SECRET_KEY   secret key used to sign requests
     IGOLF_BASE_URL     endpoint base iGolf gives you
     IGOLF_CACHE_DAYS   optional, how long a course is kept (default 30; follow
                        what the iGolf license allows)

   Actions
     status                        → { configured, connected, missing, usage }
     search&q=bethpage             → { courses:[{ id, name, city, state, lat, lon }] }
     near&lat=..&lon=..&name=..    → best-matching iGolf course near a point, with its data
     course&id=..                  → { course, scorecard, map }
   scorecard = same shape the app uses for OpenGolfAPI / GolfCourseAPI
   map       = same format as GolfCourseMaps/*.json (see GolfCourseMaps/README.md)

   Every request iGolf bills for is counted per month (status → usage), and
   answers are saved so the same course is never paid for twice. */

export class NotReady extends Error { constructor(what){ super(`iGolf connection not finished: ${what}`); this.what = what; } }

/* =====================================================================================
   iGolf adapter. Only this block depends on iGolf's private documentation.
   Request names below are the ones iGolf Connect is known to use; confirm them,
   and the exact parameters, against the documentation they send.
   ===================================================================================== */
export const igolf = {
  requests: {
    search: q => ({ name:'CourseList', params:{ name:q, active:1 } }),
    near:   (lat, lon) => ({ name:'CourseList', params:{ referenceLatitude:lat, referenceLongitude:lon, radius:5, active:1 } }),
    course: id => [
      { name:'CourseDetails',          params:{ id_course:id } },
      { name:'CourseTeeDetails',       params:{ id_course:id } },
      { name:'CourseScorecardDetails', params:{ id_course:id } },
      { name:'CourseGPSDetails',       params:{ id_course:id } },
      { name:'CourseGPSVectorDetails', params:{ id_course:id } },   // outlines; only if your plan includes them
    ],
  },

  /* ① Send one signed request and return iGolf's JSON.
     iGolf supplies the signature algorithm and sample code with your keys.
     Typically: build the request URL for `name`, compute a signature from it
     with IGOLF_SECRET_KEY plus a timestamp, attach it, POST `params` as JSON. */
  async send(name, params, env, fetchFn){
    throw new NotReady('request signing (①) — needs the iGolf signature sample code');
  },

  /* ② Their course list → [{ id, name, city, state, lat, lon }] */
  toCourses(raw){
    throw new NotReady('course list fields (②) — needs an example CourseList response');
  },

  /* ② Their responses for one course (keyed by request name) → the neutral shape:
     {
       course: { id, name, city, state, lat, lon },
       tees:   [{ name, gender:'male'|'female', par, yards, rating, slope }],
       holes:  [{ number, par, handicap, yards:{ <tee name>: yards },
                  teeBoxes: [{ tee:<tee name>, point:[lat,lng], outline?:[[lat,lng],…] }],
                  green:    { front:[lat,lng], center?:[lat,lng], back:[lat,lng], outline? },
                  fairway?: [[lat,lng],…], bend?: [lat,lng],
                  hazards:  [{ type:'sand'|'water'|'other', point?:[lat,lng], outline?:[…] }] }]
     }
     Everything after this (scorecard, map file, caching) is already done. */
  toNeutral(byName){
    throw new NotReady('course detail fields (②) — needs example GPS / scorecard responses');
  },
};
/* ===================================================================================== */

const SEARCH_TTL = 7 * 864e5;
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', ...extra } });

/* ---------- neutral shape → what the app uses (done; tested) ---------- */
const TEE_ALIASES = [
  ['black', ['black', 'championship', 'tips', 'tournament', 'pro']],
  ['blue',  ['blue', 'back', 'mens', 'men']],
  ['white', ['white', 'middle', 'regulation']],
  ['gold',  ['gold', 'yellow', 'senior', 'seniors', 'intermediate']],
  ['red',   ['red', 'forward', 'ladies', 'women', 'womens']],
];
const words = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
export const colorOf = name => (TEE_ALIASES.find(([, al]) => words(name).some(w => al.includes(w))) || [])[0] || null;
const r6 = p => p && [+(+p[0]).toFixed(6), +(+p[1]).toFixed(6)];
const pt = p => Array.isArray(p) && p.length >= 2 && Number.isFinite(+p[0]) && Number.isFinite(+p[1]) ? r6(p) : null;
const ring = a => Array.isArray(a) ? a.map(pt).filter(Boolean) : null;
const slug = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
/* a small circle (for a hazard iGolf gives only as a point) */
function circle(c, m, n = 8){
  const k = Math.cos(c[0] * Math.PI / 180), out = [];
  for (let i = 0; i < n; i++){ const a = 2 * Math.PI * i / n; out.push(r6([c[0] + m * Math.sin(a) / 111320, c[1] + m * Math.cos(a) / (111320 * k)])); }
  return out;
}
/* an oval green from front/back when no outline is supplied */
function ellipse(f, b, n = 16){
  const k = Math.cos(f[0] * Math.PI / 180), c = [(f[0] + b[0]) / 2, (f[1] + b[1]) / 2];
  const dy = (b[0] - f[0]) * 111320, dx = (b[1] - f[1]) * 111320 * k, len = Math.hypot(dx, dy) || 20, ux = dx / len, uy = dy / len;
  const a = Math.max(len / 2, 8), w = Math.max(a * 0.7, 7), out = [];
  for (let i = 0; i < n; i++){ const t = 2 * Math.PI * i / n, x = Math.cos(t) * a * ux - Math.sin(t) * w * uy, y = Math.cos(t) * a * uy + Math.sin(t) * w * ux;
    out.push(r6([c[0] + y / 111320, c[1] + x / (111320 * k)])); }
  return out;
}
export function toScorecard(n){
  const tees = (n.tees || []).filter(t => t && t.name);
  return { id:n.course.id, course_name:n.course.name, club_name:n.course.name, city:n.course.city, state:n.course.state,
    lat:n.course.lat, lng:n.course.lon, par:tees[0]?.par ?? null,
    tees: tees.map(t => ({ name:t.name, gender:t.gender || 'male', par:t.par ?? null, yardage:t.yards ?? null, rating:t.rating ?? null, slope:t.slope ?? null })),
    holes_data: (n.holes || []).slice().sort((a, b) => a.number - b.number).map(h => ({ number:h.number, par:h.par ?? null, hcp:h.handicap ?? null,
      yardages: Object.fromEntries(Object.entries(h.yards || {}).map(([k, v]) => [k.toLowerCase(), v])) })) };
}
const ORDER = ['black', 'blue', 'white', 'gold', 'red'];
export function toCourseMap(n){
  const holes = {};
  for (const h of n.holes || []){
    const front = pt(h.green?.front), back = pt(h.green?.back);
    if (!h.number || !front || !back) continue;                     // a hole needs at least the green
    const tees = {}, teeboxes = {};
    for (const tb of h.teeBoxes || []){
      const c = colorOf(tb.tee) || 'white', p = pt(tb.point); if (!p || tees[c]) continue;
      tees[c] = p; const o = ring(tb.outline); if (o?.length > 2) teeboxes[c] = o;
    }
    const tee = ORDER.map(c => tees[c]).find(Boolean) || null;
    const greenOutline = ring(h.green?.outline);
    holes[h.number] = { tees, tee, front, back, center: pt(h.green?.center),
      green: greenOutline?.length > 2 ? greenOutline : ellipse(front, back),
      teeboxes, fairway: ring(h.fairway)?.length > 2 ? ring(h.fairway) : null, bend: pt(h.bend) || null,
      hazards: (h.hazards || []).map(z => {
        const type = z.type === 'water' ? 'water' : 'sand', o = ring(z.outline), p = pt(z.point);
        const shape = o?.length > 2 ? o : p ? circle(p, type === 'water' ? 20 : 8) : null;
        return shape && { type, shape };
      }).filter(Boolean) };
  }
  return { version:1, id:'igolf-' + slug(n.course.name || n.course.id), name:n.course.name, source:'igolf',
    center: pt([n.course.lat, n.course.lon]), ids:{ igolf:n.course.id }, holes, updated:new Date().toISOString() };
}

/* ---------- the service ---------- */
const nameMatch = (a, b) => { const A = words(a).filter(w => w.length > 2 && !['golf', 'club', 'course', 'country', 'the'].includes(w)), B = new Set(words(b));
  return A.length ? A.filter(w => B.has(w)).length / A.length : 0; };
const distM = (a, b) => { const r = Math.PI / 180, dLa = (b[0] - a[0]) * r, dLo = (b[1] - a[1]) * r;
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(h)); };

export function createHandler({ store, env = {}, fetchFn = fetch, now = () => Date.now(), adapter = igolf }){
  const configured = !!(env.IGOLF_API_KEY && env.IGOLF_SECRET_KEY && env.IGOLF_BASE_URL);
  const courseTTL = (+env.IGOLF_CACHE_DAYS || 30) * 864e5;
  const month = () => new Date(now()).toISOString().slice(0, 7);
  async function count(name){                                         // billed requests per month
    const k = `usage/${month()}`, u = (await store.get(k, { type:'json' }).catch(() => null)) || {};
    u[name] = (u[name] || 0) + 1; await store.setJSON(k, u).catch(() => {});
  }
  async function call(r){ const out = await adapter.send(r.name, r.params, env, fetchFn); await count(r.name); return out; }   // count only what was actually sent
  async function cached(key, ttl, make){
    const s = await store.get(key, { type:'json' }).catch(() => null);
    if (s && now() - s.ts < ttl) return { ...s.body, cached:true };
    try { const body = await make(); await store.setJSON(key, { ts:now(), body }).catch(() => {}); return body; }
    catch (e){ if (s && !(e instanceof NotReady)) return { ...s.body, cached:true, stale:true }; throw e; }
  }
  async function courseData(id){
    return cached(`course/${id}`, courseTTL, async () => {
      const byName = {};
      for (const r of adapter.requests.course(id)){
        try { byName[r.name] = await call(r); }
        catch (e){ if (e instanceof NotReady) throw e; byName[r.name] = { error:e.message }; }   // e.g. vector maps not in the plan
      }
      const n = adapter.toNeutral(byName);
      return { course:n.course, scorecard:toScorecard(n), map:toCourseMap(n) };
    });
  }

  return async (req) => {
    if (req.method === 'OPTIONS') return new Response(null, { status:204, headers:{ 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,OPTIONS' } });
    if (req.method !== 'GET') return json({ error:'GET only' }, 405);
    const u = new URL(req.url), action = u.searchParams.get('action') || 'status';
    try {
      if (action === 'status'){
        let connected = false, missing = null;
        if (configured){ try { await adapter.send('ping', {}, env, () => { throw new Error('no network in status check'); }); } catch (e){ if (e instanceof NotReady) missing = e.what; else connected = true; } }
        const usage = (await store.get(`usage/${month()}`, { type:'json' }).catch(() => null)) || {};
        return json({ configured, connected, missing: configured ? missing : 'IGOLF_API_KEY / IGOLF_SECRET_KEY / IGOLF_BASE_URL on Netlify', month:month(), usage });
      }
      if (!configured) return json({ error:'not set up', why:'iGolf keys are not on Netlify yet' }, 503);
      if (action === 'search'){
        const q = (u.searchParams.get('q') || '').trim().replace(/\s+/g, ' ').slice(0, 80);
        if (q.length < 3) return json({ error:'q (3+ letters) is required' }, 400);
        return json(await cached(`search/${q.toLowerCase()}`, SEARCH_TTL, async () => ({ courses: adapter.toCourses(await call(adapter.requests.search(q))) })));
      }
      if (action === 'near'){
        const lat = +u.searchParams.get('lat'), lon = +u.searchParams.get('lon'), name = u.searchParams.get('name') || '';
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !u.searchParams.get('lat')) return json({ error:'lat and lon are required' }, 400);
        const list = await cached(`near/${lat.toFixed(3)},${lon.toFixed(3)}`, SEARCH_TTL, async () => ({ courses: adapter.toCourses(await call(adapter.requests.near(lat, lon))) }));
        const best = (list.courses || []).map(c => ({ c, d: distM([lat, lon], [c.lat, c.lon]), m: nameMatch(name, c.name) }))
          .filter(x => x.d < 2500 && (x.d < 700 || x.m >= 0.5)).sort((a, b) => (b.m - a.m) || (a.d - b.d))[0];
        if (!best) return json({ found:false });
        return json({ found:true, ...(await courseData(best.c.id)) });
      }
      if (action === 'course'){
        const id = (u.searchParams.get('id') || '').trim();
        if (!/^[\w-]{1,40}$/.test(id)) return json({ error:'bad course id' }, 400);
        return json(await courseData(id));
      }
      return json({ error:'unknown action' }, 400);
    } catch (e){
      if (e instanceof NotReady) return json({ error:'not finished', why:e.message }, 501);
      return json({ error:'iGolf did not answer', why:e.message }, 502);
    }
  };
}

export default async (req) => {
  const { getStore } = await import('@netlify/blobs');
  return createHandler({ store:getStore('igolf'), env:process.env })(req);
};

export const config = { path: '/api/igolf' };
