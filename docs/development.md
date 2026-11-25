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

The GitHub API allows 60 requests per hour without login (one check needs 3). If that is not enough,
set a token first: `$env:GITHUB_TOKEN = '...'` (no permissions needed).

## Publish on GitHub Pages

1. Push the repository to GitHub.
2. *Settings → Pages → Build and deployment*: choose **GitHub Actions**.
3. On every push to `main`, `.github/workflows/pages.yml` downloads the emulators from their
   official releases and publishes `site/`.

No third-party binaries are stored in the repository; they are downloaded when the site is built.

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
  js/zip.js            reads and writes ZIP files (no dependencies)
  boxedwine/, jsdos/, emulatorjs/, v86/, demos/   created by the fetch script (not in git)
demos/demos.json       list of demos
demos/local/           demo files stored in the repository
docs/                  documentation
scripts/
  fetch-runtimes.mjs   downloads emulators, licences and source code
  update-runtimes.mjs  checks Boxedwine, js-dos and v86 for new versions
  update.ps1           the same for PowerShell
  serve.mjs            local test server with COOP/COEP headers
```
