#!/usr/bin/env node
// Builds Boxedwine for the web from its source with RunThemAll's changes (see PATCHES below),
// because netplay needs fixes in Boxedwine's C++ code that are not in a release yet.
//
//   node scripts/build-boxedwine.mjs            -> vendor/boxedwine-build/out/{st,mt}/boxedwine.{js,wasm}
//                                                  and vendor/boxedwine-build/boxedwine-<tag>-runthemall.<n>-web.zip
//
// Needs the Emscripten SDK (emcc/em++ on the PATH, e.g. after `source emsdk_env.sh`) and tar.
// The source archive is the one scripts/fetch-runtimes.mjs downloads (or it is downloaded here).
// Object files are kept, so a second run only compiles what changed.
// The GitHub workflow .github/workflows/boxedwine.yml runs this and publishes the zip as a
// release asset; scripts/fetch-runtimes.mjs then takes the JS and WASM files from there.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createZip } from '../site/js/zip.js';

export const BOXEDWINE_TAG = '26R1.0';
/**
 * The Emscripten version of the official 26R1.0 web build (judged by its JavaScript). Much newer
 * versions (7.x) build, but Boxedwine then crashes at the start (memory written through a null pointer).
 */
export const EMSCRIPTEN_VERSION = '4.0.10';
/** Raise when PATCHES change: it is part of the release name. */
export const BUILD_NUMBER = 1;
export const BUILD_NAME = `boxedwine-${BOXEDWINE_TAG}-runthemall.${BUILD_NUMBER}`;
export const BUILD_ASSET = `${BUILD_NAME}-web.zip`;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORK = join(ROOT, 'vendor', 'boxedwine-build');
const SOURCE_URL = `https://github.com/danoon2/Boxedwine/archive/refs/tags/${BOXEDWINE_TAG}.tar.gz`;
const SOURCE_TGZ = join(ROOT, 'site', 'boxedwine', 'source', `Boxedwine-${BOXEDWINE_TAG}-source.tar.gz`);

// --- RunThemAll's changes (GPL 2.0: described in README-boxedwine.txt) -------------------------
const ACCEPT_FIX = {
  file: 'source/kernel/knativesocket.cpp',
  why: 'accept: the new socket is connected (else poll reports POLLHUP and Wine never writes to it), '
    + 'and the socket the constructor opened is closed instead of leaked',
  from: '        s->nativeSocket = result;\n',
  to: '        closesocket(s->nativeSocket); // RunThemAll: the constructor opened a socket that is not used\n'
    + '        s->nativeSocket = result;\n'
    + '        s->connected = true; // RunThemAll: else isOpen() is false and poll reports POLLHUP\n',
};

const ACCEPT_NULL_ADDRESS = {
  file: 'source/kernel/knativesocket.cpp',
  why: 'accept(fd, NULL, NULL) is allowed: do not read the address when the program passed none '
    + '(Boxedwine stopped with "KMemory::performOnMemory failed to get ram")',
  from: '    KMemory* memory = thread->memory;\n    readSockAddrIn(&addr, memory, address);\n'
    + '    S32 result = (S32)::accept(',
  to: '    KMemory* memory = thread->memory;\n'
    + '    if (address) readSockAddrIn(&addr, memory, address); // RunThemAll: the address may be NULL\n'
    + '    S32 result = (S32)::accept(',
};

