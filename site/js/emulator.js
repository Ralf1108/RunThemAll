// Runs Windows programs with Boxedwine (Emscripten build). The user's files are
// mounted as drive D:. Boxedwine itself is loaded unmodified from ./boxedwine/.

import { Runner, fetchWithProgress, loadScript, splitPath } from './runner.js';

const D_DRIVE = '/d_drive';
const D_DRIVE_IN_WINE = '/home/username/.wine/dosdevices/d:';
const ROOT_ZIP = 'boxedwine.zip';

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
    log(`Boxedwine: ${threaded ? 'Multithreaded' : 'Singlethreaded'}, Wine ${opts.wine === 'wine11' ? '11' : '6'}`, false);

    // 1. Read user files and the Wine root file system in parallel.
    status('Lade Wine-Dateisystem …', 0);
    const rootZipPromise = fetchWithProgress(`boxedwine/${opts.wine}/${ROOT_ZIP}`, (loaded, total) => {
      const mb = (loaded / 1048576).toFixed(0);
      status(`Lade Wine-Dateisystem … ${mb} MB`, total ? loaded / total : undefined);
    });
    const userFiles = await Promise.all(
      workspace.files.map(async (f) => ({ path: f.path, data: await f.load() })),
    );
    const rootZip = await rootZipPromise;

    // 2. Build emulator arguments.
    const rootDir = opts.wine === 'wine11' ? PERSISTENT_ROOTS[1] : PERSISTENT_ROOTS[0];
    const [progDir, progName] = splitPath(program);
    const args = ['-root', rootDir, '-zip', ROOT_ZIP, '-mount_drive', D_DRIVE, 'd'];
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
      setStatus: (text) => { if (text) status(text === 'Running...' ? 'Läuft' : text); },
      preRun: [function setupFileSystem() {
        const { FS, IDBFS } = globalThis;
        const Module = window.Module;
        Module.addRunDependency('webexe-fs');

        FS.mkdir(rootDir);
        FS.mkdir(D_DRIVE);
        FS.createDataFile('/', ROOT_ZIP, rootZip, true, true);
        for (const f of userFiles) {
          const [dir, name] = splitPath(f.path);
          if (dir) FS.createPath(D_DRIVE, dir, true, true);
          FS.createDataFile(dir ? `${D_DRIVE}/${dir}` : D_DRIVE, name, f.data, true, true);
          self.remember(f.path, f.data);
        }

        const done = () => {
          status('Starte Wine … (der erste Start kann etwas dauern)');
          Module.removeRunDependency('webexe-fs');
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

    status('Lade Emulator …');
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
