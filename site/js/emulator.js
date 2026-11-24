// Runs Windows programs with Boxedwine (Emscripten build). The user's files are
// mounted as drive D:. Boxedwine itself is loaded unmodified from ./boxedwine/.

import { Runner, loadScript, prefetch, splitPath } from './runner.js';

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
 */

export class WindowsRunner extends Runner {
  /**
   * @param {import('./workspace.js').Workspace} workspace
   * @param {string} program relative path of the .exe/.bat inside the workspace
   * @param {WindowsOptions} opts
   */
  async start(workspace, program, opts) {
    if (this.running) throw new Error('Der Emulator läuft bereits. Bitte Seite neu laden.');
    this.running = true;
    this.workspace = workspace;
    const { status, log, canvas } = this.ui;
    canvas.hidden = false;

    const threaded = opts.threads === 'mt' || (opts.threads === 'auto' && canUseThreads());
    if (threaded && !canUseThreads()) {
      throw new Error('Multithreading ist in diesem Browser bzw. auf diesem Server nicht verfügbar.');
    }
    const build = threaded ? 'mt' : 'st';
    const buildBase = new URL(`boxedwine/${build}/`, document.baseURI).href;
    const wineLabel = opts.wine === 'wine11' ? 'Wine 11' : 'Wine 6';
    const info = `Boxedwine 26R1 · ${wineLabel} · ${threaded ? 'Multithreaded' : 'Singlethreaded'}`;
    this.ui.emulatorInfo(info);
    log(info, false);
    this.ui.steps(['Emulator und Wine-Dateisystem herunterladen', 'Programmdateien einlesen', 'Wine starten']);

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
    if (!opts.sound) args.push('-nosound');
    args.push('-w', progDir ? `${D_DRIVE_IN_WINE}/${progDir}` : D_DRIVE_IN_WINE);
    args.push('/bin/wine');
    if (/\.bat$/i.test(progName)) args.push('cmd', '/c');
    args.push(progName);
    log(`Parameter: ${args.join(' ')}`, false);

    // 3. Configure the Emscripten module before loading boxedwine.js.
    const self = this;
    window.Module = {
      arguments: args,
      canvas,
      locateFile: (path) => buildBase + path,
      mainScriptUrlOrBlob: buildBase + 'boxedwine.js',
      print: (...a) => log(a.join(' '), false),
      printErr: (...a) => log(a.join(' '), true),
      setStatus: (text) => {
        if (text === 'Running...') {
          status('Läuft');
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
          self.ui.step(2, 'Der erste Start kann etwas dauern.');
          status('Starte Wine …');
          Module.removeRunDependency('runthemall-fs');
        };
        if (opts.persistent) {
          FS.mount(IDBFS, { autoPersist: true }, rootDir);
          FS.syncfs(true, (err) => {
            if (err) log(`Persistenter Speicher nicht verfügbar: ${err}`, true);
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

  fullscreen() {
    if (window.Module?.requestFullscreen) window.Module.requestFullscreen(false, true);
    else this.ui.canvas.requestFullscreen?.();
  }
}

/** Deletes the persistent C: drives stored in IndexedDB. */
export async function clearPersistentStorage() {
  await Promise.all(PERSISTENT_ROOTS.map((name) => new Promise((ok) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => ok();
  })));
}