// The browser has no network interfaces. Wine asks for them with ioctls; answer them with one
// interface eth0 that has the address of the own hostname (the page's virtual LAN), netmask /24.
const INTERFACES = {
  file: 'source/kernel/knativesocket.cpp',
  why: 'web build: emulated interfaces lo and eth0 (address of the own hostname, /24) for the '
    + 'interface ioctls, so that Wine finds an interface table and broadcast addresses',
  from: 'U32 KNativeSocketObject::ioctl(KThread* thread, U32 request) {\n    CPU* cpu = thread->cpu;\n',
  to: `#ifdef __EMSCRIPTEN__
// RunThemAll: the browser has no network interfaces, report lo and eth0 (address of the own
// hostname, netmask 255.255.255.0). Returns 1 when the request is not an interface request.
U32 ipAddress();
static void rtaWriteAddr(KMemory* memory, U32 address, U32 ip) {
    memory->writew(address, K_AF_INET);
    memory->writew(address + 2, 0);
    memory->writed(address + 4, ip);
    memory->memset(address + 8, 0, 8);
}
static U32 rtaInterfaceIoctl(KThread* thread, U32 request, U32 address, bool& handled) {
    const U32 IFREQ_SIZE = 32; // struct ifreq of a 32 bit Linux
    KMemory* memory = thread->memory;
    U32 ip = ipAddress();
    U32 loopback = 0x0100007f; // 127.0.0.1 in network byte order
    U32 mask = 0x00ffffff; // 255.255.255.0
    handled = true;
    if (request == 0x8912) { // SIOCGIFCONF
        if (!address) return -K_EFAULT;
        U32 len = memory->readd(address);
        U32 buf = memory->readd(address + 4);
        if (!buf) {
            memory->writed(address, 2 * IFREQ_SIZE);
            return 0;
        }
        U32 count = len / IFREQ_SIZE < 2 ? len / IFREQ_SIZE : 2;
        for (U32 i = 0; i < count; i++) {
            memory->memset(buf + i * IFREQ_SIZE, 0, IFREQ_SIZE);
            memory->memcpy(buf + i * IFREQ_SIZE, i == 0 ? "lo" : "eth0", i == 0 ? 3 : 5);
            rtaWriteAddr(memory, buf + i * IFREQ_SIZE + 16, i == 0 ? loopback : ip);
        }
        memory->writed(address, count * IFREQ_SIZE);
        return 0;
    }
    if (!address) {
        handled = false;
        return 0;
    }
    bool lo = memory->readString(address) == "lo";
    switch (request) {
    case 0x8915: // SIOCGIFADDR
        rtaWriteAddr(memory, address + 16, lo ? loopback : ip);
        return 0;
    case 0x8919: // SIOCGIFBRDADDR
        rtaWriteAddr(memory, address + 16, lo ? 0 : (ip | ~mask));
        return 0;
    case 0x891b: // SIOCGIFNETMASK
        rtaWriteAddr(memory, address + 16, lo ? 0x000000ff : mask);
        return 0;
    case 0x8913: // SIOCGIFFLAGS
        memory->writew(address + 16, lo ? 0x49 : 0x1043); // UP|LOOPBACK|RUNNING, UP|BROADCAST|RUNNING|MULTICAST
        return 0;
    case 0x8921: // SIOCGIFMTU
        memory->writed(address + 16, lo ? 65536 : 1500);
        return 0;
    case 0x8927: // SIOCGIFHWADDR: a locally administered MAC from the address
        memory->writew(address + 16, lo ? 772 : 1); // ARPHRD_LOOPBACK, ARPHRD_ETHER
        memory->writeb(address + 18, lo ? 0 : 0x02);
        memory->writeb(address + 19, 0);
        memory->writed(address + 20, lo ? 0 : ip);
        return 0;
    }
    handled = false;
    return 0;
}
#endif
U32 KNativeSocketObject::ioctl(KThread* thread, U32 request) {
    CPU* cpu = thread->cpu;
#ifdef __EMSCRIPTEN__
    {
        bool handled = false;
        U32 result = rtaInterfaceIoctl(thread, request, IOCTL_ARG1, handled);
        if (handled) return result;
    }
#endif
`,
};

// --no-patches builds the unchanged source (to compare).
export const PATCHES = process.argv.includes('--no-patches') ? [] : [ACCEPT_FIX, ACCEPT_NULL_ADDRESS, INTERFACES];

// --- build settings, as in Boxedwine's project/emscripten/makefile ----------------------------
const CPPFLAGS = ['-O3', '-sUSE_SDL=2', '-sUSE_ZLIB=1', '-DBOXEDWINE_ZLIB', '-DSDL2=1', '-DBOXEDWINE_DISABLE_UI',
  '-DSIMDE_SSE2_NO_NATIVE', '-Wno-deprecated-pragma', '-Wno-format-security', '-Wno-unused-private-field',
  '-Wno-invalid-offsetof', '-Wno-delete-incomplete', '-Wno-unused-result', '-Wno-unknown-pragmas',
  '-Wno-unused-local-typedefs', '-Wno-unused-variable', '-Wno-unused-function', '-Wno-unused-but-set-variable'];
const LDFLAGS = ['-sFORCE_FILESYSTEM', '-lidbfs.js', '-sUSE_SDL=2', '-sUSE_ZLIB=1', '-fwasm-exceptions',
  '-sTOTAL_MEMORY=536870912', '-sEXPORTED_RUNTIME_METHODS=["addRunDependency","removeRunDependency","ERRNO_CODES"]'];
