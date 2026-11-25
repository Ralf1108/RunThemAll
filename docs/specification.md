# Specification

[← Back to the README](../README.md)

How RunThemAll works inside. As of November 2026.

## 1. Goal

- A static website that starts old software and games right in the browser.
- The user does as little as possible: no installation, no settings, no account.
- RunThemAll is an **aggregator**. All emulation comes from other open source projects, included
  unchanged. RunThemAll only adds:
  - one interface to open, pick and start,
  - automatic detection of the right emulator,
  - the glue to the emulators (files in, changed files out),
  - a build script that downloads the emulators from their official releases.

## 2. Principles

| Principle | How |
|---|---|
| Everything runs locally | User files are never uploaded. They are read in the browser and copied into the emulator's memory. |
| No backend | Plain static site, runs on GitHub Pages. |
| No third-party binaries in the repository | Emulators are downloaded at build time (`scripts/fetch-runtimes.mjs`). |
| Upstream unchanged | Emulator files are not modified, only missing parts are added (e.g. the Wine 16-bit overlay). |
| Respect licences | For every component, its licence text and the source code (or a link to it) of the used version are published too. |
| No data to third parties | Emulators load their files from this site and send no user data anywhere. The only outside requests: an anonymous page-view count (GoatCounter, no cookies) and the EmulatorJS version check (5.3). |
| No copyrighted BIOS files | Free replacement BIOS files are used where they exist. |
| No dependencies | No framework, no build step for the site. Node.js is only needed for the scripts. |

## 3. User flow

The start page has three columns: *Open a program* and the demo carousel (3.2) on the left, then side by
side the supported platforms and the emulators (3.3). The interface is in English.

1. **Open**: file picker (any file or ZIP), folder picker or drag & drop.
   - A single ZIP is unpacked in the browser.
   - A common root folder is removed (`Game/GAME.EXE` → `GAME.EXE`).
   - Chrome/Edge open folders with write access (File System Access API), other browsers read only.
2. **Pick**: list of all startable files with their type. The most likely one is on top
   (short paths first, `.exe`/games before `.com` before `.bat`, setup and uninstall programs last).
   For games a panel shows the system (changeable) and the BIOS status; a BIOS file can be added there.
3. **Options** (saved in `localStorage`):
   - Windows: Wine version, single/multithreaded, resolution, colour depth, keep the virtual environment
   - DOS: CPU speed (cycles)
   - Complete PC: RAM
   - All: sound
