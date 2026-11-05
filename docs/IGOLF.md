# iGolf integration

Status: **ready except for iGolf's partner documentation and keys.**
Everything in the app is built and tested against a stand-in; two small,
marked spots in `netlify/functions/igolf.mjs` need iGolf's private docs.

## How it fits

```
phone (index.html)
  │  /api/igolf?action=search | near | course      (never sees the keys)
  ▼
Netlify function  netlify/functions/igolf.mjs
  • adds the keys and signs each request         ← ① needs iGolf's signing code
  • saves answers (search 7 days, course 30 days, IGOLF_CACHE_DAYS)
  • counts every billed request per month        → /api/igolf?action=status
  • converts iGolf's answers                      ← ② needs iGolf's field names
      → scorecard   (same shape as OpenGolfAPI / GolfCourseAPI)
      → course map  (same format as GolfCourseMaps/*.json)
  ▼
iGolf Connect (REST, JSON)
```

In the app, an iGolf course plays exactly like a hand-made course map:
colored tee boxes, exact front / center / back of every green, hazards,
outlines, live GPS yardage, holes turned tee-at-bottom. Order of preference
per hole: **your own map → iGolf → OpenStreetMap**. iGolf holes are kept apart
from your own maps (`providerMap`), so they are never written into
`GolfCourseMaps/` or the "Send map file" export.

- Search shows iGolf results first ("GPS course map"), ahead of GolfCourseAPI
  and OpenGolfAPI copies of the same course.
- Any course opened from another source asks iGolf once (`action=near`) whether
  it has that course nearby; if so its GPS map and scorecard are used.
- Map credit "Course data © iGolf" is shown while an iGolf course is open.
- Until the connection is finished the service answers 501/503 and the app
  silently stops asking for the rest of the session. Nothing else changes.

## To finish after the partnership is signed

1. **Netlify settings** (Site configuration → Environment variables, each marked
   *Contains secret values*): `IGOLF_API_KEY`, `IGOLF_SECRET_KEY`,
   `IGOLF_BASE_URL`, optionally `IGOLF_CACHE_DAYS`.
2. **① `igolf.send()`**: paste in iGolf's request-signing sample code (build
   URL → signature from the secret key + timestamp → POST params as JSON).
3. **Request names** in `igolf.requests`: confirm against their docs
   (currently `CourseList`, `CourseDetails`, `CourseTeeDetails`,
   `CourseScorecardDetails`, `CourseGPSDetails`, `CourseGPSVectorDetails`).
4. **② `igolf.toCourses()` / `igolf.toNeutral()`**: map their JSON fields to
   the neutral shape documented in the file. Everything after that is done.
5. Check: `/api/igolf?action=status` should say `"connected": true`; search a
   course in the app; its card should say "GPS course map".

Testing without iGolf: give `createHandler()` a stand-in adapter
(see the comment block in the file). The converters `toScorecard()` and
`toCourseMap()` are exported for unit tests.

## What to ask iGolf for in the meeting

**Access**
- Trial keys (their site mentions a 30-day trial with full database access).
- The API documentation, request-signing sample code, and an example response
  for each request we use (course list, scorecard, GPS, vector/outlines).
- Which requests our plan includes ("invalid permission" means a request is
  not switched on for the application).

**Data we need per hole** (our neutral shape):
- Tee box position for each tee (name/color), ideally its outline.
- Green **front, center, back** points; green outline if available.
- Hazards (bunkers, water) with type and position or outline; fairway outline.
- Dogleg / layup points if they have them.
- Scorecard: every tee set with par, yardage per hole, handicap, rating, slope.

**Commercial / license**
- Price per transaction and the plan tiers; what counts as one transaction
  (we make ~5 requests the first time a course is opened, then 0 for 30 days).
- **Caching**: how long we may store a course on our server and on the phone
  (offline play on the course needs it on the phone).
- **Attribution** wording and placement.
- Use from a **web app / installable PWA** (not only native iOS/Android).
- **Apple Watch**: their viewer libraries are iOS/Android only; can we use
  the raw GPS data for our own watch app?
- Whether we may combine iGolf holes with community data (OpenStreetMap) and
  players' own hand-made maps in the same course view.

**Our expected usage** (for pricing): personal use plus a few friends at first;
with saved copies, each new course costs one set of requests per 30 days no
matter how many rounds are played on it.
