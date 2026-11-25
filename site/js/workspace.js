// Collects the user's files (single files, a ZIP archive or a folder) into a
// workspace: a flat list of relative paths with lazy loaders for their bytes.

import { listZip, readZipEntry } from './zip.js';
import { detectKind, emulatorFor } from './exe.js';
import { HEAD_BYTES, detectSystems, extOf, isBiosFile, isPossibleGame } from './systems.js';

/**
 * @typedef {{ path: string, size: number, load: () => Promise<Uint8Array>,
 *             read?: (offset:number, length:number) => Promise<Uint8Array> }} WorkspaceFile
 * @typedef {WorkspaceFile & { kind: import('./exe.js').ProgramKind | 'game',
 *             emulator: 'dos'|'windows'|'emulatorjs', systems?: string[] }} Program
 * @typedef {{ name: string, files: WorkspaceFile[], dirHandle?: FileSystemDirectoryHandle }} Workspace
 */

const RUNNABLE = /\.(exe|com|bat)$/i;

const fileLoader = (file) => async () => new Uint8Array(await file.arrayBuffer());
const fileRangeReader = (file) => async (offset, length) =>
  new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());

/** Creates a workspace file backed by a browser File object. */
const fromFile = (path, file) => ({ path, size: file.size, load: fileLoader(file), read: fileRangeReader(file) });

function cleanPath(path) {
  return path
    .split('/')
    .filter((p) => p && p !== '.' && p !== '..')
    .join('/');
}

/**
 * Removes a folder prefix shared by all files, so "Game/GAME.EXE" becomes
 * "GAME.EXE" when everything lives inside "Game/".
 */
function stripCommonRoot(files) {
  if (files.length === 0) return files;
  const first = files[0].path.split('/');
  if (first.length < 2) return files;
  const prefix = first[0] + '/';
  if (!files.every((f) => f.path.startsWith(prefix))) return files;
  return stripCommonRoot(files.map((f) => ({ ...f, path: f.path.slice(prefix.length) })));
}

async function fromZip(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const entries = listZip(data).filter((e) => !e.isDir);
  const files = entries
    .map((e) => ({ path: cleanPath(e.name), size: e.size, load: () => readZipEntry(data, e) }))
    .filter((f) => f.path);
  return { name: file.name, files: stripCommonRoot(files) };
}

/**
 * From an <input type="file"> selection (multiple files or webkitdirectory).
 * @param {FileList|File[]} fileList
 * @returns {Promise<Workspace>}
 */
export async function fromFileList(fileList) {
  const list = [...fileList];
  if (list.length === 1 && /\.zip$/i.test(list[0].name)) return fromZip(list[0]);

  const files = list.map((f) => fromFile(cleanPath(f.webkitRelativePath || f.name), f));
  const isFolder = list.some((f) => f.webkitRelativePath);
  const name = isFolder ? list[0].webkitRelativePath.split('/')[0] : list.map((f) => f.name).join(', ');
  return { name, files: isFolder ? stripCommonRoot(files) : files };
}

/**
 * From files kept for a restart (see restart.js), with their original paths.
 * @param {string} name
 * @param {{path:string, data:Uint8Array}[]} items
 * @returns {Workspace}
 */
export function fromStoredFiles(name, items) {
  return { name, files: items.map(({ path, data }) => fromFile(path, new Blob([data]))) };
}

/**
 * From a directory picked with showDirectoryPicker (Chromium). The handle is
 * kept so changed files can be written back later.
 * @param {FileSystemDirectoryHandle} dirHandle
 * @returns {Promise<Workspace>}
 */
export async function fromDirectoryHandle(dirHandle) {
  const files = [];
  async function walk(handle, prefix) {
    for await (const [name, child] of handle.entries()) {
      const path = prefix + name;
      if (child.kind === 'directory') {
        await walk(child, path + '/');
      } else {
        files.push(fromFile(path, await child.getFile()));
      }
    }
  }
  await walk(dirHandle, '');
  return { name: dirHandle.name, files, dirHandle };
}

/**
 * From a drag & drop operation (files, a ZIP or folders).
 * @param {DataTransfer} dataTransfer
 * @returns {Promise<Workspace>}
 */