const VARIANTS = {
  st: { cpp: [], ld: [] },
  mt: { cpp: ['-DBOXEDWINE_MULTI_THREADED', '-pthread'], ld: ['-pthread', '-sPTHREAD_POOL_SIZE=32'] },
};

/**
 * How to start emcc/em++ without a shell: on Windows the launchers are .bat files (or .exe in newer
 * versions), which Node only starts through cmd.exe; so the Python scripts are run directly.
 * @returns {[string, string[]]} program and first arguments
 */
function exe(name) {
  if (process.platform !== 'win32') return [name, []];
  const dir = join(process.env.EMSDK ?? '', 'upstream', 'emscripten');
  if (existsSync(join(dir, `${name}.exe`))) return [join(dir, `${name}.exe`), []];
  return [process.env.EMSDK_PYTHON ?? 'python', [join(dir, `${name}.py`)]];
}

function run([cmd, first], args) {
  return new Promise((resolveRun, reject) => {
    const p = spawn(cmd, [...first, ...args], { stdio: ['ignore', 'inherit', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => (code === 0 ? resolveRun() : reject(new Error(`${cmd} failed (${code}):\n${err.slice(-4000)}`))));
  });
}

async function walk(dir, filter, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, filter, out);
    else if (filter(p)) out.push(p);
  }
  return out;
}

async function sourceFiles(src) {
  const cpp = (p) => p.endsWith('.cpp');
  const files = [];
  const flat = async (d) => (await readdir(join(src, d), { withFileTypes: true }))
    .filter((e) => e.isFile() && cpp(e.name)).map((e) => join(src, d, e.name));
  for (const d of ['source/sdl', 'source/sdl/emscripten', 'platform/sdl', 'platform/linux', 'source/io',
    'source/kernel', 'source/util', 'source/opengl/sdl', 'source/opengl', 'source/vulkan', 'source/x11']) {
    if (existsSync(join(src, d))) files.push(...await flat(d));
  }
  files.push(...await walk(join(src, 'source/emulation'), cpp));
  // makefile: source/kernel/**/*.cpp (one level of subfolders)
  for (const e of await readdir(join(src, 'source/kernel'), { withFileTypes: true })) {
    if (e.isDirectory()) files.push(...await flat(`source/kernel/${e.name}`));
  }
  for (const f of ['ioapi.c', 'mztools.c', 'unzip.c', 'zip.c']) files.push(join(src, 'lib/zlib/contrib/minizip', f));
  const soft = [
    ...(await readdir(join(src, 'lib/softfloat/source'))).filter((n) => n.endsWith('.c')).map((n) => join(src, 'lib/softfloat/source', n)),
    ...(await readdir(join(src, 'lib/softfloat/source/8086-SSE'))).filter((n) => n.endsWith('.c')).map((n) => join(src, 'lib/softfloat/source/8086-SSE', n)),
  ];
  return { main: [...new Set(files)], soft };
}

async function newer(a, b) {
  try { return (await stat(a)).mtimeMs > (await stat(b)).mtimeMs; } catch { return true; }
}

