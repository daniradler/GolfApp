# GolfCourseMaps

Hand-made course maps from the app's **Map a course** mode. One file per course
(`indian-island-golf-course.json`), plus `index.json`, the list the app reads to
find the map for the course you open.

Every file in this folder is published with the app, so once a map is here
(and pushed to GitHub), everyone who plays that course gets its yardages.

**How maps get here**
- Mapping on this computer with `python3 tools/serve.py` running: pressing Save
  writes the file here and updates `index.json` automatically.
- Mapping on a phone: the map is saved on the phone. Use **Send map file** in the
  mapper and put the file in this folder (or hand it to Claude), then restart
  `tools/serve.py` or run it once so `index.json` is rebuilt.

**What's in a file** (all positions are `[latitude, longitude]`)

```
name, center, ids (database ids the course was found under), updated
holes: {
  "1": {
    tees: { blue: [..], white: [..], ... }   each tee color you marked (black, blue,
                                             white, gold, red; only the ones the hole has)
    tee                     the back-most marked tee (the hole line starts here)
    front, back             points you set with the crosshair
    teeboxes: { blue: [...], ... }   tee box outline per color
    green, fairway          outlines (lists of points); fairway is null on par 3s
    hazards: [ { type: "sand" | "water", shape: [...] } ]
  }
}
```

Older maps have a single `tee` + `teebox` and no `tees`; the app reads that
as a White tee.

A full 18-hole course is about 20–60 KB.
