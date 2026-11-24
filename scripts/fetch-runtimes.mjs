#!/usr/bin/env node
// Downloads the emulator runtimes into site/:
//   site/boxedwine/  Boxedwine web release (Windows programs)
//   site/jsdos/      js-dos player + DOSBox backend (DOS programs)
// Each folder also gets the GPL license text and the matching source archives.
// Additionally fetches the coi-serviceworker helper (MIT).
//
// Usage: node scripts/fetch-runtimes.mjs [--force]

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip, listZip, readZipEntry } from '../site/js/zip.js';

// --- Boxedwine -------------------------------------------------------------
const BOXEDWINE_TAG = '26R1.0';
const BOXEDWINE_RELEASE = `https://github.com/danoon2/Boxedwine/releases/download/${BOXEDWINE_TAG}/Boxedwine26R1Web.zip`;
const BOXEDWINE_FILES = {
  'SingleThreaded/boxedwine.js': 'st/boxedwine.js',
  'SingleThreaded/boxedwine.wasm': 'st/boxedwine.wasm',
  'MultiThreaded/boxedwine.js': 'mt/boxedwine.js',
  'MultiThreaded/boxedwine.wasm': 'mt/boxedwine.wasm',
  'SingleThreaded/boxedwine.zip': 'wine6/boxedwine.zip',
  'Wine11/boxedwine.zip': 'wine11/boxedwine.zip',
  'readme.txt': 'README-boxedwine.txt',
};
// The Wine 6 file system in the web release is stripped down and lacks most
// 16-bit Windows modules (e.g. WinG, toolhelp, lzexpand, ole2). They are taken
// from the full Boxedwine Wine 6.0 file system (identical build) and shipped as
// an overlay zip that Boxedwine mounts on top of the root file system.
const WINE6_FULL_FS = 'http://boxedwine.org/v2/2/TinyCore15Wine6.0.zip';
const WIN16_MODULE = /^opt\/wine\/lib\/wine\/[^/]+16\.so$/;

// --- js-dos ----------------------------------------------------------------
// js-dos 8.5.4 bundles emulators 8.5.3, which builds DOSBox from js-dos/dosbox.
const JSDOS_VERSION = '8.5.4';
const EMULATORS_VERSION = '8.5.3';
const DOSBOX_COMMIT = '528578d5a6f76afd4d5ef4e722b5670826f1183a';
const JSDOS_TARBALL = `https://registry.npmjs.org/js-dos/-/js-dos-${JSDOS_VERSION}.tgz`;
const JSDOS_FILES = {
  'package/dist/js-dos.js': 'js-dos.js',
  'package/dist/js-dos.css': 'js-dos.css',
  'package/dist/emulators/emulators.js': 'emulators/emulators.js',
  'package/dist/emulators/wdosbox.js': 'emulators/wdosbox.js',
  'package/dist/emulators/wdosbox.wasm': 'emulators/wdosbox.wasm',
  'package/dist/emulators/wlibzip.js': 'emulators/wlibzip.js',
  'package/dist/emulators/wlibzip.wasm': 'emulators/wlibzip.wasm',
};

// --- coi-serviceworker -----------------------------------------------------
const COI_COMMIT = '7b1d2a092d0d2dd2b7270b6f12f13605de26f214'; // v0.1.7

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor');
const SITE = join(ROOT, 'site');
const force = process.argv.includes('--force');

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function download(url, target) {
  if (!force && await exists(target)) {
    console.log(`  vorhanden: ${target}`);
    return;
  }
  console.log(`  lade ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download fehlgeschlagen (${res.status}): ${url}`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, new Uint8Array(await res.arrayBuffer()));
}

async function writeOut(target, data) {
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, data);
}

