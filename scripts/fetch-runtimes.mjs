#!/usr/bin/env node
// Downloads the emulator runtimes into site/:
//   site/boxedwine/    Boxedwine web release (Windows programs)
//   site/jsdos/        js-dos player + DOSBox backend (DOS programs)
//   site/emulatorjs/   EmulatorJS + libretro cores (consoles, home computers)
//   site/v86/          v86 x86 PC emulator + SeaBIOS (complete operating systems)
// Each folder also gets the GPL license text and the matching source archives.
// Additionally fetches the coi-serviceworker helper (MIT).
//
// Usage: node scripts/fetch-runtimes.mjs [--force]

import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { constants as zlibConstants, gunzipSync, zstdCompressSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip, listZip, readZipEntry, readZipEntryRaw } from '../site/js/zip.js';
import { CORES, SYSTEMS } from '../site/js/systems.js';

// --- Boxedwine -------------------------------------------------------------
const BOXEDWINE_TAG = '26R1.0';
const BOXEDWINE_ASSET = 'Boxedwine26R1Web.zip';
const BOXEDWINE_RELEASE = `https://github.com/danoon2/Boxedwine/releases/download/${BOXEDWINE_TAG}/${BOXEDWINE_ASSET}`;
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
// Further Wine modules missing in the web file system that demos need
// (OpenTTD imports winhttp.dll).
const EXTRA_MODULES = ['winhttp.dll.so', 'jsproxy.dll.so'].map((m) => `opt/wine/lib/wine/${m}`);

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

// --- EmulatorJS ------------------------------------------------------------
// Always the newest stable release: the npm dist-tag "latest" of
// @emulatorjs/emulatorjs (pre-releases are not tagged "latest"). The cores are
// published as one npm package per core with the same version number.
const EJS_REGISTRY = 'https://registry.npmjs.org/@emulatorjs%2f';
// Order of the scripts in data/loader.js; concatenated to emulator.min.js
// because the npm package ships only the unminified sources.
const EJS_SCRIPTS = ['emulator.js', 'nipplejs.js', 'shaders.js', 'storage.js', 'gamepad.js',
  'GameManager.js', 'socket.io.min.js', 'compression.js'];

