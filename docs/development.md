# Development

[← Back to the README](../README.md)

## Run it locally

You need [Node.js](https://nodejs.org) 22 or newer. Nothing else.

```sh
npm run fetch   # downloads the emulators into site/ (once, ~500 MB, takes ~10 minutes)
npm run serve   # http://localhost:8080
```

| Command | What it does |
|---|---|
| `npm start` | `fetch` and `serve` in one go |
| `npm run fetch:force` | downloads everything again, also what is already there |
| `npm run serve:no-coi` | server without the COOP/COEP headers, like GitHub Pages |

## Update the emulators

- **EmulatorJS** always comes in its newest stable version, nothing to do.
- **Boxedwine, js-dos and v86** are fixed to one version (constants at the top of
  `scripts/fetch-runtimes.mjs`), because a new version can break demos.

Check for new versions in PowerShell:

```powershell
.\scripts\update.ps1          # only shows what is new
.\scripts\update.ps1 -Apply   # writes the new versions and downloads everything again
```

Or on any system: `npm run update` / `npm run update:apply`.

| Emulator | Where the newest version comes from | Also updated |
|---|---|---|
| Boxedwine | newest GitHub release of danoon2/Boxedwine with a web build (`…Web.zip`) | release file name, download link of the SkiFree demo |
| js-dos | npm package `js-dos` (`latest`) | the `emulators` version it was built with, and its DOSBox commit (for the source download) |
| v86 | npm package `v86` (`latest`) | git commit of the package (for BIOS and source) and its SeaBIOS version |

After an update:

1. `npm run serve` and start the demos of every updated emulator.
2. Commit only if they still work. `git diff` shows the new versions and lets you undo them.
3. If the download fails, the new version is built differently (e.g. other file names) and
   `scripts/fetch-runtimes.mjs` has to be adapted.
4. Boxedwine's `boxedwine.js` is patched (`BOXEDWINE_PATCHES`): `emscripten_get_screen_size` reports
   at least 4096 x 4096, otherwise SDL switches to fullscreen on phones (Windows screen larger than the
   device screen) and the picture turns black when the browser refuses; and two hooks let netplay put
   the sockets on a virtual LAN (`js/wine-net.js`). The build stops if a patched line is not found in
   a new version. The changed files carry a notice (GPL 2.0) and the changes are described at the end
   of `site/boxedwine/README-boxedwine.txt`.
5. Boxedwine's emulator files (`st/`, `mt/`) come from an own build with fixes in the C++ code (see
   below). After a Boxedwine update: set `BOXEDWINE_TAG` in `scripts/build-boxedwine.mjs` too, raise
   `BUILD_NUMBER`, check that the patches still apply and run the workflow *Build Boxedwine*.

### Own Boxedwine build

Netplay needs fixes in Boxedwine's C++ code (an accepted socket is not marked as connected, the
browser has no network interfaces; details in `concepts/boxedwine-upstream-issue.md`, which is
also the text for reporting them upstream). `scripts/build-boxedwine.mjs` builds Boxedwine
from its unchanged source archive with these changes (`PATCHES`) and the settings of Boxedwine's
own makefile:

```sh
emsdk install 4.0.10 && emsdk activate 4.0.10   # EMSCRIPTEN_VERSION in the script
source emsdk/emsdk_env.sh      # Windows: emsdk_env.bat
node scripts/build-boxedwine.mjs
```

The result is `vendor/boxedwine-build/boxedwine-<tag>-runthemall.<n>-web.zip`. The workflow
*Build Boxedwine* (`.github/workflows/boxedwine.yml`, started by hand) builds the same and
publishes it as release `boxedwine-<tag>-runthemall.<n>` of this repository.
`scripts/fetch-runtimes.mjs` takes the emulator files from the local build or that release; if
neither exists it warns and uses the unchanged Boxedwine release (then Windows netplay servers
cannot answer). Once Boxedwine releases the fixes, the own build can be dropped.