async function prepareSource() {
  if (!existsSync(SOURCE_TGZ)) {
    console.log(`downloading ${SOURCE_URL}`);
    const res = await fetch(SOURCE_URL);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    await mkdir(dirname(SOURCE_TGZ), { recursive: true });
    await writeFile(SOURCE_TGZ, new Uint8Array(await res.arrayBuffer()));
  }
  const src = join(WORK, `Boxedwine-${BOXEDWINE_TAG}`);
  const marker = join(src, '.runthemall-patched');
  const wanted = JSON.stringify(PATCHES);
  if (existsSync(marker) && (await readFile(marker, 'utf8')) === wanted) return src;
  await rm(src, { recursive: true, force: true });
  await rm(join(WORK, 'obj'), { recursive: true, force: true }); // tar keeps old file times: compile all again
  await mkdir(WORK, { recursive: true });
  // Only what the web build needs (the macOS project has symbolic links that fail on Windows).
  const dirs = ['source', 'include', 'lib', 'platform', 'tools'].map((d) => `Boxedwine-${BOXEDWINE_TAG}/${d}`);
  const r = spawnSync('tar', ['-xzf', SOURCE_TGZ, '-C', WORK, ...dirs], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('tar failed');
  for (const p of PATCHES) {
    const file = join(src, p.file);
    const text = (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
    const count = text.split(p.from).length - 1;
    if (count !== 1) throw new Error(`patch "${p.why}": expected the original text once in ${p.file}, found ${count}`);
    await writeFile(file, text.replace(p.from, () => p.to));
  }
  await writeFile(marker, wanted);
  return src;
}

async function build(src, name, variant) {
  const objDir = join(WORK, 'obj', name);
  const outDir = join(WORK, 'out', name);
  await mkdir(outDir, { recursive: true });
  const { main, soft } = await sourceFiles(src);
  const jobs = [
    // As in the makefile: C files with emcc, C++ files with em++ and -std=c++20.
    ...main.map((f) => (f.endsWith('.c')
      ? { f, cc: exe('emcc'), flags: [...CPPFLAGS, `-I${join(src, 'include')}`, `-I${join(src, 'lib/simde')}`] }
      : { f, cc: exe('em++'), flags: ['-std=c++20', ...CPPFLAGS, `-I${join(src, 'include')}`, `-I${join(src, 'lib/simde')}`] })),
    ...soft.map((f) => ({ f, cc: exe('emcc'), flags: [...CPPFLAGS, `-I${join(src, 'lib/softfloat/source/include')}`, `-I${join(src, 'lib/softfloat/source')}`, `-I${join(src, 'lib/softfloat/source/8086-SSE')}`] })),
  ].map((j) => ({ ...j, obj: join(objDir, relative(src, j.f) + '.o') }));
  let done = 0;
  const todo = [];
  for (const j of jobs) if (await newer(j.f, j.obj)) todo.push(j);
  console.log(`${name}: ${jobs.length} files, ${todo.length} to compile`);
  const queue = [...todo];
  const worker = async () => {
    for (let j = queue.shift(); j; j = queue.shift()) {
      await mkdir(dirname(j.obj), { recursive: true });
      await run(j.cc, [...j.flags, ...variant.cpp, '-c', j.f, '-o', j.obj]);
      if (++done % 50 === 0) console.log(`  ${name}: ${done}/${todo.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, availableParallelism() - 1) }, worker));
  console.log(`${name}: linking`);
  // em++: newer Emscripten links the C++ library only then (the makefile uses emcc).
  await run(exe('em++'), [...jobs.map((j) => j.obj), '-o', join(outDir, 'boxedwine.js'), ...LDFLAGS, ...variant.ld]);
}

function checkEmscripten() {
  const [cmd, first] = exe('emcc');
  const r = spawnSync(cmd, [...first, '--version'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('emcc not found: activate the Emscripten SDK first (emsdk_env).');
  const version = /\) (\d+\.\d+\.\d+)/.exec(r.stdout)?.[1];
  if (version !== EMSCRIPTEN_VERSION) {
    throw new Error(`Emscripten ${version} is active, ${EMSCRIPTEN_VERSION} is needed: emsdk install ${EMSCRIPTEN_VERSION} && emsdk activate ${EMSCRIPTEN_VERSION}`);
  }
}

async function main() {
  checkEmscripten();
  const src = await prepareSource();
  for (const [name, variant] of Object.entries(VARIANTS)) {
    if (process.argv.includes(`--only=${name === 'st' ? 'mt' : 'st'}`)) continue;
    await build(src, name, variant);
  }
  const files = [];
  for (const name of Object.keys(VARIANTS)) {
    for (const f of ['boxedwine.js', 'boxedwine.wasm']) {
      const p = join(WORK, 'out', name, f);
      if (existsSync(p)) files.push({ name: `${name}/${f}`, data: new Uint8Array(await readFile(p)) });
    }
  }
  files.push({ name: 'RunThemAll-changes.txt', data: new TextEncoder().encode(changesText()) });
  const zip = createZip(files);
  const bytes = new Uint8Array(zip instanceof Blob ? await zip.arrayBuffer() : zip);
  await writeFile(join(WORK, BUILD_ASSET), bytes);
  console.log(`done: ${join(WORK, BUILD_ASSET)}`);
}

/** The changes in readable form (also written next to the source archive by the fetch script). */
export function changesText() {
  return `Boxedwine ${BOXEDWINE_TAG}, built by RunThemAll (${BUILD_NAME}) from the unchanged source
${SOURCE_URL}
with these changes (scripts/build-boxedwine.mjs in https://github.com/Ralf1108/RunThemAll):

${PATCHES.map((p) => `* ${p.file}: ${p.why}\n--- original\n${p.from}+++ changed\n${p.to}`).join('\n')}
Build: Emscripten ${EMSCRIPTEN_VERSION}, Boxedwine's project/emscripten/makefile settings (release
and multiThreaded), linked to boxedwine.js instead of boxedwine.html.
`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