export async function fromDataTransfer(dataTransfer) {
  const entries = [...dataTransfer.items]
    .filter((i) => i.kind === 'file')
    .map((i) => i.webkitGetAsEntry?.())
    .filter(Boolean);

  if (entries.length === 0) return fromFileList(dataTransfer.files);
  if (entries.length === 1 && entries[0].isFile && /\.zip$/i.test(entries[0].name)) {
    return fromZip(dataTransfer.files[0]);
  }

  const files = [];
  const getFile = (entry) => new Promise((ok, fail) => entry.file(ok, fail));
  const readBatch = (reader) => new Promise((ok, fail) => reader.readEntries(ok, fail));

  async function walk(entry, prefix) {
    if (entry.isFile) {
      files.push(fromFile(cleanPath(prefix + entry.name), await getFile(entry)));
      return;
    }
    const reader = entry.createReader();
    for (let batch = await readBatch(reader); batch.length; batch = await readBatch(reader)) {
      for (const child of batch) await walk(child, prefix + entry.name + '/');
    }
  }
  for (const entry of entries) await walk(entry, '');

  const name = entries.length === 1 ? entries[0].name : `${entries.length} Elemente`;
  return { name, files: stripCommonRoot(files) };
}

function rangeReader(f) {
  if (f.read) return f.read;
  let bytes; // e.g. ZIP entries: decompress once
  return async (offset, length) => (bytes ??= await f.load()).subarray(offset, offset + length);
}

/**
 * Finds console/home computer games (EmulatorJS) by extension and magic bytes.
 * @param {Workspace} ws
 * @returns {Promise<Program[]>}
 */
async function findGames(ws) {
  const dirsWithCue = new Set(ws.files.filter((f) => extOf(f.path) === 'cue')
    .map((f) => f.path.slice(0, f.path.lastIndexOf('/') + 1).toLowerCase()));

  const candidates = ws.files.filter((f) => {
    if (RUNNABLE.test(f.path) || isBiosFile(f.path) || !isPossibleGame(f.path)) return false;
    const dir = f.path.slice(0, f.path.lastIndexOf('/') + 1).toLowerCase();
    // Tracks of a CD image are started via their .cue sheet.
    if (['bin', 'img', 'iso'].includes(extOf(f.path)) && dirsWithCue.has(dir)) return false;
    return true;
  });

  const games = await Promise.all(candidates.map(async (f) => {
    let systems = [];
    try {
      const head = await rangeReader(f)(0, HEAD_BYTES);
      systems = detectSystems(f.path, f.size, head);
    } catch { /* unreadable: not a game */ }
    return { ...f, kind: 'game', emulator: 'emulatorjs', systems };
  }));
  return games.filter((g) => g.systems.length > 0);
}

/**
 * Lists runnable programs and games with their type, most likely candidates
 * first: shallow paths before deep ones, installers last.
 * @param {Workspace} ws
 * @returns {Promise<Program[]>}
 */
export async function findPrograms(ws) {
  const unlikely = /(^|\/)(unins\w*|uninst\w*|setup|install\w*|config\w*|readme)\.(exe|com|bat)$/i;
  const candidates = ws.files.filter((f) => RUNNABLE.test(f.path));

  const executables = await Promise.all(candidates.map(async (f) => {
    let kind;
    try { kind = await detectKind(f.path, rangeReader(f)); } catch { kind = 'unknown'; }
    return { ...f, kind };
  }));
  const kinds = executables.map((p) => p.kind);
  for (const p of executables) p.emulator = emulatorFor(p.kind, kinds);
  const programs = [...executables, ...await findGames(ws)];

  const rank = (p) => (p.kind === 'game' || /\.exe$/i.test(p.path) ? 0 : /\.com$/i.test(p.path) ? 1 : 2);
  return programs.sort((a, b) => {
    const ua = unlikely.test(a.path), ub = unlikely.test(b.path);
    if (ua !== ub) return ua ? 1 : -1;
    const da = a.path.split('/').length, db = b.path.split('/').length;
    if (da !== db) return da - db;
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return a.path.localeCompare(b.path);
  });
}

export function totalSize(ws) {
  return ws.files.reduce((s, f) => s + f.size, 0);
}
