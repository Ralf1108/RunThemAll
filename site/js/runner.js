// Shared logic for both emulators: remembering what was loaded, detecting
// changed files, saving them as ZIP or writing them back to the opened folder.

import { crc32, createZip } from './zip.js';

/**
 * @typedef {object} RunnerUi
 * @property {HTMLCanvasElement} canvas  canvas for Boxedwine
 * @property {HTMLElement} dosContainer  container element for js-dos
 * @property {HTMLElement} ejsContainer  container element for EmulatorJS
 * @property {(text:string, fraction?:number)=>void} status
 * @property {(line:string, isError:boolean)=>void} log
 * @property {(labels:string[])=>void} steps          defines the loading steps
 * @property {(index:number, detail?:string)=>void} step marks a step as active
 * @property {(loaded:number, total:number)=>void} progress download progress
 * @property {()=>void} ready                          emulator is running, hide the loading screen
 * @property {(text:string)=>void} emulatorInfo        which emulator/version is running
 */

export class Runner {
  /** @param {RunnerUi} ui */
  constructor(ui) {
    this.ui = ui;
    /** @type {Map<string, {size:number, crc:number}>} path -> fingerprint of the loaded file */
    this.snapshot = new Map();
    /** @type {import('./workspace.js').Workspace|null} */
    this.workspace = null;
    this.running = false;
  }

  remember(path, data) {
    this.snapshot.set(path, { size: data.length, crc: crc32(data) });
  }

  /**
   * All files as seen inside the emulator, with workspace-relative paths.
   * @returns {Promise<{path:string, data:Uint8Array}[]>}
   */
  async readAllFiles() {
    throw new Error('not implemented');
  }

  /** Files that are new or differ from what was loaded. */
  async changedFiles() {
    const all = await this.readAllFiles();
    return all.filter(({ path, data }) => {
      const before = this.snapshot.get(path);
      return !before || before.size !== data.length || before.crc !== crc32(data);
    });
  }

  /** Downloads all new/changed files as a ZIP. Returns their paths. */
  async downloadChanges() {
    const files = await this.changedFiles();
    if (files.length === 0) return [];
    const blob = createZip(files.map((f) => ({ name: f.path, data: f.data })));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(this.workspace?.name || 'runthemall').replace(/[^\w.-]+/g, '_')}-aenderungen.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return files.map((f) => f.path);
  }

  /**
   * Writes new/changed files back into the folder the user opened (Chromium only).
   * Files are never deleted from the user's folder.
   * @returns {Promise<string[]>} paths of the written files
   */
  async writeBack() {
    const root = this.workspace?.dirHandle;
    if (!root) throw new Error('No folder with write access is open.');
    if ((await root.requestPermission({ mode: 'readwrite' })) !== 'granted') {
      throw new Error('Write access was not allowed.');
    }
    const files = await this.changedFiles();
    for (const f of files) {
      const parts = f.path.split('/');
      const name = parts.pop();
      let dir = root;
      for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
      const handle = await dir.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(f.data);
      await writable.close();
      this.remember(f.path, f.data);
    }
    return files.map((f) => f.path);
  }

  /** Enters fullscreen mode. */
  fullscreen() {}

  /** Whether changed files can be read back (save as ZIP / write back to folder). */
  get supportsFileSync() { return true; }
}

/** Downloads a file and reports progress. */
export async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status}).`);
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

/**
 * Downloads the emulator files up front with a visible progress bar. The
 * emulator then gets them from the browser cache when it loads them itself.
 * Content-Length is read with HEAD requests first, so the bar shows the total.
 * @param {string[]} urls
 * @param {RunnerUi} ui
 * @returns {Promise<Map<string, Uint8Array>>} downloaded bytes per URL
 */
export async function prefetch(urls, ui) {
  const sizes = await Promise.all(urls.map(async (url) => {
    try {
      const res = await fetch(url, { method: 'HEAD' });
      return Number(res.headers.get('Content-Length')) || 0;
    } catch { return 0; }
  }));
  const total = sizes.reduce((a, b) => a + b, 0);
  const loaded = new Array(urls.length).fill(0);
  const report = () => ui.progress(loaded.reduce((a, b) => a + b, 0), total);
  report();
  const results = await Promise.all(urls.map((url, i) =>
    fetchWithProgress(url, (n) => { loaded[i] = n; report(); })));
  return new Map(urls.map((url, i) => [url, results[i]]));
}

export function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = ok;
    s.onerror = () => fail(new Error(`Could not load ${src}.`));
    document.body.appendChild(s);
  });
}

export function loadStylesheet(href) {
  return new Promise((ok, fail) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = href;
    l.onload = ok;
    l.onerror = () => fail(new Error(`Could not load ${href}.`));
    document.head.prepend(l); // before our own styles, so ours win on equal specificity
  });
}

export function splitPath(path) {
  const i = path.lastIndexOf('/');
  return i < 0 ? ['', path] : [path.slice(0, i), path.slice(i + 1)];
}
