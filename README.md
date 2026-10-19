# Caddie Voice

A phone-friendly golf web app. Search for a course, see the whole layout on a
satellite map, pick your tees, then play it one hole at a time with the green's
front, middle and back marked.

The app itself is a single file: `index.html`. Alongside it: `manifest.webmanifest`
(app name/icon), `sw.js` (offline support), `icons/`, and `netlify.toml`. There is
no build step and nothing to install to run it.

## Install it on a phone

It's an installable web app: open the site, then
- **iPhone (Safari):** Share button → **Add to Home Screen**
- **Android (Chrome):** ⋮ menu → **Install app** / **Add to Home screen**

It then opens full screen from its own icon, and opens even with weak or no
signal (courses and maps you've already viewed are saved on the phone).

## Run it on your computer

You need a small local web server (opening the file by double-clicking mostly
works, but some browsers block the course search from `file://` pages).
Pick whichever you already have:

**Python 3** (built into macOS and most Linux; on Windows install from python.org)

```sh
git clone https://github.com/daniradler/GolfApp.git
cd GolfApp
python3 -m http.server 8000
```

On Windows, use `py -m http.server 8000` if `python3` isn't found.

**Node.js**

```sh
git clone https://github.com/daniradler/GolfApp.git
cd GolfApp
npm start
```

Then open **http://localhost:8000** in a browser.

Stop the server with `Ctrl+C`.

## Open it on a phone on the same Wi-Fi

1. Start the server so other devices can reach it:
   - Python: `python3 -m http.server 8000 --bind 0.0.0.0`
   - Node: `npm run start:lan`
2. Find your computer's local IP address (macOS: System Settings → Wi-Fi →
   Details; Windows: `ipconfig`, look for IPv4 Address). It looks like
   `192.168.1.23`.
3. On the phone, open `http://192.168.1.23:8000` (use your own address).

If it doesn't load, allow incoming connections for Python or Node in your
computer's firewall.

Note: phones only allow GPS location on `https://` sites or on `localhost`.
The current version doesn't use GPS yet, but when it does, test GPS on the
hosted Netlify site (or through an HTTPS tunnel), not over a plain local IP.

## What needs internet

The app runs entirely in the browser, but it loads these public services:

| What | From | Needed for |
|---|---|---|
| Map library (Leaflet 1.9.4) | cdnjs.cloudflare.com | The map. Without it the screens work but no map shows |
| Satellite photos | server.arcgisonline.com (Esri) | Satellite background |
| Street map | tile.openstreetmap.org | The Map view (Map / Satellite button) |
| Course search and scorecards | api.opengolfapi.org | Search results with par, yardage and tees |
| Course search fallback | nominatim.openstreetmap.org | "Map only" results if OpenGolfAPI is unavailable |
| Hole layouts | the site's own `/api/course` service (Netlify), which fetches from OpenStreetMap's Overpass servers and saves each course | Greens, fairways, bunkers and hole routes |
| Fonts | fonts.googleapis.com | Typefaces (falls back to system fonts) |

No API keys or accounts are needed.

## Course-data service

`netlify/functions/course.mjs` runs on Netlify at `/api/course`. It fetches a
course's map data from OpenStreetMap once, saves it (Netlify Blobs) for 30 days
and serves that copy to every phone. When running locally there is no service;
the app goes straight to OpenStreetMap instead, so everything still works.

## Saved data

Saved courses, chosen tees, green pins and downloaded course maps are stored in
the browser (`localStorage`). They are separate for each address, so data saved
on `localhost:8000` won't appear on the Netlify site, and vice versa.

## Credits

- Course layouts © OpenStreetMap contributors (ODbL), via the Overpass API.
- Scorecards via OpenGolfAPI (ODbL).
- Satellite imagery © Esri, Maxar.
- Indian Island Golf Course layout (holes 1–8 and 10) is built into the app from
  an OpenStreetMap export, so it shows even offline.

## Deploying

The `main` branch is deployed by Netlify; every push goes live automatically.

---

Hi from Spencer! 👋 Checked out the app and got it running on my server.