4. **Start**: the right emulator is loaded. Then:
   - *Save*: a dialog *Save – changed files* first lists the new and changed files, then *Download as ZIP* or, for folders with
     write access, *Apply to folder* (writes them back; nothing is ever deleted).
   - *Sound on/off*: mutes every emulator the same way: `js/audio.js` routes everything sent to the
     speakers through one master gain per audio context. The emulators always start with sound;
     the option "Sound" only decides whether the button starts as on or off.
   - *Play/Pause*: EmulatorJS `pause()`/`play()`, js-dos `ci.pause()`/`ci.resume()`, v86 `stop()`/`run()`,
     Boxedwine `Module.pauseMainLoop()`/`resumeMainLoop()` (checked: the program does not run on while paused).
   - All toolbar buttons have an icon. *Sound* and *Play/Pause* show the current state: green with
     *Sound on* / *Play* while it is on or running, red with *Sound off* / *Pause* after a click.
   - *Fullscreen*: the emulator area goes fullscreen.
   - Toolbar order: *Save*, *Fullscreen*, *Sound*, *Play/Pause*, *Options*, *Keys*, *Console*, *Report*, *Quit* (red).
   - *Keys*: a virtual keyboard row (Esc, Tab, Enter, Backspace, Space, F1–F12, Ins/Del/Home/End/PgUp/PgDn,
     arrows, sticky Ctrl/Alt/Shift, Ctrl+Alt+Del) for keys the browser keeps (Esc releases the mouse and
     cannot be changed by a page) – also the way to send Esc in Firefox. `js/keys.js` holds the key table;
     js-dos gets `ci.sendKeyEvent` (GLFW codes), v86 scancodes, Boxedwine and EmulatorJS a keyboard event
     on the picture with `keyCode` set. Tested with all four (DOS prompt F3, KolibriOS Ctrl+Alt+Del,
     SkiFree arrows, EmulatorJS Start/arrow input).
   - *Fullscreen* in Chrome/Edge also locks the Esc key (Keyboard Lock API): Esc goes to the program,
     holding Esc leaves fullscreen.
   - *Console*: shows the messages of the emulator below the picture; it turns red when a crash was recognised.
   - *Options*: the settings of the running emulator (Wine version, threads, resolution, colour depth,
     virtual environment / CPU speed, start parameters / memory; EmulatorJS has none) and *Restart*.
     The emulators cannot be stopped and started again cleanly in one page, so the page reloads:
     a demo is started again with the new settings (saved as its demo options); for own files
     `js/restart.js` keeps the files, start options, BIOS files and the folder handle in IndexedDB for
     this one reload. They are deleted as soon as the program runs again. They are not deleted earlier
     because coi-serviceworker may reload the page once more by itself (page not cross-origin isolated,
     or a new service worker after an update). A restart older than 10 minutes or tried on 3 page loads
     is deleted unused. A folder is used directly again if the browser still
     allows writing to it, otherwise the kept copy is used (then without writing back).
   - *Report*: prepares a GitHub issue (form `bug_report.yml`, fields filled through the address) with the
     program, platform, emulator and version, start options, SHA-256 of the started file and the last console
     lines (as many as fit into the address). The dialog shows all fields of the form editable (title, what,
     platform, what happened, steps, browser); GitHub then opens in a new tab where the user sends it.
     A screenshot of the emulator (taken at the crash, otherwise when *Report* is clicked) is shown and can be
     downloaded as PNG; for own files the program can also be downloaded as a compressed ZIP
     (CompressionStream). Both are attached by dragging them into the issue (GitHub allows 25 MB).
     Nothing is sent by the page itself.
   - Screenshots: js-dos `ci.screenshot()`, v86 `screen_make_screenshot()`, EmulatorJS its own canvas screenshot,
     Boxedwine the canvas. EmulatorJS's WebGL contexts are created with `preserveDrawingBuffer` (otherwise the
     canvas reads back black).
   - Crash detection (`js/report.js`): console lines with clear signs (Wine "Unhandled page fault/exception",
     Emscripten "Aborted(", WebAssembly RuntimeError, DOSBox "E_Exit", "Kernel panic" …), uncaught
     WebAssembly errors and a failed start open the console and turn *Console* and *Report* red (*Report crash*).
     DOM exceptions of the browser (e.g. pointer lock refused) do not count.
   - There is no status line: while loading, the loading screen shows the steps and progress; afterwards
     the *Play/Pause* button shows the state. Hints (no sound yet, mouse in v86, crash) appear below the picture.
   - Keys that games use (arrows, space, page up/down, home/end) do not scroll the page while a program runs.
   - *Quit*: reloads the page.
   - A badge shows which emulator runs (e.g. "Boxedwine 26R1.0 · Wine 6 · Multithreaded").
   - A message box tells what was saved, or that nothing changed.
   - EmulatorJS and v86 have no save/write back; EmulatorJS handles saves in its own menu.

### 3.1 Loading the emulators

- The page only loads the interface. An emulator is downloaded when it is started, and only that one.
- A loading screen shows the steps and a progress bar in megabytes. `prefetch()` (in `runner.js`)
  downloads the files first; the emulator then gets them from the HTTP cache (tested: ~300 bytes on the
  second request).
- The loading screen disappears when the emulator reports that it runs
  (Boxedwine `Running...`, js-dos `ci-ready`, EmulatorJS `EJS_onGameStart`, v86 `emulator-started`).

### 3.2 Demos