/** Minimal reader for (ustar) tar archives: returns Map<name, Uint8Array>. */
function readTar(data) {
  const files = new Map();
  const text = (from, len) => new TextDecoder().decode(data.subarray(from, from + len)).replace(/\0.*$/s, '');
  for (let pos = 0; pos + 512 <= data.length;) {
    const name = text(pos, 100);
    if (!name) break;
    const size = parseInt(text(pos + 124, 12).trim() || '0', 8);
    const type = text(pos + 156, 1);
    const prefix = text(pos + 345, 155);
    const full = prefix ? `${prefix}/${name}` : name;
    if (type === '0' || type === '') files.set(full, data.slice(pos + 512, pos + 512 + size));
    pos += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

async function fetchBoxedwine() {
  console.log(`Boxedwine ${BOXEDWINE_TAG}`);
  const out = join(SITE, 'boxedwine');
  const release = join(VENDOR, 'Boxedwine26R1Web.zip');
  await download(BOXEDWINE_RELEASE, release);

  const archive = new Uint8Array(await readFile(release));
  const entries = new Map(listZip(archive).map((e) => [e.name, e]));
  for (const [from, to] of Object.entries(BOXEDWINE_FILES)) {
    const entry = entries.get(from);
    if (!entry) throw new Error(`Im Boxedwine-Release fehlt: ${from}`);
    await writeOut(join(out, to), await readZipEntry(archive, entry));
    console.log(`  ${to}`);
  }

  await buildWin16Overlay(entries.get('SingleThreaded/boxedwine.zip'), archive, join(out, 'wine6', 'win16-extras.zip'));

  const source = `https://github.com/danoon2/Boxedwine/archive/refs/tags/${BOXEDWINE_TAG}.tar.gz`;
  await download(`https://raw.githubusercontent.com/danoon2/Boxedwine/${BOXEDWINE_TAG}/license.txt`,
    join(out, 'LICENSE-GPL-2.0.txt'));
  await download(source, join(out, 'source', `Boxedwine-${BOXEDWINE_TAG}-source.tar.gz`));
  await writeOut(join(out, 'version.json'),
    JSON.stringify({ tag: BOXEDWINE_TAG, source }, null, 2) + '\n');
}

async function buildWin16Overlay(webRootEntry, releaseArchive, target) {
  console.log('Wine 6: 16-Bit-Module ergänzen ...');
  const fullPath = join(VENDOR, 'TinyCore15Wine6.0.zip');
  await download(WINE6_FULL_FS, fullPath); // ~140 MB, slow server

  const webRoot = await readZipEntry(releaseArchive, webRootEntry);
  const present = new Set(listZip(webRoot).map((e) => e.name));
  const full = new Uint8Array(await readFile(fullPath));
  const missing = listZip(full).filter((e) => WIN16_MODULE.test(e.name) && !present.has(e.name));
  if (missing.length === 0) throw new Error('Keine fehlenden 16-Bit-Module gefunden – Dateisystem geändert?');

  const files = [];
  for (const e of missing) files.push({ name: e.name, data: await readZipEntry(full, e) });
  await writeOut(target, new Uint8Array(await createZip(files).arrayBuffer()));
  console.log(`  wine6/win16-extras.zip (${files.length} Module)`);
}

async function fetchJsDos() {
  console.log(`js-dos ${JSDOS_VERSION}`);
  const out = join(SITE, 'jsdos');
  const tarball = join(VENDOR, `js-dos-${JSDOS_VERSION}.tgz`);
  await download(JSDOS_TARBALL, tarball);

  const files = readTar(gunzipSync(await readFile(tarball)));
  for (const [from, to] of Object.entries(JSDOS_FILES)) {
    const data = files.get(from);
    if (!data) throw new Error(`Im js-dos-Paket fehlt: ${from}`);
    await writeOut(join(out, to), data);
    console.log(`  ${to}`);
  }

  const sources = {
    [`js-dos-${JSDOS_VERSION}-source.tar.gz`]:
      `https://github.com/caiiiycuk/js-dos/archive/refs/tags/v${JSDOS_VERSION}.tar.gz`,
    [`emulators-${EMULATORS_VERSION}-source.tar.gz`]:
      `https://github.com/caiiiycuk/emulators/archive/refs/tags/v${EMULATORS_VERSION}.tar.gz`,
    [`dosbox-${DOSBOX_COMMIT.slice(0, 7)}-source.tar.gz`]:
      `https://github.com/js-dos/dosbox/archive/${DOSBOX_COMMIT}.tar.gz`,
  };
  for (const [name, url] of Object.entries(sources)) await download(url, join(out, 'source', name));
  await download(`https://raw.githubusercontent.com/caiiiycuk/emulators/v${EMULATORS_VERSION}/LICENSE`,
    join(out, 'LICENSE-GPL-2.0.txt'));
  await writeOut(join(out, 'version.json'), JSON.stringify({
    jsdos: JSDOS_VERSION,
    emulators: EMULATORS_VERSION,
    dosbox: DOSBOX_COMMIT,
    sources: Object.keys(sources).map((n) => `source/${n}`),
  }, null, 2) + '\n');
}

async function fetchCoi() {
  console.log('coi-serviceworker');
  await download(
    `https://raw.githubusercontent.com/gzuidhof/coi-serviceworker/${COI_COMMIT}/coi-serviceworker.js`,
    join(SITE, 'coi-serviceworker.js'),
  );
}

async function main() {
  await fetchBoxedwine();
  await fetchJsDos();
  await fetchCoi();
  console.log('Fertig.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
