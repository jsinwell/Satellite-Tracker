# Satellite Tracker

A live 3D view of every active satellite and the major debris fields in Earth orbit —
about 19,500 objects — propagated in real time in the browser.

**Live at [jsinwell-satellite-tracker.pages.dev](https://jsinwell-satellite-tracker.pages.dev/)**

![The ISS selected over the Southern Ocean, with its orbit drawn](docs/screenshot.png)

- **Live positions** from current orbital elements, with the real day/night line and Earth rotation.
- **Search** by name, NORAD ID or international designator; **click** any satellite to inspect it.
- **Time control**: pause, or run at up to 1000× and watch orbits unfold.
- **Filter** by object type and orbit regime.
- **Shareable links**: `?sat=25544` opens on a satellite; `?t=2026-11-16T06:30:00Z` opens at an instant.

## Quick start

Requires Node 22.18 or newer.

```sh
npm install
npm run data    # download the satellite catalog (once)
npm run dev
```

| Command          | What it does                                                    |
| ---------------- | --------------------------------------------------------------- |
| `npm run dev`    | Start the dev server                                            |
| `npm run data`   | Download the catalog to `public/data/catalog.json`              |
| `npm run check`  | Type-check, lint and unit-test: run this before pushing         |
| `npm run e2e`    | Build, then run the browser tests against the production bundle |
| `npm run bench`  | Benchmark SGP4 over the full catalog                            |
| `npm run format` | Apply formatting and safe lint fixes                            |
| `npm run build`  | Type-check and build to `dist/`                                 |

`npm run e2e` needs a browser: either `npx playwright install chromium`, or set
`PW_CHANNEL=chrome` to use an installed Chrome.

`npm run data` copies the catalog the live site is already serving; it does not contact
CelesTrak unless you pass `-- --fresh`. Use that sparingly: CelesTrak is a free service that
blocks an address for hours if it downloads data more often than the data changes.

## How it works

```
 CelesTrak ──► scripts/fetch-catalog.ts ──► catalog.json   (production build, every 6 h)
                                                │
                                         fetched once at startup
                                                │
              ┌─────────────────────────────────┴───────────────────┐
              ▼                                                     ▼
        sim worker                                             main thread
   SGP4 for every satellite   ── state buffer (transfer) ──►  GPU vertex buffer
   on request, ~8 ms a pass                                   extrapolated per frame
                                                              in the vertex shader
```

**Data.** The production build fetches orbital elements (as OMM JSON) from CelesTrak,
validates them, joins on descriptive fields from the satellite catalog, and ships the result
inside the site. A scheduled job triggers that build every six hours. Nothing is committed,
and visitors' browsers never contact CelesTrak. Neither do other builds: see
[Staying within CelesTrak's limits](#staying-within-celestraks-limits).

**Simulation.** A Web Worker initialises SGP4 once per satellite, then propagates all of them
to whatever instant the main thread asks for, writing position and velocity into a
`Float32Array` that is passed back and forth by transfer. There is no precomputed timeline:
any instant, at any time rate, costs the same.

**Rendering.** That array is uploaded as-is as an interleaved vertex buffer, and all satellites
are drawn in one call. The worker is only asked for a new state every couple of seconds of
simulated time; in between, the vertex shader advances each satellite itself (below).

**UI.** React draws the panels. It never renders at frame rate: anything that changes every
frame is read imperatively in the render loop, and panels that display it poll a few times a
second.

### Project layout

```
src/
  core/    Pure domain logic — orbits, propagation, frames, picking, search. No DOM,
           no Three.js, no React. Where nearly all the unit tests are.
  sim/     The worker, its message protocol, and the main-thread Simulation handle.
  scene/   The 3D view (react-three-fiber): Earth, satellites, orbit path, camera, picking.
  ui/      The HUD: search, info panel, time bar, filters.
  app/     Wiring: startup, the Zustand store, the catalog-derived World.
scripts/   The catalog build.
e2e/       Playwright tests and their fixture catalog.
```

Dependencies point one way: `core` knows nothing of the rest; `sim` builds on `core`;
`scene` and `ui` build on `app`, `sim` and `core`.

## Design notes

**Propagate live; don't precompute.** SGP4 over the whole catalog takes about 8 ms in plain
JavaScript (`npm run bench`; one-off initialisation is about 75 ms), so there is nothing to
gain from caching trajectories and a great deal to lose: memory, load time, and a fixed time
window. The whole simulation state is 470 kB.

**Extrapolate on the GPU.** Between worker updates each satellite is advanced with a
second-order step under point-mass gravity, `p + v·dt + ½·a·dt²` with `a = −μ·p/|p|³`.
The error grows with `dt³`: a few metres after ten seconds in low orbit, against ~15 km for
straight-line motion after a minute. Requests are also aimed at the _middle_ of the interval a
state will be displayed for, which halves the worst-case `dt`. The tolerances are pinned by
tests in `core/kinematics.test.ts`, and the same step is implemented on the CPU for picking so
that what you click is what is drawn.

**Work in the inertial frame.** SGP4 outputs positions in an Earth-centred inertial frame
(TEME). The scene keeps them there and rotates the _Earth_ by sidereal time instead. Orbits
are then closed ellipses, the stars stay put, and no per-satellite frame conversion is needed.

**The clock is a pure function.** Simulated time is `anchor + (now − anchorWall) × rate`.
Nothing ticks or accumulates, so it cannot drift, and pausing, warping and jumping are just
new anchors.

**Search is a linear scan.** Scanning 20,000 pre-lowered names takes about a millisecond; an
index would be complexity without benefit. The real cost of search is the DOM — one letter
matches thousands of satellites — so results are ranked and capped before rendering.

**Satellites are identified by NORAD ID.** Names are not unique (hundreds of debris fragments
share one). The pipeline reads OMM rather than classic TLEs because a TLE has only a
five-character field for that ID, which the catalog has outgrown.

**No WebAssembly, no SharedArrayBuffer.** satellite.js ships a WASM build, but at real-time
speed the JavaScript path is one 8 ms pass every two seconds: well under 1% of one core. At
higher time rates it runs more often, but never more than one request at a time.
SharedArrayBuffer would save one 470 kB copy per update: too little to justify the
cross-origin isolation headers it requires, which restrict everything else the page loads.

## Accuracy

Positions are as good as SGP4 and the age of the elements allow: typically within a few
kilometres for elements less than a few days old, degrading by a kilometre or more per day
after that. The info panel shows the age of each satellite's elements and flags stale ones.
"Sunlit / in eclipse" uses a geometric Earth-shadow test. The star field is decorative.

## Deployment

The site is hosted on Cloudflare Pages, connected to this repository: every push to `main`
deploys to production, and every other branch gets a preview URL.

| Cloudflare Pages setting | Value                           |
| ------------------------ | ------------------------------- |
| Build command            | `npm run data && npm run build` |
| Build output directory   | `dist`                          |
| Node version             | read from `.nvmrc`              |

Cloudflare only builds on a push, so `.github/workflows/refresh-data.yml` calls a Cloudflare
[deploy hook](https://developers.cloudflare.com/pages/configuration/deploy-hooks/) every six
hours to rebuild with fresh elements. It needs the hook's URL in a repository secret named
`CLOUDFLARE_DEPLOY_HOOK`.

GitHub pauses scheduled workflows in repositories with no activity for 60 days; if the data
stops refreshing, re-enable the workflow from the Actions tab.

### Staying within CelesTrak's limits

CelesTrak blocks an address for hours if it downloads data more often than the data changes:
elements change about every two hours, the satellite catalog two or three times a day. A
site that fetched both on every build would lock itself out with two pushes in a row, so
`scripts/catalog-builder.ts` follows these rules (each covered by a unit test):

- Only the production build contacts CelesTrak. Branch previews and local development reuse
  the catalog the live site is serving.
- The production build skips CelesTrak if the published elements are under two hours old.
- Satellite-catalog fields (object type, owner, launch date) are carried forward and
  re-downloaded at most once a day. If that download fails, the build carries on and
  classifies any new objects from their names.
- If the elements cannot be fetched, the build reuses the published catalog, so a CelesTrak
  outage delays the data but never blocks a code deploy. A catalog more than three days old
  is not reused; the build fails instead, and the previous deployment stays live.

### Hosting elsewhere

Run `npm run data -- --fresh && npm run build` on a schedule and serve `dist/`. Set
`PUBLISHED_CATALOG_URL` to where your site serves `data/catalog.json` so that the rules above
have a catalog to reuse, and `BASE_PATH` if the site is not served from the domain root.

## Possible next steps

- **Passes over your location**: rise/set times and look angles for an observer
  (satellite.js already provides the look-angle maths).
- **Ground tracks** and sensor footprints for the selected satellite.
- **Follow mode**: keep the camera locked to a satellite, or switch it to an Earth-fixed frame.
- **More of the catalog**: spent rocket bodies and the rest of the tracked debris, which would
  need a further source such as Space-Track (account required).

## Credits

Orbital data from [CelesTrak](https://celestrak.org). Propagation by
[satellite.js](https://github.com/shashwatak/satellite-js). Earth textures from the
[three.js](https://github.com/mrdoob/three.js) examples.