- `demos/demos.json` lists free programs (source, author, licence, start file, system, options).
- The build script downloads them into `site/demos/`.
- The start page shows them in a carousel: one tile per platform with logo, name and number of demos.
  Clicking a tile opens the list of its demos below the carousel; clicking it again (or `Esc`) closes it.
  It scrolls with the arrow buttons, an always visible scroll bar, by dragging with the mouse,
  or natively with touch and trackpad; it snaps to whole tiles.
  Clicking a demo shows its info with *Start* and *Options* (per-demo options, saved in `localStorage`)
  and scrolls the page so that the whole info with the Start button is visible.
- *Start* opens the file like a user file, preselects program and system and starts at once.
- Sources and licences: [demos/README.md](../demos/README.md).

### 3.3 Supported platforms and emulators

- A sidebar right of the main column lists every supported platform, grouped
  (PC, home computers, consoles, handhelds, arcade), with logo or icon.
- It is built from `SUPPORTED_GROUPS` in `js/platforms.js` and the system table in `js/systems.js`,
  so it matches what the detection supports. Systems that need an original BIOS are marked "BIOS".
- Hovering a platform shows a tooltip with its emulator (e.g. "Runs with EmulatorJS (core snes9x)") and
  highlights that emulator in the sidebar next to it.
- The sidebar on the far right (*Powered by*) lists the emulators (Boxedwine, js-dos, EmulatorJS, v86) with version (from the
  `version.json` files), what they run, licence and link.
- Below 960 px both sidebars move side by side below the demos; below 600 px they stack. While a program runs both are hidden.

### 3.4 Picture and sound

- The emulator area has a fixed height (75 % of the window, max. 720 px).
- `js/fit.js` scales the picture to the largest size that fits and keeps the aspect ratio of the
  emulated screen: low PC resolutions (320×200, 640×400, text mode) are shown as 4:3 like on a real
  monitor, js-dos uses `renderAspect: '4/3'`, EmulatorJS cores keep their system's ratio.
- `js/audio.js` resumes audio that the browser held back until the first click; a hint asks
  for a click if sound is still blocked.

## 4. Detection

### 4.1 DOS and Windows programs (`site/js/exe.js`, file header only)

| Header | Type | Emulator |
|---|---|---|
| extension `.com`, or no `MZ` header | DOS | js-dos |
| `MZ`, relocation table before `0x40` | DOS | js-dos |
| `MZ` + `PE\0\0` at `e_lfanew` | Windows 32 bit | Boxedwine |
| `MZ` + `NE` at `e_lfanew` | Windows 16 bit | Boxedwine (always Wine 6) |
| `MZ` + `LE`/`LX` or unknown | DOS (DOS extender like DOS/4GW) | js-dos |
| extension `.bat` | Windows if Windows programs are in the folder, otherwise DOS | |

### 4.2 Consoles and home computers (`site/js/systems.js`)

Only files with a known or ambiguous extension are checked, reading the first 64 KB.
Known BIOS files are not listed as games. Order:

1. Clear magic bytes, e.g. `NES\x1A`, `C64 CARTRIDGE`, `GCR-1541`, `DMS!`/`CAPS`/`RDSK` (Amiga),
   `LYNX`, `ATARI7800`, CPC/Spectrum disk and tape headers, `CISO` (PSP), N64 byte orders,
   Nintendo logo (Game Boy, GBA, DS), `SEGA` headers.
2. CD images: IDs in the first sectors (`SEGADISCSYSTEM`, `SEGA SEGASATURN`, `PSP GAME`, `PLAYSTATION`, 3DO).
3. `TMR SEGA` (the region code tells Master System from Game Gear).
4. Content and size of disks (ADF with `DOS` boot block, D64 sizes).
5. Extension.
6. Ambiguous extensions without a match give several candidates (e.g. `.cue` → PlayStation, Mega-CD,
   Saturn, PC Engine, 3DO, PC-FX); the user picks one.

CD tracks next to a `.cue` are not listed; the `.cue` is started with all its tracks as one ZIP.

