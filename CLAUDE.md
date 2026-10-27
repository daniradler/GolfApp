# Caddie Voice — project notes for Claude

A golf yardage app. The owner wants it to tell him his yardage **out loud** so he
doesn't have to pull out his phone, and the long-term goal is **phone + smartwatch
working together**. Today it is a single-file web app hosted on Netlify; native
iPhone/Watch (or Android/Wear OS) apps are the planned next stage.

The owner is not a programmer. Explain things in plain language, give
step-by-step instructions for anything he has to click, and test before
saying something works.

## How it's built

- **One file: `index.html`.** HTML, CSS and JS inline. No build step, no framework.
  Edit it directly.
- **Map:** Leaflet 1.9.4 from cdnjs. Esri World Imagery tiles for satellite.
  Leaflet's CSS is NOT loaded from a CDN; the few rules it needs are inlined
  under `/* Leaflet essentials */`. If something map-related looks broken
  (tiles misplaced, markers invisible), a missing Leaflet CSS rule is the
  first suspect.
- **Installable web app (PWA):** `manifest.webmanifest` (name, colors, icons in
  `icons/`), `sw.js` service worker (network-first for the page, cache-first for
  app files/Leaflet/fonts, saves up to 1500 Esri tiles; course search and
  Overpass are not cached by it — the app caches those in localStorage).
  **Bump `VERSION` in sw.js whenever sw.js or the list of app files changes.**
  `netlify.toml` sets no-cache on sw.js/index.html so updates arrive.
  Registered at the end of index.html only on https/localhost.