The GitHub API allows 60 requests per hour without login (one check needs 3). If that is not enough,
set a token first: `$env:GITHUB_TOKEN = '...'` (no permissions needed).

## Publish on GitHub Pages

1. Push the repository to GitHub.
2. *Settings → Pages → Build and deployment*: choose **GitHub Actions**.
3. On every push to `main`, `.github/workflows/pages.yml` downloads the emulators from their
   official releases and publishes `site/`.

No third-party binaries are stored in the repository; they are downloaded when the site is built.

The workflow has two jobs: `build` downloads the emulators and uploads the site, `deploy` publishes it.
GitHub Pages sometimes fails with a short server error (500); `deploy` then waits a minute and tries
once more. If that fails too, *Actions → the run → Re-run failed jobs* repeats only the publishing.

### Why a service worker?

- The fast multithreaded Windows emulator needs `SharedArrayBuffer`.
- Browsers only allow that with the headers `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp`.
- GitHub Pages cannot set headers, so [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker)
  adds them in the browser.
- Without the service worker (e.g. Firefox private mode) the single-threaded version is used automatically.

## Add a demo

Demos are listed in `demos/demos.json`. The fields are explained in [demos/README.md](../demos/README.md#format-of-demosjson).
Run `npm run fetch` afterwards; the order of the tiles follows the order in the file.

## Project structure

```
site/                  the website (this is what gets published)
  index.html, style.css
  img/                 logo and platform logos
  js/app.js            user interface, demo carousel
  js/workspace.js      reads files, ZIPs and folders, finds programs
  js/exe.js            tells DOS and Windows programs apart
  js/systems.js        consoles and home computers: systems, cores, BIOS, detection
  js/runner.js         shared logic: save and write back changed files
  js/emulator.js       Windows programs with Boxedwine
  js/dos.js            DOS programs with js-dos, 8.3 short names
  js/ejs.js            games with EmulatorJS
  js/v86.js            complete PCs with v86
  js/fit.js            scales the picture to the screen area (keeps the aspect ratio)
  js/platforms.js      logos and colours of the demo platforms
  js/audio.js          unlocks sound the browser holds back
  js/report.js         recognises crashes, builds the prefilled GitHub issue
  js/restart.js        keeps the files for one reload when restarting with other options
  js/keys.js           virtual keyboard: key table and sending keys into the emulators
  js/gamepad.js        touch gamepad over the picture (DOS) and its key mapping per program
  js/netplay.js        netplay client for the relay and the network of js-dos (sharedNet)
  js/lobby.js          netplay lobby: create/join a room, share the link
  js/ejs-netplay.js    netplay for console games: shared inputs in lockstep (EmulatorJS)
  js/wine-net.js       netplay for Windows programs: virtual LAN for Boxedwine's sockets
  js/zip.js            reads and writes ZIP files (no dependencies)
  boxedwine/, jsdos/, emulatorjs/, v86/, demos/   created by the fetch script (not in git)
demos/demos.json       list of demos
demos/local/           demo files stored in the repository
docs/                  documentation, docs/images/ has the README screenshots
scripts/
  fetch-runtimes.mjs   downloads emulators, licences and source code
  build-boxedwine.mjs  builds Boxedwine with RunThemAll's fixes (Emscripten)
  update-runtimes.mjs  checks Boxedwine, js-dos and v86 for new versions
  update.ps1           the same for PowerShell
  serve.mjs            local test server with COOP/COEP headers
```

## Netplay relay

`netplay/` is a separate Go program (the relay server for playing together over the network);
see `netplay/README.md` for running, options and the protocol, and
`concepts/netplay-recherche.md` for the research behind it. It is not part of the static site
and not deployed by the Pages workflow.

```sh
cd netplay && go test ./... && go run .   # relay on ws://localhost:8090
```

The page uses `ws://localhost:8090` as relay by default when it runs on localhost.
