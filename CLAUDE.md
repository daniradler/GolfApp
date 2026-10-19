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
- **Deploy:** Netlify is linked to this repo. Every push to `main` goes live in
  about a minute. There is no staging site, so test locally before pushing.
- **Run locally:** `python3 -m http.server 8000` or `npm start`, then
  http://localhost:8000. See README.md.

## App flow (current)

1. **Select a course** (start screen): search box + saved courses. Typing 3+
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
   bunkers/water). Hole card at bottom: ‹ Hole N › , par · yards · handicap,
   **Pin the green**. **End round** (top right) returns to overview.
4. Status message ("9 of 18 holes mapped…") shows at the start of each round,
   × hides it for that round only, returns next round. Errors always show.

## Data sources (all free, no keys)

| Purpose | Source | Notes |
|---|---|---|
| Course search + scorecards | OpenGolfAPI `https://api.opengolfapi.org` | `GET /v1/courses/search?q=` → `courses[]` (id, course_name, city, state, latitude, longitude, par). `GET /api/v1/courses/{id}` → `tees[]` (tee_name, gender, par, yardage) and `holes_data[]` (number, par, handicap_index, yardages{red,blue,…}). Its per-hole coordinates are null for the courses checked, so layouts come from OSM. **CORS from the browser has not been verified yet**; if it fails the app falls back to Nominatim and labels results "Map only". |
| Search fallback | Nominatim | `format=jsonv2`, prefers `type=golf_course` |
| Hole layouts | Overpass API (overpass-api.de, then overpass.kumi.systems) | First query: features inside the `leisure=golf_course` area around the course center; if < 18 holes, retries with a 1500 m radius and keeps whichever has more holes. Tags used: `golf=hole` (ref, par, handicap, line tee→green), `green`, `tee`, `fairway`, `bunker`, `*water_hazard`, `natural=water`. |
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
chosen tee · `caddie-voice-hidden` (legacy, mostly unused).

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

1. **Live GPS + spoken yardage** — the original point of the app. Distance from
   the player's position to front/middle/back, spoken with the Web Speech API
   (`speechSynthesis`) on tap; optionally earbud/watch media button via the
   Media Session API. GPS needs HTTPS (fine on Netlify and localhost).
   An earlier prototype (not in this repo's history) did this; rebuild it on
   top of the current hole data.
2. Rotate each hole so the tee is at the bottom and the green at the top.
3. Shot tracking (mark shot → walk to ball → distance) and per-club averages.
4. Map-a-hole mode for unmapped holes (tap tee, green front/middle/back, hazards).
5. **Native apps** for background GPS and a tap-to-speak watch button:
   Swift/SwiftUI + watchOS, or Kotlin + Wear OS, depending on his phone.
   Reuse the course search and yardage logic.

## Working agreements

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
