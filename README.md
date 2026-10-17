# Caddie Voice

A phone-friendly golf web app. Search for a course, see the whole layout on a
satellite map, pick your tees, then play it one hole at a time with the green's
front, middle and back marked.

The whole app is a single file: `index.html`. There is no build step and nothing
to install to run it.

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
| Course search and scorecards | api.opengolfapi.org | Search results with par, yardage and tees |
| Course search fallback | nominatim.openstreetmap.org | "Map only" results if OpenGolfAPI is unavailable |
| Hole layouts | overpass-api.de, overpass.kumi.systems | Greens, fairways, bunkers and hole routes |
| Fonts | fonts.googleapis.com | Typefaces (falls back to system fonts) |

No API keys or accounts are needed.

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
