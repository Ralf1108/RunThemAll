// Runs Windows programs with Boxedwine (Emscripten build). The user's files are
// mounted as drive D:. Boxedwine is built from its source by scripts/build-boxedwine.mjs.

import { WineNet } from './wine-net.js';
import { Runner, loadScript, prefetch, splitPath } from './runner.js';
import { fitToBox } from './fit.js';

const D_DRIVE = '/d_drive';
const D_DRIVE_IN_WINE = '/home/username/.wine/dosdevices/d:';
const ROOT_ZIP = 'boxedwine.zip';
/** Extra 16-bit Windows modules for the stripped Wine 6 file system (see fetch script). */
const OVERLAY_ZIPS = { wine6: ['win16-extras.zip'], wine11: [] };

/** IndexedDB names used for the persistent C: drive (one per Wine version). */
export const PERSISTENT_ROOTS = ['/root-wine6', '/root-wine11'];

export const canUseThreads = () => globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined';

/**
 * @typedef {object} WindowsOptions
 * @property {'wine6'|'wine11'} wine
 * @property {'auto'|'st'|'mt'} threads
 * @property {string} resolution e.g. "800x600" or "" for default
 * @property {number} bpp 8, 16 or 32
 * @property {boolean} sound
 * @property {boolean} persistent keep the C: drive (Wine prefix) in IndexedDB
 * @property {string} [args] parameters for the program
 */

export class WindowsRunner extends Runner {
  constructor(ui) {
    super(ui);
    /** Netplay room (lobby.js): {client} puts the sockets on a virtual LAN (wine-net.js). */
    this.netplay = null;
  }

