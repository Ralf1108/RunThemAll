#!/usr/bin/env node
// Builds Boxedwine for the web from its source (a fixed commit of the master branch), because
// netplay needs Boxedwine's newer browser networking, which is not in a release yet.
//
//   node scripts/build-boxedwine.mjs   -> vendor/boxedwine-build/boxedwine-<commit>-runthemall.<n>-web.zip
//                                         (st/ and mt/ boxedwine.js + .wasm, RunThemAll-changes.txt)
//
// On Linux it needs the Emscripten SDK in the version below (emcc on the PATH, e.g. after
// `source emsdk_env.sh`), make, python3 and tar, and runs Boxedwine's own makefile
// (project/emscripten, targets release and multiThreaded). On Windows and macOS it runs itself in
// the Docker image emscripten/emsdk:<version> (Docker Desktop or Rancher Desktop must run); the
// object files stay in the Docker volume runthemall-boxedwine, so a second run is faster.
// The GitHub workflow .github/workflows/boxedwine.yml runs this and publishes the zip as a
// release asset; scripts/fetch-runtimes.mjs then takes the JS and WASM files from there.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from '../site/js/zip.js';

/** The Boxedwine commit that is built (master, 24.11.2026: "Release Wine 11 filesystems v48 ..."). */
export const BOXEDWINE_COMMIT = '0fa70a84992fb5bf638f05eaf889e0b465282d90';
export const BOXEDWINE_VERSION = `master ${BOXEDWINE_COMMIT.slice(0, 8)}`;
/** Required by Boxedwine's makefile at this commit (tools/jenkins/emscripten-unit-test-env.sh). */
export const EMSCRIPTEN_VERSION = '5.0.7';
/** Raise when PATCHES or the build settings change: it is part of the release name. */
export const BUILD_NUMBER = 1;
export const BUILD_NAME = `boxedwine-${BOXEDWINE_COMMIT.slice(0, 8)}-runthemall.${BUILD_NUMBER}`;
export const BUILD_ASSET = `${BUILD_NAME}-web.zip`;
export const SOURCE_URL = `https://github.com/danoon2/Boxedwine/archive/${BOXEDWINE_COMMIT}.tar.gz`;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'vendor', 'boxedwine-build');
const WORK = process.env.BOXEDWINE_WORK ?? OUT; // the Docker run keeps sources and objects in a volume
const SRC = join(WORK, `Boxedwine-${BOXEDWINE_COMMIT}`);

/**
 * RunThemAll's changes to the C++ code (GPL 2.0: listed in RunThemAll-changes.txt).
 * None at the moment: the web build of this commit already has everything netplay needs.
 * Each entry: { file, why, from, to } (from must occur once).
 */
export const PATCHES = [];

const TARGETS = { st: 'Release', mt: 'MultiThreaded' }; // our name -> Build/<dir> of the makefile target
const MAKE_TARGETS = { st: 'release', mt: 'multiThreaded' };

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.error) throw new Error(`${cmd}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed (${r.status})`);
}

function checkEmscripten() {
  const r = spawnSync('emcc', ['--version'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('emcc not found: activate the Emscripten SDK first (source emsdk_env.sh).');
  const version = /\) (\d+\.\d+\.\d+)/.exec(r.stdout)?.[1];
  if (version !== EMSCRIPTEN_VERSION) {
    throw new Error(`Emscripten ${version} is active, ${EMSCRIPTEN_VERSION} is needed: emsdk install ${EMSCRIPTEN_VERSION} && emsdk activate ${EMSCRIPTEN_VERSION}`);
  }
}

async function prepareSource() {
  const marker = join(SRC, '.runthemall-patched');
  const wanted = JSON.stringify(PATCHES);
  if (existsSync(marker) && (await readFile(marker, 'utf8')) === wanted) return;
  const tgz = join(WORK, `Boxedwine-${BOXEDWINE_COMMIT}.tar.gz`);
  if (!existsSync(tgz)) {
    console.log(`downloading ${SOURCE_URL}`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    await mkdir(WORK, { recursive: true });
    await writeFile(tgz, new Uint8Array(await res.arrayBuffer()));
  }
  await rm(SRC, { recursive: true, force: true });
  sh('tar', ['-xzf', tgz, '-C', WORK]);
  for (const p of PATCHES) {
    const file = join(SRC, p.file);
    const text = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
    const count = text.split(p.from).length - 1;
    if (count !== 1) throw new Error(`patch "${p.why}": expected the original text once in ${p.file}, found ${count}`);
    await writeFile(file, text.replace(p.from, () => p.to));
  }
  await writeFile(marker, wanted);
}

/** Linux: the makefile of Boxedwine. */
async function buildHere() {
  checkEmscripten();
  await prepareSource();
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
  const files = [];
  for (const [name, dir] of Object.entries(TARGETS)) {
    if (only && only !== name) continue;
    console.log(`make ${MAKE_TARGETS[name]}`);
    sh('make', [MAKE_TARGETS[name]], { cwd: join(SRC, 'project', 'emscripten') });
    for (const f of ['boxedwine.js', 'boxedwine.wasm']) {
      files.push({ name: `${name}/${f}`, data: new Uint8Array(await readFile(join(SRC, 'project', 'emscripten', 'Build', dir, f))) });
    }
  }
  files.push({ name: 'RunThemAll-changes.txt', data: new TextEncoder().encode(changesText()) });
  const zip = createZip(files);
  const bytes = new Uint8Array(zip instanceof Blob ? await zip.arrayBuffer() : zip);
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, BUILD_ASSET), bytes);
  console.log(`done: ${join(OUT, BUILD_ASSET)}`);
}

/** Windows and macOS: the same script in the Emscripten Docker image. */
function buildInDocker() {
  const image = `emscripten/emsdk:${EMSCRIPTEN_VERSION}`;
  console.log(`running the build in Docker (${image})`);
  const args = process.argv.slice(2).filter((a) => a !== '--docker');
  sh('docker', ['run', '--rm',
    '-v', `${ROOT}:/repo`, '-v', 'runthemall-boxedwine:/work', '-e', 'BOXEDWINE_WORK=/work', '-w', '/repo',
    image, 'node', 'scripts/build-boxedwine.mjs', ...args]);
}

/** The changes in readable form (also written next to the source archive by the fetch script). */
export function changesText() {
  const changes = PATCHES.length
    ? `with these changes to the C++ code:\n\n${PATCHES.map((p) => `* ${p.file}: ${p.why}\n--- original\n${p.from}+++ changed\n${p.to}`).join('\n')}`
    : 'without changes to the source code.';
  return `Boxedwine ${BOXEDWINE_VERSION}, built by RunThemAll (${BUILD_NAME}) from
${SOURCE_URL}
${changes}

Build: Emscripten ${EMSCRIPTEN_VERSION}, Boxedwine's project/emscripten/makefile, targets release (st/)
and multiThreaded (mt/); see scripts/build-boxedwine.mjs in https://github.com/Ralf1108/RunThemAll.
scripts/fetch-runtimes.mjs changes boxedwine.js afterwards (see README-boxedwine.txt).
`;
}

async function main() {
  if (process.platform === 'linux' && !process.argv.includes('--docker')) await buildHere();
  else buildInDocker();
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
