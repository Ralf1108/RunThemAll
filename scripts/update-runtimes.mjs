#!/usr/bin/env node
// Checks for new versions of the pinned emulator runtimes and updates them.
//
//   Boxedwine   GitHub release (web build)            danoon2/Boxedwine
//   js-dos      npm package js-dos, plus the emulators version it was built
//               with and the DOSBox commit of that emulators release
//   v86         npm package v86, plus its git commit and the SeaBIOS version
//               built in that commit
//
// EmulatorJS is not pinned: fetch-runtimes.mjs always takes the newest stable
// release. Demo downloads (demos/demos.json) are not touched, except the
// SkiFree demo, which comes from the Boxedwine release.
//
// Usage:
//   node scripts/update-runtimes.mjs           show what would change (nothing is written)
//   node scripts/update-runtimes.mjs --apply   write the new versions and download them
//
// After --apply: test the demos (npm run serve), then commit.

import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FETCH_SCRIPT = join(ROOT, 'scripts', 'fetch-runtimes.mjs');
const DEMOS = join(ROOT, 'demos', 'demos.json');
const apply = process.argv.includes('--apply');

async function getJson(url) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'run-them-all-update' };
  if (process.env.GITHUB_TOKEN && url.startsWith('https://api.github.com/')) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/** Reads `const NAME = '...';` from the fetch script. */
function readConst(source, name) {
  const m = source.match(new RegExp(`^const ${name} = '([^']*)';`, 'm'));
  if (!m) throw new Error(`Konstante ${name} nicht in fetch-runtimes.mjs gefunden.`);
  return m[1];
}

function writeConst(source, name, value) {
  return source.replace(new RegExp(`^(const ${name} = ')[^']*(';)`, 'm'), `$1${value}$2`);
}

// --- Latest upstream versions --------------------------------------------

async function latestBoxedwine() {
  const release = await getJson('https://api.github.com/repos/danoon2/Boxedwine/releases/latest');
  const asset = release.assets.find((a) => /Web\.zip$/i.test(a.name));
  if (!asset) throw new Error(`Boxedwine ${release.tag_name}: kein Web-Release (…Web.zip) gefunden.`);
  return { BOXEDWINE_TAG: release.tag_name, BOXEDWINE_ASSET: asset.name };
}

async function latestJsDos() {
  const meta = await getJson('https://registry.npmjs.org/js-dos');
  const version = meta['dist-tags'].latest;
  const pkg = meta.versions[version];
  const emulators = pkg.devDependencies?.emulators ?? pkg.dependencies?.emulators;
  if (!emulators) throw new Error(`js-dos ${version}: Version von emulators nicht gefunden.`);
  const emulatorsVersion = emulators.replace(/^[\^~]/, '');
  // DOSBox is a git submodule of the emulators repository.
  const sub = await getJson(`https://api.github.com/repos/caiiiycuk/emulators/contents/native/dosbox?ref=v${emulatorsVersion}`);
  if (sub.type !== 'submodule') throw new Error(`emulators ${emulatorsVersion}: native/dosbox ist kein Submodul mehr.`);
  return { JSDOS_VERSION: version, EMULATORS_VERSION: emulatorsVersion, DOSBOX_COMMIT: sub.sha };
}

