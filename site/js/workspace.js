// Collects the user's files (single files, a ZIP archive or a folder) into a
// workspace: a flat list of relative paths with lazy loaders for their bytes.

import { listZip, readZipEntry } from './zip.js';
import { detectKind, emulatorFor } from './exe.js';

/**
 * @typedef {{ path: string, size: number, load: () => Promise<Uint8Array>,
 *             read?: (offset:number, length:number) => Promise<Uint8Array> }} WorkspaceFile
 * @typedef {WorkspaceFile & { kind: import('./exe.js').ProgramKind, emulator: 'dos'|'windows' }} Program
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
 * Removes a folder prefix shared by all files, so "Spiel/SPIEL.EXE" becomes
 * "SPIEL.EXE" when everything lives inside "Spiel/".
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

/**
 * Lists runnable programs with their type (DOS / Windows), most likely
 * candidates first: shallow paths before deep ones, installers last.
 * @param {Workspace} ws
 * @returns {Promise<Program[]>}
 */
export async function findPrograms(ws) {
  const unlikely = /(^|\/)(unins\w*|uninst\w*|setup|install\w*|config\w*|readme)\.(exe|com|bat)$/i;
  const candidates = ws.files.filter((f) => RUNNABLE.test(f.path));

  const programs = await Promise.all(candidates.map(async (f) => {
    let read = f.read;
    if (!read) { // e.g. ZIP entries: decompress once
      let bytes;
      read = async (offset, length) => (bytes ??= await f.load()).subarray(offset, offset + length);
    }
    let kind;
    try { kind = await detectKind(f.path, read); } catch { kind = 'unknown'; }
    return { ...f, kind };
  }));
  const kinds = programs.map((p) => p.kind);
  for (const p of programs) p.emulator = emulatorFor(p.kind, kinds);

  const rank = (p) => (/\.exe$/i.test(p.path) ? 0 : /\.com$/i.test(p.path) ? 1 : 2);
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