  /**
   * @param {import('./workspace.js').Workspace} workspace
   * @param {string} program relative path of the .exe/.bat inside the workspace
   * @param {WindowsOptions} opts
   */
  async start(workspace, program, opts) {
    if (this.running) throw new Error('The emulator is already running. Please reload the page.');
    this.running = true;
    this.workspace = workspace;
    const { status, log, canvas } = this.ui;
    canvas.hidden = false;
    const present = presentLayer(canvas);
    fitToBox(canvas, this.ui.screen, undefined, present.canvas);

    const threaded = opts.threads === 'mt' || (opts.threads === 'auto' && canUseThreads());
    if (threaded && !canUseThreads()) {
      throw new Error('Multithreading is not available in this browser or on this server.');
    }
    const build = threaded ? 'mt' : 'st';
    const buildBase = new URL(`boxedwine/${build}/`, document.baseURI).href;
    const wineLabel = opts.wine === 'wine11' ? 'Wine 11' : 'Wine 6';
    const tag = await fetch('boxedwine/version.json').then((r) => r.json()).then((v) => v.tag).catch(() => '');
    const info = `Boxedwine ${tag} · ${wineLabel} · ${threaded ? 'Multithreaded' : 'Singlethreaded'}`.replace('  ', ' ');
    this.ui.emulatorInfo(info);
    log(info, false);
    this.ui.steps(['Download the emulator and the Wine file system', 'Read the program files', 'Start Wine']);

    // 1. Download emulator + Wine file system (progress bar), read the user's files.
    this.ui.step(0);
    const rootUrl = `boxedwine/${opts.wine}/${ROOT_ZIP}`;
    const overlayUrls = OVERLAY_ZIPS[opts.wine].map((name) => `boxedwine/${opts.wine}/${name}`);
    const downloaded = await prefetch(
      [buildBase + 'boxedwine.js', buildBase + 'boxedwine.wasm', rootUrl, ...overlayUrls], this.ui);
    const rootZip = downloaded.get(rootUrl);
    const overlays = OVERLAY_ZIPS[opts.wine].map((name, i) => ({ name, data: downloaded.get(overlayUrls[i]) }));

    this.ui.step(1);
    const userFiles = await Promise.all(
      workspace.files.map(async (f) => ({ path: f.path, data: await f.load() })),
    );

    // 2. Build emulator arguments.
    const rootDir = opts.wine === 'wine11' ? PERSISTENT_ROOTS[1] : PERSISTENT_ROOTS[0];
    const [progDir, progName] = splitPath(program);
    const args = ['-root', rootDir, '-zip', ROOT_ZIP];
    for (const o of overlays) args.push('-zip', o.name);
    args.push('-mount_drive', D_DRIVE, 'd');
    if (opts.resolution) args.push('-resolution', opts.resolution);
    if (opts.bpp !== 32) args.push('-bpp', String(opts.bpp));
    args.push('-w', progDir ? `${D_DRIVE_IN_WINE}/${progDir}` : D_DRIVE_IN_WINE);
    args.push('/bin/wine');
    if (/\.bat$/i.test(progName)) args.push('cmd', '/c');
    args.push(progName);
    if (opts.args?.trim()) args.push(...opts.args.trim().split(/\s+/)); // the program's own parameters
    log(`Parameter: ${args.join(' ')}`, false);

    // Netplay: in a room, Boxedwine's sockets use a virtual LAN between the players (wine-net.js);
    // otherwise there is no network.
    let net = null;
    if (this.netplay) {
      net = new WineNet(this.netplay.client);
      log(`Network: virtual LAN of room ${this.netplay.client.room}, this PC is ${net.ownAddress} (TCP and UDP to the other players, no internet).`, false);
    }

    // 3. Configure the Emscripten module before loading boxedwine.js.
    const self = this;
    window.Module = {
      arguments: args,
      canvas,
      // Boxedwine (since 2026) shows finished frames on a second canvas above the SDL canvas;
      // these two functions are normally part of its own page (boxedwine-shell.js).
      boxedwinePresentFrame: present.frame,
      boxedwinePresentSoftwareFrame: present.softwareFrame,
      boxedwineNetworking: net ? net.networking : { enabled: false },
      locateFile: (path) => buildBase + path,
      print: (...a) => log(a.join(' '), false),
      printErr: (...a) => log(a.join(' '), true),
      setStatus: (text) => {
        if (text === 'Running...') {
          status('Running');
          this.ui.ready();
        } else if (text) {
          status(text);
        }
      },
      preRun: [function setupFileSystem() {
        const { FS, IDBFS } = globalThis;
        const Module = window.Module;
        Module.addRunDependency('runthemall-fs');

        FS.mkdir(rootDir);
        FS.mkdir(D_DRIVE);
        FS.createDataFile('/', ROOT_ZIP, rootZip, true, true);
        for (const o of overlays) FS.createDataFile('/', o.name, o.data, true, true);
        for (const f of userFiles) {
          const [dir, name] = splitPath(f.path);
          if (dir) FS.createPath(D_DRIVE, dir, true, true);
          FS.createDataFile(dir ? `${D_DRIVE}/${dir}` : D_DRIVE, name, f.data, true, true);
          self.remember(f.path, f.data);
        }

        const done = () => {
          self.ui.step(2, 'The first start can take a while.');
          status('Starting Wine …');
          Module.removeRunDependency('runthemall-fs');
        };
        if (opts.persistent) {
          FS.mount(IDBFS, { autoPersist: true }, rootDir);
          FS.syncfs(true, (err) => {
            if (err) log(`Persistent storage not available: ${err}`, true);
            done();
          });
        } else {
          done();
        }
      }],
    };

    this.ui.step(2);
    await loadScript(buildBase + 'boxedwine.js');
  }

  async readAllFiles() {
    const FS = globalThis.FS;
    if (!FS) return [];
    const files = [];
    const walk = (dir, prefix) => {
      for (const name of FS.readdir(dir)) {
        if (name === '.' || name === '..') continue;
        const full = `${dir}/${name}`;
        const st = FS.stat(full);
        if (FS.isDir(st.mode)) walk(full, `${prefix}${name}/`);
        else if (FS.isFile(st.mode)) files.push({ path: prefix + name, data: FS.readFile(full) });
      }
    };
    walk(D_DRIVE, '');
    return files;
  }