// --- v86 ---------------------------------------------------------------------
// x86 PC emulator (BSD-2-Clause) from npm; the BIOS images (SeaBIOS, LGPL-3.0)
// come from the bios/ folder of the same v86 commit.
const V86_VERSION = '0.5.476';
const V86_COMMIT = '9457e7a2f6890f3133bb6ac0f749e588f63c4c36';
const V86_TARBALL = `https://registry.npmjs.org/v86/-/v86-${V86_VERSION}.tgz`;
const V86_FILES = {
  'package/build/libv86.mjs': 'libv86.mjs',
  'package/build/v86.wasm': 'v86.wasm',
  'package/LICENSE': 'LICENSE-BSD-2-Clause.txt',
};
const SEABIOS_VERSION = '1.16.2';

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
    console.log(`  present: ${target}`);
    return;
  }
  console.log(`  downloading ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
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
  const release = join(VENDOR, BOXEDWINE_ASSET);
  await download(BOXEDWINE_RELEASE, release);

  const archive = new Uint8Array(await readFile(release));
  const entries = new Map(listZip(archive).map((e) => [e.name, e]));
  for (const [from, to] of Object.entries(BOXEDWINE_FILES)) {
    const entry = entries.get(from);
    if (!entry) throw new Error(`Missing in the Boxedwine release: ${from}`);
    let data = await readZipEntry(archive, entry);
    if (to.endsWith('boxedwine.js')) data = patchBoxedwineJs(data, to);
    if (to === 'README-boxedwine.txt') data = new TextEncoder().encode(new TextDecoder().decode(data) + BOXEDWINE_CHANGE_NOTE);
    await writeOut(join(out, to), data);
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

// Changes to Boxedwine (GPL 2.0, section 2a: changed files carry a notice). 1. SDL takes the
// device screen (emscripten_get_screen_size) as the display and switches to fullscreen when the Windows screen is larger,
// which on phones is nearly always the case: the first touch then asks the browser for fullscreen
// of the canvas, and the picture stays black if the browser refuses. Reporting a screen size of at
// least 4096 x 4096 keeps Boxedwine in the page; js/fit.js scales the picture as for every emulator.
// 2. Netplay: two hooks that let the page put sockets on a virtual LAN (see js/wine-net.js).
const BOXEDWINE_CHANGE_DATE = '2026-11-26';
const BOXEDWINE_PATCHES = [
  ['HEAP32[((width)>>2)] = screen.width;', 'HEAP32[((width)>>2)] = Math.max(screen.width, 4096);'],
  ['HEAP32[((height)>>2)] = screen.height;', 'HEAP32[((height)>>2)] = Math.max(screen.height, 4096);'],
  // Netplay (js/wine-net.js): in a room the sockets use a virtual LAN over the relay instead of
  // Emscripten's WebSocket sockets.
  ['sock_ops: SOCKFS.websocket_sock_ops',
    'sock_ops: globalThis.runThemAllNet?.sockOps(SOCKFS, FS) || SOCKFS.websocket_sock_ops'],
  // The own hostname resolves to the address in the room. Worker threads have no runThemAllNet;
  // they get the address from their script URL (?vnet=..., set by js/emulator.js).
  ['  lookup_name(name) {',
    '  lookup_name(name) {\n'
    + '        var vnet = globalThis.runThemAllNet ? globalThis.runThemAllNet.lookupName(name)\n'
    + "          : name == 'emscripten' && typeof location == 'object' && (/[?&]vnet=([0-9.]+)/.exec(location.search) || [])[1];\n"
    + '        if (vnet) return vnet;'],
];
const BOXEDWINE_CHANGE_NOTE = `

Changes by RunThemAll (${BOXEDWINE_CHANGE_DATE})
------------------------------------
st/boxedwine.js and mt/boxedwine.js are changed in three places:
- The screen size reported to SDL is at least 4096 x 4096, so that Boxedwine does not switch to
  fullscreen on small screens (phones).
- SOCKFS.createSocket takes the socket operations from window.runThemAllNet when the page set it
  (netplay: a virtual LAN between the players over a relay server), otherwise the original ones.
- DNS.lookup_name asks window.runThemAllNet first (in worker threads: the vnet parameter of the
  script URL), so the own hostname resolves to the address in the virtual LAN.
The changes are made by scripts/fetch-runtimes.mjs in https://github.com/Ralf1108/RunThemAll; the
unchanged Boxedwine source is in source/.
`;

function patchBoxedwineJs(data, name) {
  let text = new TextDecoder().decode(data);
  for (const [from, to] of BOXEDWINE_PATCHES) {
    const count = text.split(from).length - 1;
    if (count !== 1) throw new Error(`Boxedwine patch: expected "${from}" once in ${name}, found ${count} times`);
    text = text.replace(from, to);
  }
  const notice = `// Modified by RunThemAll on ${BOXEDWINE_CHANGE_DATE}: the screen size reported to SDL is at least\n`
    + '// 4096 x 4096 (no fullscreen on small screens), and sockets and the own hostname can use a\n'
    + '// virtual LAN of the page (window.runThemAllNet, netplay). See README-boxedwine.txt. License: GPL 2.0.\n';
  return new TextEncoder().encode(notice + text);
}

async function buildWin16Overlay(webRootEntry, releaseArchive, target) {
  console.log('Wine 6: adding 16-bit modules ...');
  const fullPath = join(VENDOR, 'TinyCore15Wine6.0.zip');
  await download(WINE6_FULL_FS, fullPath); // ~140 MB, slow server

  const webRoot = await readZipEntry(releaseArchive, webRootEntry);
  const present = new Set(listZip(webRoot).map((e) => e.name));
  const full = new Uint8Array(await readFile(fullPath));
  const missing = listZip(full)
    .filter((e) => (WIN16_MODULE.test(e.name) || EXTRA_MODULES.includes(e.name)) && !present.has(e.name));
  if (missing.length === 0) throw new Error('No missing 16-bit modules found – did the file system change?');

  // Copy the entries still compressed, exactly as in the full file system.
  const files = missing.map((e) => ({ name: e.name, raw: readZipEntryRaw(full, e) }));
  const zip = new Uint8Array(await createZip(files).arrayBuffer());
  await writeOut(target, zip);
  console.log(`  wine6/win16-extras.zip (${files.length} modules, ${(zip.length / 1024).toFixed(0)} KB)`);
}