- **Course-data service:** `netlify/functions/course.mjs` at `/api/course?lat=&lon=`
  (Netlify Functions v2 + Netlify Blobs store `course-maps`, key `v1/lat4,lon4`).
  GET returns `{ts, area, near}` (raw Overpass JSON for the boundary query and the
  1.5 km query; same queries as index.html — keep them in sync). Saved copies are
  served for 30 days (empty results 1 day); on a miss it queries Overpass itself
  (both queries in parallel, 3 servers, 9 s budget for Netlify's 10 s limit);
  if everything fails it serves a stale copy or 502. POST lets a phone that
  fetched directly share `{area, near}` (≤3 MB, non-empty, not replacing a
  better copy). `fresh=1` forces a refetch (Retry button). Logic is in
  `createHandler()` so it can be tested with a fake store/fetch.
  The app tries the service first (`loadOSM`), falls back to Overpass directly,
  then `shareCourse()`s the result. On localhost (no service) the 404 just
  falls through to direct Overpass.
- **Deploy:** Netlify is linked to this repo. Every push to `main` goes live in
  about a minute. There is no staging site, so test locally before pushing.
- **Run locally:** `python3 tools/serve.py` (= `npm start`), then
  http://localhost:8000. It's `http.server` plus a `PUT /GolfCourseMaps/<id>.json`
  handler (127.0.0.1 only, .json in that folder only, ≤2 MB) that writes the map
  and rebuilds `GolfCourseMaps/index.json`. The preview config
  `.claude/launch.json` ("golf") runs it; that file is excluded from git via
  `.git/info/exclude`. Plain `http.server` works too, but then maps save only
  in the browser. See README.md.

## App flow (current)

0. **Start screen** (`#start`): two big buttons, **Play a round** /
   **Map a course**. Both open the course picker (`#home`, `showPicker()`,
   `appMode` = 'play' | 'map'); ‹ returns to the start screen. Opening a course
   goes to the overview (play) or straight into the mapper (map).
1. **Select a course** (`#home`): search box + saved courses. Typing 3+
   letters searches online (debounced 400 ms). Search is forgiving
   (`matchScore()`): it queries OpenGolfAPI with the full phrase and with each
   important word (stop words like golf/course/club/at/the are ignored), retries
   with 4-letter stems if nothing comes back, then ranks by word matches in any
   order, partial words and small typos (edit distance, swaps count as one).
   "bethpage black" → "Black at Bethpage". Nominatim results are merged in when
   no result matches every word.
2. **Course overview**: full-screen satellite map fitted to the whole course,
   all mapped holes numbered, tee picker chips, big **Start round** button at
   75% of screen height. ‹ goes back to course list.
3. **Round**: one hole at a time. Map shows only the current hole's features
   (route line, its green with front/middle/back dots, nearby tee/fairway/
   bunkers/water). Hole card at bottom: ‹ Hole N › , par · yards (tee) · handicap,
   **live GPS yardage** to Front / Middle / Back, **Pin the green**. **End round**
   (top right) returns to overview.
   - GPS (`startGPS()` on Start round, `stopGPS()` on End round / back):
     `watchPosition`, blue dot + accuracy circle on the map. Your own green pin
     replaces the mapped green and gives a middle number only. Over 1500 yds
     from the green shows "–" and how many miles away you are.
   - **Tap the map** (when not pinning) to drop a yellow spot: map label and the
     yellow box show spot→middle of green and you→spot (`howFar()`: yards up to
     1500, miles beyond, so it always shows). × clears it; changing holes or
     ending the round clears it too. While a spot shows, `#pinHint` is hidden to
     keep the card short. All of this is in `drawLive()` (own `liveLayer`,
     redrawn on every GPS update).
   - **Each hole is turned tee-at-bottom, green-at-top** (`renderHole` →
     `setBearing(bearingUp(tee, green))`, then `flyToTurned()`, a rotation-aware
     flyToBounds that keeps the tee above the hole card and the green below the
     top bar / status message). Tee = first point of the hole line; with no
     line, your GPS position if within 1400 m of the green; else north-up.
     Overview is always north-up. Rotation comes from the **leaflet-rotate
     0.2.8** plugin (jsdelivr; map options `rotate:true`, rotate control and
     finger/shift-key turning off). Its bearing turns screen = world rotated by
     +bearing. Don't upgrade to 0.3+ without retesting (released Oct 2026).
   - The total yardage in the top bar and on each tee chip follows the chosen
     tee; when a tee has no total on file, its hole yardages are added up.
4. Status message ("9 of 18 holes mapped…", built by `refreshStatus()`; holes
   from your course map are counted first) shows at the start of each round,
   × hides it for that round only, returns next round. Errors always show.
5. **Map a course** (mode `'mapping'`, `mapper` state object, `renderMapper()`):
   one hole at a time, starting at the first hole not yet in your course map.
   Steps (bar on the card): **Tee → Front → Back → Hazards → Shapes**. The step
   bar is tappable (`goStep()`; a step opens once the marks before it exist,
   `stepOpen()`). **‹ Back / Next ›** always sit in the same place at the bottom
   of the card (`#mapNav`, same size on every step; Next becomes Save hole /
   Next hole / Play a round). No "Skip this hole": the ‹ › hole arrows do that.
   - Tee/front/back/hazards use a fixed **crosshair**, placed halfway between
     the top bar and the card (`placeCrosshair()`); `here()` reads the point
     under it and `flyUnder()` flies a point there (works on the turned map).
   - **Colored tees** (`TEES[]`: black championship, blue back, white middle,
     gold/yellow senior, red forward; `colorOf()` maps scorecard tee names via
     aliases). Tee step: **Tee color** dropdown (with that color's scorecard
     yards, ✓ when set), **Set/Move <color> tee**, chips of marked tees (× removes),
     "Next: green ›" once one is set. After Set, the dropdown moves on to the next
     common one (blue → white → gold → red, then black). Only mark the tees the
     hole has. `mapper.tees{color:pt}`; `mapper.tee` = back-most marked tee
     (`backTee()`), which the hole line/turning uses. Label above the crosshair:
     yards from the nearest other marked tee, then yards from tee / past the front.
     "I'm on the <color> tee (GPS)" appears when you're within 3 km.
   - Guide: OpenStreetMap's hole line + green (dashed) when it has one; the map
     starts on its tee and is turned tee-up. No guide → starts at the previous
     hole's green.
   - Hazards: crosshair + **+ Sand / + Water** (as many as you like) and a ↶
     undo-last button beside them.
   - Shapes (`predictShapes()`): green, a tee box per marked tee color, fairway, each hazard. An
     OpenStreetMap outline at that spot is reused (thinned to ~60 points); else
     green = ellipse from front/back, tee box = 16×10 m box, fairway = 35-yd strip
     from 30% of the hole to just short of the green (none under 230 yds), sand =
     8 m circle with 6 dots (OSM bunkers thinned to ≤8 points), water = 20 m circle. Chips pick the shape, or tap an outline on the map
     (`pickShape()`; invisible tappable polygons, small shapes on top; also on the
     review screen, which jumps to Shapes); the map zooms to it.
     `drawEditor()`: draggable white dots (Leaflet draggable markers; work on the
     turned map), faded midpoint dots add a point when dragged, tapping a dot
     removes it (min 3). **Reset shape** / **Remove shape** (fairway and hazards
     only) sit above Back / Save hole.
   - **Dogleg bend** (`fitBend()`): one point that makes tee → bend → green
     follow the fairway — every grid spot inside the fairway (~600) is tried and
     the one with the least squared distance to the fairway wins; none when
     straight fits about as well (<8 m off line or <20% better). Refit whenever
     the fairway changes (shown as a blue dot), saved as `bend`; holes saved
     without one get it computed on open. `holeLine(tee, h)` drops the bend when
     it's behind that tee. Used for the drawn line, round line and yardages.
   - Check line: each marked tee→middle of green (along the bent line) vs that color's scorecard yards
     (`scColorYards()`; green if within 12%).
   - In a round (`holeInfo()`), a mapped hole starts from the tee whose color
     matches the tee picked on the overview, else the nearest marked color,
     else the back tee; the hint says which ("From your course map (White tee)").
   - **Save hole** → `saveCourseMap()` → next unmapped hole; after the last one
     a "Course mapped!" screen with **Play a round**. Mapped holes open on a
     review screen (‹ Back = edit shapes, Start this hole over, Delete hole map).
   - Finish (top right) → course overview; ‹ → course list (asks first if the
     hole has unsaved marks).

## Hand-made course maps (`GolfCourseMaps/`)

- One JSON file per course, `id = slug(course name)`; `index.json` lists them
  (`{courses:[{id,name,center,holes,updated}]}`). Format is in
  `GolfCourseMaps/README.md`. Points are `[lat, lng]` rounded to 6 decimals.
- Saving: always to localStorage `caddie-voice-maps` ({id: map}); then a PUT to
  `GolfCourseMaps/<id>.json`, which only `tools/serve.py` accepts. On the live
  site / a phone the PUT fails → "saved on this device" and **Send map file**
  (share sheet or download) so the file can be added to the folder and pushed.
- Loading (`loadCourseMap()` in `openMap`): `index.json` → match by slug, or
  within 700 m, or within 2.5 km with a name match (`sameMap()`); the newer of
  the folder copy and the device copy wins.
- Using: `holeInfo()` returns your hole first (`oh.mapped`, exact front/middle/
  back, middle = halfway between your front and back marks). `drawOSM()` draws
  mapped holes over OpenStreetMap's (and works with no OSM data). In a round a
  mapped hole hides "Pin the green" (old green pins are ignored for it).
- sw.js serves `GolfCourseMaps/` network-first (saved copy offline).
- Sharing between players happens through this folder: maps committed here go
  out with the app. A live upload service (Netlify Blobs, review page) was
  discussed but is not built.

## Data sources (all free, no keys)

| Purpose | Source | Notes |
|---|---|---|
| Course search + scorecards | OpenGolfAPI `https://api.opengolfapi.org` | `GET /v1/courses/search?q=` → `courses[]` (id, course_name, city, state, latitude, longitude, par). `GET /api/v1/courses/{id}` → `tees[]` (tee_name, gender, par, yardage) and `holes_data[]` (number, par, handicap_index, yardages{red,blue,…}). Its per-hole coordinates are null for the courses checked, so layouts come from OSM. Works from the browser (CORS checked Oct 22 2026). Some tees have a total but no per-hole yardages (e.g. Bethpage Black "Regulation"). If it fails the app falls back to Nominatim and labels results "Map only". |
| Course search + scorecards (2nd source) | GolfCourseAPI via our `/api/gca` pass-through (`netlify/functions/gca.mjs`) | Key in Netlify env var `GOLFCOURSEAPI_KEY` (Bearer auth); never in index.html. Free plan = 35 requests/day, so the pass-through caches searches 3 days and courses 90 days (Blobs store `golfcourseapi`) and the app sends one search per query (plus one retry with the longest word if empty). `GET /v1/search?search_query=` → `courses[]` (id 8-char, club_name, course_name, location{address,city,state,latitude,longitude}); `GET /v1/courses/{id}` → `tees.male[]/female[]` (tee_name, course_rating, slope_rating, total_yards, par_total, holes[]{par,yardage,handicap}). No hole coordinates. Spec: https://api.golfcourseapi.com/docs/api/openapi.yml. `trimGca()` converts to the OpenGolfAPI scorecard shape (women's tees sharing a men's name become "Name (W)"). When both sources have a course (`sameCourse()`: all words match both ways, within 2 km) the GolfCourseAPI copy is shown. Without the key, `/api/gca` returns 503 and search silently uses OpenGolfAPI only. |
| Search fallback | Nominatim | `format=jsonv2`, prefers `type=golf_course` |
| Hole layouts | Overpass API (overpass-api.de, maps.mail.ru, overpass.kumi.systems — tried in order, 40 s each) | Two independent lookups (one failing keeps the other). On total failure the status says why (busy/timeout/offline) and retries once after 20 s. First query: features inside the `leisure=golf_course` area around the course center; if < 18 holes, retries with a 1500 m radius and keeps whichever has more holes. Tags used: `golf=hole` (ref, par, handicap, line tee→green), `green`, `tee`, `fairway`, `bunker`, `*water_hazard`, `natural=water`. |
| Satellite | Esri World Imagery | attribution shown on the map |
| Street map | OpenStreetMap standard tiles (tile.openstreetmap.org) | Map / Satellite button (`setBase()`), choice saved in `caddie-voice-layer`. Light personal use only under the OSM tile policy; switch to a commercial tile provider before wide release. |

Bunkers include plain `natural=sand`; water includes `natural=water` ways and
relations. Many courses have greens/fairways but no `golf=hole` lines: those
holes show every mapped feature in the round view so the map is never blank.

**Holes without route lines (`inferHoles()`, run in `applyOSM`):** (1) hole
numbers anywhere on the map (`holeNum()` reads `ref`, `golf:hole`, `hole`, or a
name like "Hole 5"/"#5") on greens, flagstick/green points (`golf=pin` nodes),
tee areas or points, or fairways make hole N (green from the number, tee = farthest
numbered tee, else previous green, else the green itself), marked `est:'label'`; (2) with scorecard yardages, a beam search
pairs tees and unused greens, cost = yardage fit (straight line vs scorecard,
doglegs allowed) + walk from previous green to tee (`/120 m, cap 3`), keeping
the 150 best routes; result marked `est:'guess'` and shown with a hint to pin the
green if wrong. On 40 generated 18-hole courses: labeled greens 100% right;
unlabeled 94% placed, 90% of those on the right green. Re-runs when a scorecard
arrives later (`enrich`). Raw Overpass data is kept in `rawOSM`.

Front/middle/back of green: green polygon nearest the end of the hole line;
middle = centroid; front/back = extremes projected along the last segment of
the hole line (`greenFor()`).

## Built-in course: Indian Island Golf Course (Riverhead, NY)

- In `KNOWN[]` with an embedded OSM export (`osm:` — holes 1–8 and 10 mapped;
  hole 9 and 11–18 are **not mapped in OSM**). Hole 8's tee/green exist but
  aren't tagged with ref 8; hole 10's green is missing.
- `ogaId: e8023353-a3f6-492b-a14b-ca4491b9aafa` — full scorecard (Blue 6,516,
  White 6,077, Gold 5,787, Red 5,545) is fetched from OpenGolfAPI on open.
- Hole 5 yardage disagrees between sources (188 vs county site's 167).

## Saved data (localStorage, per web address)

`caddie-voice-courses` recent courses · `caddie-voice-course-{id}` trimmed
OpenGolfAPI scorecard · `caddie-voice-osm2-{id}` Overpass result (30-day
cache) · `caddie-voice-geo` Nominatim lookups · `caddie-voice-greens` user
green pins `{courseId:{hole:[lat,lng]}}` · `caddie-voice-tee-{courseId}`
chosen tee · `caddie-voice-maps` your course maps (backup of / stand-in for
GolfCourseMaps files) · `caddie-voice-hidden` (legacy, mostly unused).

Wrap every localStorage access in try/catch (already the pattern).

## Design

Single committed deep-blue look (`color-scheme: dark`). Tokens in `:root`:
`--sky #0B2A4A`, `--deep #071C33`, `--panel #12385F`, `--ink #EAF3FF`,
`--mist #9FB8D6`, `--line #24507F`, `--play #4FB3FF`. Fonts: Barlow Condensed
(display, uppercase) + Public Sans (body). Big touch targets — it's used
outdoors, one-handed. Keep `[hidden]{display:none!important}`; several
elements set `display:flex` and would otherwise ignore `hidden` (this caused
a real bug once).

## Not built yet (roadmap, roughly in order)

1. **Spoken yardage** — the original point of the app. Live GPS distances are
   done (see App flow); still to do: speak them with the Web Speech API
   (`speechSynthesis`) on tap; optionally earbud/watch media button via the
   Media Session API. GPS needs HTTPS (fine on Netlify and localhost).
2. Shot tracking (mark shot → walk to ball → distance) and per-club averages.
3. Mapper extras: carry distances to hazards in a
   round, sharing maps between players without going through GitHub.
4. **Native apps** for background GPS and a tap-to-speak watch button:
   Swift/SwiftUI + watchOS, or Kotlin + Wear OS, depending on his phone.
   Reuse the course search and yardage logic.

## Working agreements

- **Netlify credits:** the free plan has 300 credits/month and every successful
  production deploy (= every push to `main` that builds) costs 15 → only ~20
  live updates a month. Running out pauses deploys and can pause the site.
  So: **do work on the `dev` branch** (branch deploys cost 0 credits, preview at
  `dev--<site>.netlify.app` once branch deploys are enabled), batch changes, and
  merge `dev` → `main` only when the owner says to make it live. Docs-only
  changes (`*.md`) are skipped by the `ignore` rule in netlify.toml.
- **GitHub `main` is the source of truth.** More than one place edits this repo
  (Claude Code, the Claude app, a friend). Always `git pull` before editing and
  edit `index.html` in the repo directly; never overwrite it with a copy made
  elsewhere.
- Test before pushing. A quick check that's worked well: serve locally and drive
  it with Playwright (pick Indian Island → Start round → next hole → End round),
  watching for page errors.
- Commit messages: short summary line, then bullets of what changed.
- After pushing, tell the owner what changed in plain words and how to see it
  (Netlify updates in ~1 minute; fully close and reopen the app on the phone).