  get supportsPause() { return true; }

  setPaused(paused) {
    if (paused) window.Module?.pauseMainLoop?.();
    else window.Module?.resumeMainLoop?.();
  }

  fullscreen() {
    if (window.Module?.requestFullscreen) window.Module.requestFullscreen(false, true);
    else this.ui.canvas.requestFullscreen?.();
  }
}

/**
 * The canvas Boxedwine presents its frames on (id boxedwine-webgl-canvas-0, as in Boxedwine's own
 * page). It lies exactly over the SDL canvas and lets mouse events through; Boxedwine's input code
 * uses its size for the mouse coordinates while it is visible.
 * @param {HTMLCanvasElement} canvas the SDL canvas
 */
function presentLayer(canvas) {
  const layer = document.createElement('canvas');
  layer.id = 'boxedwine-webgl-canvas-0';
  layer.className = canvas.className;
  layer.style.cssText = 'position:absolute;pointer-events:none;z-index:1;background:transparent';
  layer.oncontextmenu = (e) => e.preventDefault();
  canvas.after(layer);
  const parent = canvas.parentElement;
  if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
  const place = () => {
    layer.style.left = `${canvas.offsetLeft}px`;
    layer.style.top = `${canvas.offsetTop}px`;
    layer.style.width = `${canvas.offsetWidth}px`;
    layer.style.height = `${canvas.offsetHeight}px`;
  };
  new ResizeObserver(place).observe(canvas);
  new ResizeObserver(place).observe(parent);
  place();

  // The presented frames define the displayed size (fitToBox follows the layer's resolution;
  // in the multithreaded build the SDL canvas belongs to a worker and cannot be resized here).
  layer.width = 800;
  layer.height = 600;
  const resize = (w, h) => {
    if (layer.width !== w) layer.width = w;
    if (layer.height !== h) layer.height = h;
  };
  const finish = (state) => { if (state && typeof Atomics !== 'undefined') Atomics.store(state, 0, 0); };
  let ctx2d = null;
  let bitmapCtx = null;
  return {
    canvas: layer,
    /** A frame from WebGL rendering (ImageBitmap), optionally a part of it. */
    frame(bitmap, state, sx, sy, sw, sh) {
      if (!bitmap) return finish(state);
      sx = Math.max(0, sx | 0);
      sy = Math.max(0, sy | 0);
      sw = Math.max(1, Math.min(bitmap.width - sx, sw | 0 || bitmap.width));
      sh = Math.max(1, Math.min(bitmap.height - sy, sh | 0 || bitmap.height));
      resize(sw, sh);
      if (sx === 0 && sy === 0 && sw === bitmap.width && sh === bitmap.height && !ctx2d) {
        bitmapCtx ??= layer.getContext('bitmaprenderer');
        if (bitmapCtx) {
          bitmapCtx.transferFromImageBitmap(bitmap);
          return finish(state);
        }
      }
      ctx2d ??= layer.getContext('2d');
      ctx2d?.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
      bitmap.close?.();
      finish(state);
    },
    /** A frame from software rendering: RGBA bytes. */
    softwareFrame(width, height, buffer, state) {
      if (!buffer) return finish(state);
      resize(width, height);
      if (bitmapCtx) return finish(state); // the canvas already has a bitmap renderer
      ctx2d ??= layer.getContext('2d');
      ctx2d?.putImageData(new ImageData(new Uint8ClampedArray(buffer), width, height), 0, 0);
      finish(state);
    },
  };
}

/** Deletes the persistent C: drives stored in IndexedDB. */
export async function clearPersistentStorage() {
  await Promise.all(PERSISTENT_ROOTS.map((name) => new Promise((ok) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => ok();
  })));
}