async function fetchJsDos() {
  console.log(`js-dos ${JSDOS_VERSION}`);
  const out = join(SITE, 'jsdos');
  const tarball = join(VENDOR, `js-dos-${JSDOS_VERSION}.tgz`);
  await download(JSDOS_TARBALL, tarball);

  const files = readTar(gunzipSync(await readFile(tarball)));
  for (const [from, to] of Object.entries(JSDOS_FILES)) {
    const data = files.get(from);
    if (!data) throw new Error(`Missing in the js-dos package: ${from}`);
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

async function fetchV86() {
  console.log(`v86 ${V86_VERSION}`);
  const out = join(SITE, 'v86');
  const tarball = join(VENDOR, `v86-${V86_VERSION}.tgz`);
  await download(V86_TARBALL, tarball);
  const files = readTar(gunzipSync(await readFile(tarball)));
  for (const [from, to] of Object.entries(V86_FILES)) {
    const data = files.get(from);
    if (!data) throw new Error(`Missing in the v86 package: ${from}`);
    await writeOut(join(out, to), data);
    console.log(`  ${to}`);
  }
  const raw = `https://raw.githubusercontent.com/copy/v86/${V86_COMMIT}/bios/`;
  for (const name of ['seabios.bin', 'vgabios.bin', 'COPYING.LESSER']) {
    const target = join(VENDOR, 'v86', name);
    await download(raw + name, target);
    await writeOut(join(out, 'bios', name === 'COPYING.LESSER' ? 'LICENSE-LGPL-3.0.txt' : name), await readFile(target));
  }
  const sources = {
    [`v86-${V86_COMMIT.slice(0, 7)}-source.tar.gz`]: `https://github.com/copy/v86/archive/${V86_COMMIT}.tar.gz`,
    [`seabios-${SEABIOS_VERSION}-source.tar.gz`]:
      `https://github.com/coreboot/seabios/archive/refs/tags/rel-${SEABIOS_VERSION}.tar.gz`,
  };
  for (const [name, url] of Object.entries(sources)) await download(url, join(out, 'source', name));
  await writeOut(join(out, 'version.json'), JSON.stringify({
    v86: V86_VERSION,
    commit: V86_COMMIT,
    seabios: SEABIOS_VERSION,
    sources: Object.keys(sources).map((n) => `source/${n}`),
  }, null, 2) + '\n');
}

async function npmPackage(name, version = 'latest') {
  const res = await fetch(`${EJS_REGISTRY}${name}/${version}`);
  if (!res.ok) throw new Error(`npm: @emulatorjs/${name}@${version} not found (${res.status})`);
  return res.json();
}

async function npmFiles(meta) {
  const tarball = join(VENDOR, 'emulatorjs', `${meta.name.split('/')[1]}-${meta.version}.tgz`);
  await download(meta.dist.tarball, tarball);
  return readTar(gunzipSync(await readFile(tarball)));
}

async function fetchEmulatorJs() {
  const loader = await npmPackage('emulatorjs');
  const version = loader.version;
  console.log(`EmulatorJS ${version} (newest stable version)`);
  const out = join(SITE, 'emulatorjs');
  const data = join(out, 'data');

  const files = await npmFiles(loader);
  for (const [name, content] of files) {
    if (!name.startsWith('package/data/') || name.startsWith('package/data/cores/')) continue;
    await writeOut(join(data, name.slice('package/data/'.length)), content);
  }
  const scripts = EJS_SCRIPTS.map((f) => {
    const content = files.get(`package/data/src/${f}`);
    if (!content) throw new Error(`Missing in the EmulatorJS package: data/src/${f}`);
    return new TextDecoder().decode(content);
  });
  await writeOut(join(data, 'emulator.min.js'), scripts.join(';\n'));
  await writeOut(join(data, 'emulator.min.css'), files.get('package/data/emulator.css'));
  await writeOut(join(out, 'LICENSE-GPL-3.0.txt'), files.get('package/LICENSE'));

  const cores = [];
  for (const core of CORES) {
    const meta = await npmPackage(`core-${core}`, version).catch(() => npmPackage(`core-${core}`));
    const coreFiles = await npmFiles(meta);
    let count = 0;
    for (const [name, content] of coreFiles) {
      if (name.endsWith('.data')) {
        await writeOut(join(data, 'cores', name.slice('package/'.length)), content);
        count++;
      } else if (name.startsWith('package/reports/')) {
        await writeOut(join(data, 'cores', 'reports', name.slice('package/reports/'.length)), content);
      }
    }
    if (count === 0) throw new Error(`Core ${core}: no .data files found`);
    const repo = (meta.repository?.url || '').replace(/^git\+/, '').replace(/\.git$/, '');
    cores.push({ core, version: meta.version, repo, license: meta.license || '' });
    console.log(`  core ${core} ${meta.version}`);
  }

  const source = `https://github.com/EmulatorJS/EmulatorJS/archive/refs/tags/v${version}.tar.gz`;
  await download(source, join(out, 'source', `EmulatorJS-${version}-source.tar.gz`));
  await writeOut(join(out, 'version.json'), JSON.stringify({ version, source, cores }, null, 2) + '\n');
  await writeOut(join(out, 'cores.html'), coresPage(version, source, cores));
}

/** Credits page listing every libretro core with its source repository. */
function coresPage(version, source, cores) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const systemsOf = (core) => SYSTEMS.filter((s) => s.core === core).map((s) => s.label).join(', ');
  const rows = cores.map((c) => `<tr><td>${esc(systemsOf(c.core))}</td><td><code>${esc(c.core)}</code></td>`
    + `<td>${esc(c.version)}</td><td><a href="${esc(c.repo)}">${esc(c.repo.replace('https://github.com/', ''))}</a></td>`
    + `<td>${esc(c.license)}</td></tr>`).join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>RunThemAll – EmulatorJS cores</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font:15px/1.5 system-ui,sans-serif;margin:2rem auto;max-width:1000px;padding:0 1rem}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ccc;padding:.35rem .5rem;text-align:left}
