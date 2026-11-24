#!/usr/bin/env node
// Downloads the Boxedwine web release and places the runtime files into
// site/boxedwine/. Also stores the GPL license and the matching source archive
// next to the binaries, plus the coi-serviceworker helper (MIT).
//
// Usage: node scripts/fetch-boxedwine.mjs [--force]

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listZip, readZipEntry } from '../site/js/zip.js';

export const BOXEDWINE_TAG = '26R1.0';
const RELEASE_ZIP = 'Boxedwine26R1Web.zip';
const RELEASE_URL = `https://github.com/danoon2/Boxedwine/releases/download/${BOXEDWINE_TAG}/${RELEASE_ZIP}`;
const LICENSE_URL = `https://raw.githubusercontent.com/danoon2/Boxedwine/${BOXEDWINE_TAG}/license.txt`;
const SOURCE_URL = `https://github.com/danoon2/Boxedwine/archive/refs/tags/${BOXEDWINE_TAG}.tar.gz`;
const COI_COMMIT = '7b1d2a092d0d2dd2b7270b6f12f13605de26f214'; // coi-serviceworker v0.1.7
const COI_URL = `https://raw.githubusercontent.com/gzuidhof/coi-serviceworker/${COI_COMMIT}/coi-serviceworker.js`;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = join(ROOT, 'vendor');
const SITE = join(ROOT, 'site');
const OUT = join(SITE, 'boxedwine');

// Release entry -> target path below site/boxedwine/
const FILE_MAP = {
  'SingleThreaded/boxedwine.js': 'st/boxedwine.js',
  'SingleThreaded/boxedwine.wasm': 'st/boxedwine.wasm',
  'MultiThreaded/boxedwine.js': 'mt/boxedwine.js',
  'MultiThreaded/boxedwine.wasm': 'mt/boxedwine.wasm',
  'SingleThreaded/boxedwine.zip': 'wine6/boxedwine.zip',
  'Wine11/boxedwine.zip': 'wine11/boxedwine.zip',
  'readme.txt': 'README-boxedwine.txt',
};

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

async function main() {
  console.log(`Boxedwine ${BOXEDWINE_TAG}`);
  const releasePath = join(VENDOR, RELEASE_ZIP);
  await download(RELEASE_URL, releasePath);

  console.log('Entpacke Laufzeitdateien ...');
  const archive = new Uint8Array(await readFile(releasePath));
  const entries = new Map(listZip(archive).map((e) => [e.name, e]));
  for (const [from, to] of Object.entries(FILE_MAP)) {
    const entry = entries.get(from);
    if (!entry) throw new Error(`Im Release fehlt: ${from}`);
    const target = join(OUT, to);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readZipEntry(archive, entry));
    console.log(`  ${to}`);
  }

  console.log('GPL-Lizenz und Quellcode ...');
  await download(LICENSE_URL, join(OUT, 'LICENSE-GPL-2.0.txt'));
  await download(SOURCE_URL, join(OUT, 'source', `Boxedwine-${BOXEDWINE_TAG}-source.tar.gz`));

  console.log('coi-serviceworker ...');
  await download(COI_URL, join(SITE, 'coi-serviceworker.js'));

  await writeFile(
    join(OUT, 'version.json'),
    JSON.stringify({ tag: BOXEDWINE_TAG, source: SOURCE_URL }, null, 2) + '\n',
  );
  console.log('Fertig.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