### 4.3 Operating system images

- `.iso` with an El Torito boot record (`CD001` at `0x8801`) → complete PC (v86), as CD-ROM.
- `.img`/`.ima`/`.vfd`/`.flp`/`.vhd`/`.raw` with a boot sector (`0x55AA`) → complete PC,
  as floppy (standard floppy sizes) or hard disk.
- *Start your own operating system* always starts the chosen image as a complete PC.

## 5. Emulators

### 5.1 Windows: Boxedwine

- Source: GitHub release `26R1.0` of danoon2/Boxedwine, file `Boxedwine26R1Web.zip`.
- Single- and multithreaded builds. "Automatic" uses multithreaded when the page is *cross-origin isolated*.
- File systems: Wine 6.0 (37 MB) and Wine 11.0 (49 MB, no 16-bit support).
- **Win16 overlay**: the web Wine 6 file system lacks 34 16-bit modules (WinG, toolhelp, lzexpand, ole2, …).
  The build script takes them unchanged from the full Boxedwine file system `TinyCore15Wine6.0.zip`
  and stores them as `wine6/win16-extras.zip` (~385 KB), mounted with `-zip`. A few more missing modules
  that demos need are added the same way (`winhttp`, `jsproxy` for OpenTTD; list `EXTRA_MODULES`).
- User files: drive D: (`/d_drive`). The virtual environment (Wine prefix, drive C:) is optionally kept in IndexedDB.

### 5.2 DOS: js-dos

- Source: npm package `js-dos@8.5.4` (with emulators 8.5.3 and DOSBox).
- Started with `Dos(element, { dosboxConf, initFs, pathPrefix, kiosk: true, autoStart: true })`.
  `pathPrefix` points to this site, so nothing is loaded from the js-dos CDN; `fsChanges: { local: false }`
  disables storage in the browser.
- User files become drive C:. Names that do not fit DOS 8.3 get short names (`Long folder` → `LONGFO~1`)
  and are translated back when saving. Changed files are read with `ci.fsTree()` and `ci.fsReadFile()`.
- Demos can pass command line arguments (`args`, e.g. the sound card) and a fixed speed (`cycles`).

### 5.3 Consoles and home computers: EmulatorJS

- Source: npm package `@emulatorjs/emulatorjs` in its **newest stable version** (`latest`, currently 4.2.3)
  and one package `@emulatorjs/core-<name>` per core in the same version (35 cores, ~200 MB).
- The npm package has no minified files, so the build script joins the sources in `loader.js` order
  into `emulator.min.js` (content unchanged).
