// Starts Boxedwine (Emscripten build) with the user's files mounted as drive D:.
// Boxedwine itself is loaded as an unmodified script from ./boxedwine/.

import { crc32, createZip } from './zip.js';

const D_DRIVE = '/d_drive';
const D_DRIVE_IN_WINE = '/home/username/.wine/dosdevices/d:';
const ROOT_ZIP = 'boxedwine.zip';

/** IndexedDB names used for the persistent C: drive (one per Wine version). */
export const PERSISTENT_ROOTS = ['/root-wine6', '/root-wine11'];

export const canUseThreads = () => globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined';

/**
 * @typedef {object} StartOptions
 * @property {'wine6'|'wine11'} wine
 * @property {'auto'|'st'|'mt'} threads
 * @property {string} resolution e.g. "800x600" or "" for default
 * @property {number} bpp 8, 16 or 32
 * @property {boolean} sound
 * @property {boolean} persistent keep the C: drive (Wine prefix) in IndexedDB
 */

/**
 * Downloads a file and reports progress.
 * @param {string} url
 * @param {(loaded:number, total:number)=>void} onProgress
 */
async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} konnte nicht geladen werden (HTTP ${res.status}).`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress(loaded, total);
  }
  const out = new Uint8Array(loaded);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => fail(new Error(`${src} konnte nicht geladen werden.`));
    document.body.appendChild(s);
  });
}

function splitPath(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? ['', path] : [path.slice(0, i), path.slice(i + 1)];
}

export class Emulator {
  /**
   * @param {object} ui
   * @param {HTMLCanvasElement} ui.canvas
   * @param {(text:string, fraction?:number)=>void} ui.status
   * @param {(line:string, isError:boolean)=>void} ui.log
   */
  constructor(ui) {
    this.ui = ui;
    /** @type {Map<string, {size:number, crc:number}>} */
    this.snapshot = new Map();
    this.workspace = null;
    this.running = false;
  }

  /**
   * @param {import('./workspace.js').Workspace} workspace
   * @param {string} program relative path of the .exe/.bat inside the workspace
   * @param {StartOptions} opts
   */
  async start(workspace, program, opts) {
    if (this.running) throw new Error('Der Emulator läuft bereits. Bitte Seite neu laden.');
    this.running = true;
    this.workspace = workspace;
    const { status, log, canvas } = this.ui;

    const threaded = opts.threads === 'mt' || (opts.threads === 'auto' && canUseThreads());
    if (threaded && !canUseThreads()) {
      throw new Error('Multithreading ist in diesem Browser bzw. auf diesem Server nicht verfügbar.');
    }
    const build = threaded ? 'mt' : 'st';
    const buildBase = new URL(`boxedwine/${build}/`, document.baseURI).href;
    log(`Build: ${threaded ? 'Multithreaded' : 'Singlethreaded'}, Wine ${opts.wine === 'wine11' ? '11' : '6'}`, false);

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
          self.snapshot.set(f.path, { size: f.data.length, crc: crc32(f.data) });
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

  /** Files on drive D: that are new or differ from what was loaded. */
  changedFiles() {
    const FS = globalThis.FS;
    if (!FS) return [];
    const changed = [];
    const walk = (dir, prefix) => {
      for (const name of FS.readdir(dir)) {
        if (name === '.' || name === '..') continue;
        const full = `${dir}/${name}`;
        const rel = prefix + name;
        const st = FS.stat(full);
        if (FS.isDir(st.mode)) {
          walk(full, rel + '/');
        } else if (FS.isFile(st.mode)) {
          const data = FS.readFile(full);
          const before = this.snapshot.get(rel);
          if (!before || before.size !== data.length || before.crc !== crc32(data)) {
            changed.push({ path: rel, data });
          }
        }
      }
    };
    walk(D_DRIVE, '');
    return changed;
  }

  /** Downloads all new/changed files of drive D: as a ZIP. Returns the count. */
  downloadChanges() {
    const files = this.changedFiles();
    if (files.length === 0) return 0;
    const blob = createZip(files.map((f) => ({ name: f.path, data: f.data })));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(this.workspace?.name || 'webexe').replace(/[^\w.-]+/g, '_')}-aenderungen.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return files.length;
  }

  /**
   * Writes new/changed files back into the folder the user opened (Chromium only).
   * Files are never deleted from the user's folder.
   * @returns {Promise<number>} number of written files
   */
  async writeBack() {
    const root = this.workspace?.dirHandle;
    if (!root) throw new Error('Kein Ordner mit Schreibzugriff geöffnet.');
    if ((await root.requestPermission({ mode: 'readwrite' })) !== 'granted') {
      throw new Error('Schreibzugriff wurde nicht erlaubt.');
    }
    const files = this.changedFiles();
    for (const f of files) {
      const parts = f.path.split('/');
      const name = parts.pop();
      let dir = root;
      for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(f.data);
      await writable.close();
      this.snapshot.set(f.path, { size: f.data.length, crc: crc32(f.data) });
    }
    return files.length;
  }
}

/** Deletes the persistent C: drives stored in IndexedDB. */
export async function clearPersistentStorage() {
  await Promise.all(PERSISTENT_ROOTS.map((name) => new Promise((ok) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = () => ok();
  })));
}