/** package.json from an npm tarball (.tgz). */
async function packageJsonFromTarball(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const tar = gunzipSync(new Uint8Array(await res.arrayBuffer()));
  const text = (from, len) => new TextDecoder().decode(tar.subarray(from, from + len)).replace(/\0.*$/s, '');
  for (let pos = 0; pos + 512 <= tar.length;) {
    const name = text(pos, 100);
    if (!name) break;
    const size = parseInt(text(pos + 124, 12).trim() || '0', 8);
    if (name === 'package/package.json') return JSON.parse(text(pos + 512, size));
    pos += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error(`${url}: package.json fehlt`);
}

async function latestV86() {
  const meta = await getJson('https://registry.npmjs.org/v86/latest');
  const version = meta.version.replace(/\+.*$/, '');
  // Only the package.json inside the tarball carries the commit ("0.5.476+g9457e7a").
  const pkg = await packageJsonFromTarball(meta.dist.tarball);
  const short = (pkg.version.match(/\+g([0-9a-f]+)/) ?? [])[1] || meta.gitHead;
  if (!short) throw new Error(`v86 ${version}: Commit nicht gefunden.`);
  const commit = (await getJson(`https://api.github.com/repos/copy/v86/commits/${short}`)).sha;
  const script = await getText(`https://raw.githubusercontent.com/copy/v86/${commit}/bios/fetch-and-build-seabios.sh`);
  const seabios = (script.match(/git checkout rel-([0-9.]+)/) ?? [])[1];
  if (!seabios) throw new Error(`v86 ${version}: SeaBIOS-Version nicht gefunden.`);
  return { V86_VERSION: version, V86_COMMIT: commit, SEABIOS_VERSION: seabios };
}

// --- Main ------------------------------------------------------------------

async function main() {
  let source = await readFile(FETCH_SCRIPT, 'utf8');
  const components = [
    ['Boxedwine', latestBoxedwine],
    ['js-dos', latestJsDos],
    ['v86', latestV86],
  ];

  const changes = [];
  for (const [label, latest] of components) {
    let wanted;
    try {
      wanted = await latest();
    } catch (err) {
      console.log(`${label}: Prüfung fehlgeschlagen – ${err.message}`);
      continue;
    }
    const diffs = Object.entries(wanted).filter(([name, value]) => readConst(source, name) !== value);
    if (diffs.length === 0) {
      console.log(`${label}: aktuell (${Object.values(wanted)[0]})`);
      continue;
    }
    console.log(`${label}: Update verfügbar`);
    for (const [name, value] of diffs) {
      console.log(`  ${name}: ${readConst(source, name)} → ${value}`);
      changes.push([name, readConst(source, name), value]);
    }
  }
  console.log('EmulatorJS: wird bei jedem Download automatisch in der neuesten stabilen Version geholt.');

  if (changes.length === 0) {
    console.log('\nAlles aktuell.');
    return;
  }
  if (!apply) {
    console.log('\nNichts geändert. Mit --apply übernehmen und herunterladen.');
    return;
  }

  // The SkiFree demo is part of the Boxedwine release: keep its URL in step.
  const oldRelease = `https://github.com/danoon2/Boxedwine/releases/download/${readConst(source, 'BOXEDWINE_TAG')}/${readConst(source, 'BOXEDWINE_ASSET')}`;
  for (const [name, , value] of changes) source = writeConst(source, name, value);
  const newRelease = `https://github.com/danoon2/Boxedwine/releases/download/${readConst(source, 'BOXEDWINE_TAG')}/${readConst(source, 'BOXEDWINE_ASSET')}`;
  await writeFile(FETCH_SCRIPT, source);
  console.log('\nscripts/fetch-runtimes.mjs aktualisiert.');
  if (newRelease !== oldRelease) {
    const demos = await readFile(DEMOS, 'utf8');
    if (demos.includes(oldRelease)) {
      await writeFile(DEMOS, demos.split(oldRelease).join(newRelease));
      console.log('demos/demos.json: Download-Link der SkiFree-Demo auf das neue Boxedwine-Release gesetzt.');
    }
  }

  console.log('\nLade die neuen Versionen herunter …\n');
  const run = spawnSync(process.execPath, [FETCH_SCRIPT, '--force'], { stdio: 'inherit', cwd: ROOT });
  if (run.status !== 0) {
    console.log('\nDer Download ist fehlgeschlagen. Die neue Version hat vermutlich einen anderen Aufbau;');
    console.log('scripts/fetch-runtimes.mjs muss angepasst werden (Änderungen mit git diff ansehen oder zurücknehmen).');
    process.exit(run.status ?? 1);
  }
  console.log('\nFertig. Jetzt die Demos testen (npm run serve) und danach committen.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