code{font-size:.9em}</style></head><body>
<h1>Console and home computer emulation</h1>
<p>RunThemAll uses <a href="https://emulatorjs.org">EmulatorJS</a> ${esc(version)}
(<a href="https://github.com/EmulatorJS/EmulatorJS">GitHub</a>, GPL-3.0,
<a href="LICENSE-GPL-3.0.txt">licence</a>, <a href="source/EmulatorJS-${esc(version)}-source.tar.gz">source</a>)
with the following libretro cores. They are taken unchanged from the npm packages <code>@emulatorjs/core-*</code>.
Every core file contains its own licence text; the source code is in the linked repositories.
Some cores (e.g. Snes9x, Genesis Plus GX, PicoDrive, FBNeo, MAME 2003-Plus) do not allow commercial use.</p>
<table><thead><tr><th>System</th><th>Core</th><th>Version</th><th>Source</th><th>Licence file</th></tr></thead>
<tbody>
${rows}
</tbody></table>
<p><a href="../">Back to RunThemAll</a></p>
</body></html>
`;
}

async function fetchCoi() {
  console.log('coi-serviceworker');
  await download(
    `https://raw.githubusercontent.com/gzuidhof/coi-serviceworker/${COI_COMMIT}/coi-serviceworker.js`,
    join(SITE, 'coi-serviceworker.js'),
  );
}

/**
 * Demo programs (demos/demos.json): downloaded from their original release,
 * optionally one entry taken out of a ZIP, and placed in site/demos/. Entries
 * with `local` are copied from demos/local/ instead (built from source by us).
 */
/**
 * Repacks a demo ZIP: removes a leading folder (`strip`) and adds files from
 * other downloads (`add`: [{ url, entry, path }], e.g. OpenGFX for OpenTTD).
 * Entries are copied still compressed.
 */