- Started by setting the global `EJS_*` variables and loading `data/loader.js`
  (`EJS_gameUrl` = the game's `File`, `EJS_biosUrl` = blob URL of a ZIP with all BIOS files).
- BIOS files with a matching name in the ZIP/folder are used automatically. If a *required* BIOS is
  missing, the game does not start and a hint is shown.
- VICE systems use `vice_autoloadwarp: enabled`; without it, loading a C64 disk takes minutes.
- `emulatorjs/cores.html` lists all cores with version, source repository and licence (generated at build time).
- EmulatorJS checks `cdn.emulatorjs.org/stable/data/version.json` at start (no user data).

### 5.4 Complete PCs: v86

- Source: npm package `v86@0.5.476` and the SeaBIOS/VGA BIOS images from the same v86 commit.
- The disk image is attached as CD-ROM, floppy or hard disk (see 4.3). RAM is set in the options
  (default 128 MB, demos can set their own, e.g. ReactOS 512 MB).
- Large demo images (field `chunk` in `demos.json`, e.g. ReactOS) are split into zstd-compressed parts
  that v86 loads on demand. This keeps every file under the 100 MB limit of GitHub Pages.
- Images are only kept in memory; nothing is written back.

### 5.5 Shared logic (`site/js/runner.js`)

- Remembers size and CRC32 of every user file at start.
- `changedFiles()` compares the current state in the emulator with it.
- `downloadChanges()` creates a ZIP (`zip.js`), `writeBack()` writes into the original folder.
- `supportsFileSync` tells whether saving/writing back is possible.

## 6. Build and delivery

- `scripts/fetch-runtimes.mjs` downloads everything into `site/` (not in git): `boxedwine/`, `jsdos/`,
  `emulatorjs/`, `v86/`, `demos/`, `coi-serviceworker.js`. Downloads are cached in `vendor/`.
  ZIP and tar are unpacked in Node without external tools.
- Every component gets its licence text and source archives (`*/LICENSE-*.txt`, `*/source/`), linked in the footer.
- `.github/workflows/pages.yml` runs the script on every push to `main` and publishes `site/`.
- Boxedwine, js-dos and v86 are pinned; `scripts/update-runtimes.mjs` checks for new versions
  (see [development.md](development.md#update-the-emulators)). The version labels on the page read the
  `version.json` files written by the fetch script.
- Size of the published site: ~440 MB (EmulatorJS ~206 MB, demos ~120 MB, Boxedwine ~107 MB, js-dos ~6 MB,
  v86 ~5 MB, source archives). GitHub Pages allows 1 GB.
- The README screenshots are in `docs/images/` (WebP, taken from the running site at 1440 px width).
- Multithreading needs cross-origin isolation; on GitHub Pages `coi-serviceworker` provides it
  (see [development.md](development.md#why-a-service-worker)). `scripts/serve.mjs` is a local server
  with the headers (`--no-coi` without).

## 7. Tested

| Case | Result |
|---|---|
| SkiFree (Win32) from ZIP, Wine 6 and 11, single- and multithreaded | runs |
| Program from a folder with subfolders | runs |
| Server without COOP/COEP (like GitHub Pages) | service worker enables multithreading |
| Colonization for Windows (Win16, WinG) | runs with Wine 6 + Win16 overlay |
| Own DOS COM and EXE in a long folder name | run, `SAVE.TXT` is saved with its original path |
| ZIP with DOS and Windows programs mixed | types detected correctly |
| Great Giana Sisters (`.d64`, C64) | runs, intro after ~45–90 s |
| Dogs of War (`.adf`, Amiga) | title screen with the free AROS Kickstart |
| All demos | start from the demo carousel |
| Loading screen on a slow connection (5 MB/s) | steps and "x of 38.5 MB" visible |
| Picture scaling, normal and fullscreen | fills the area with the right aspect ratio for all four emulators |
| Horizontal Shooter and Pink Wall (`.sfc`, SNES) | run with Snes9x; Pink Wall with music, Horizontal Shooter has no sound by design |
| *Sound on/off* (audio level measured at the speakers) | js-dos and EmulatorJS go silent and come back |
| *Play/Pause* (picture and audio compared) | all four emulators stop and continue; Boxedwine does not run on while paused |
| Arrow keys, space, page down while a program runs | page does not scroll, the emulator still gets the keys |
| Carousel: drag with the mouse, scroll bar, arrow buttons | scrolls and snaps; a drag never opens a platform |
| Platform tile → demo list → demo info → *Start* (1440 and 400 px wide) | list and info open below, clicking the tile again closes both |

Not tested yet: drag & drop of files, writing back into a folder, DOS/4GW programs, most consoles and
home computers, BIOS files, CD images with `.cue`, muting Boxedwine and v86 (their demos make no sound).

## 8. Open points

- Test the remaining systems (consoles, Spectrum, CPC, CD images, arcade).
- Arcade ROM ZIPs: a single opened ZIP is always unpacked, but arcade games need the ZIP as it is.
  Only ZIPs inside a folder are detected as arcade games.
- EmulatorJS save games are stored in the browser (IndexedDB), not in the opened folder.
- No Amiga demo yet: the free games tested do not run with AROS or have unclear rights to their graphics.
- Win16 programs built with Open Watcom crash in Boxedwine at start; cause unknown.
- ZIP files packed with the old PKZIP method "Implode" cannot be opened.