async function bundleDemo(demo, data) {
  const files = listZip(data)
    .filter((e) => !e.isDir)
    .map((e) => ({ name: demo.strip && e.name.startsWith(demo.strip) ? e.name.slice(demo.strip.length) : e.name,
      raw: readZipEntryRaw(data, e) }));
  for (const extra of demo.add ?? []) {
    const cached = join(VENDOR, 'demos', demo.id, decodeURIComponent(extra.url.split('/').pop()));
    await download(extra.url, cached);
    const archive = new Uint8Array(await readFile(cached));
    const entry = listZip(archive).find((e) => e.name === extra.entry);
    if (!entry) throw new Error(`Demo ${demo.id}: ${extra.entry} not in ${extra.url}`);
    files.push({ name: extra.path, raw: readZipEntryRaw(archive, entry) });
  }
  return new Uint8Array(await createZip(files).arrayBuffer());
}

/**
 * Splits a disk image into fixed-size parts named the way v86 requests them
 * with `use_parts` (`name-<start>-<end>.iso.zst`) and compresses each with zstd,
 * which v86 decompresses itself. GitHub Pages allows at most 100 MB per file,
 * and the browser only downloads the parts the guest system reads.
 */
async function writeImageParts(target, data, chunk) {
  const match = target.match(/\.[^./]+$/);
  const ext = match ? match[0] : '';
  const base = target.slice(0, target.length - ext.length);
  let bytes = 0;
  let count = 0;
  for (let start = 0; start < data.length; start += chunk) {
    const part = new Uint8Array(chunk); // last part padded with zeros (v86 expects full chunks)
    part.set(data.subarray(start, Math.min(start + chunk, data.length)));
    const packed = zstdCompressSync(part, { params: { [zlibConstants.ZSTD_c_compressionLevel]: 19 } });
    await writeOut(`${base}-${start}-${start + chunk}${ext}.zst`, packed);
    bytes += packed.length;
    count++;
  }
  return { count, bytes };
}

async function fetchDemos() {
  console.log('Demos');
  const list = JSON.parse(await readFile(join(ROOT, 'demos', 'demos.json'), 'utf8'));
  const published = [];
  for (const demo of list) {
    if (demo.local) {
      // Built by us from source (see demos/local/README.md), stored in the repository.
      await writeOut(join(SITE, 'demos', demo.file), new Uint8Array(await readFile(join(ROOT, 'demos', demo.local))));
      const { local, ...rest } = demo;
      published.push(rest);
      console.log(`  ${demo.file} (${demo.title}, from demos/local)`);
      continue;
    }
    const cached = join(VENDOR, 'demos', demo.id, decodeURIComponent(demo.url.split('/').pop()));
    // Reuse the Boxedwine release that is already cached.
    const source = demo.url === BOXEDWINE_RELEASE ? join(VENDOR, BOXEDWINE_ASSET) : cached;
    await download(demo.url, source);
    let data = new Uint8Array(await readFile(source));
    if (demo.strip || demo.add) data = await bundleDemo(demo, data);
    if (demo.entry) {
      const entry = listZip(data).find((e) => e.name === demo.entry);
      if (!entry) throw new Error(`Demo ${demo.id}: ${demo.entry} not in the archive`);
      data = await readZipEntry(data, entry);
    }
    const { url, entry, strip, add, chunk, ...rest } = demo;
    if (chunk) {
      // Large disk images: zstd-compressed parts that v86 loads on demand.
      const parts = await writeImageParts(join(SITE, 'demos', demo.file), data, chunk);
      published.push({ ...rest, source: url, image: { size: data.length, chunk } });
      console.log(`  ${demo.file} (${demo.title}, ${parts.count} parts, ${(parts.bytes / 1048576).toFixed(0)} MB compressed)`);
      continue;
    }
    await writeOut(join(SITE, 'demos', demo.file), data);
    published.push({ ...rest, source: url });
    console.log(`  ${demo.file} (${demo.title})`);
  }
  await writeOut(join(SITE, 'demos', 'demos.json'), JSON.stringify(published, null, 2) + '\n');
}

async function main() {
  await fetchBoxedwine();
  await fetchJsDos();
  await fetchEmulatorJs();
  await fetchV86();
  await fetchDemos();
  await fetchCoi();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
