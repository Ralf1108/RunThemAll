// Runs console and home computer games with EmulatorJS (libretro cores).
// EmulatorJS is loaded unmodified from ./emulatorjs/data/.

import { toPng } from './report.js';
import { Runner, loadScript, prefetch, splitPath } from './runner.js';
import { SYSTEM_BY_ID, extOf } from './systems.js';
import { createZip } from './zip.js';

/**
 * @typedef {object} EjsOptions
 * @property {string} system   system id from systems.js
 * @property {File[]} biosFiles BIOS files chosen by the user (optional)
 * @property {boolean} sound
 */

/** BIOS files of a system found in the workspace (matched by file name). */
export function findBiosInWorkspace(system, workspace) {
  const wanted = new Set((system.bios?.files ?? []).map((f) => f.toLowerCase()));
  return workspace.files.filter((f) => wanted.has(f.path.split('/').pop().toLowerCase()));
}

/** Files referenced by a .cue sheet (same folder). */
function cueReferences(cueText) {
  return [...cueText.matchAll(/^\s*FILE\s+"?([^"\r\n]+?)"?\s+\S+\s*$/gim)].map((m) => m[1]);
}

/**
 * The core file EmulatorJS will request, using its own rules: "-legacy" unless the
 * core report asks for WebGL 2 (and the browser has it); no threads (EJS_threads off).
 */
async function coreFile(dataUrl, core) {
  let webgl2 = core === 'ppsspp';
  try {
    const report = await (await fetch(`${dataUrl}cores/reports/${core}.json`)).json();
    webgl2 ||= report.options?.defaultWebGL2 === true;
  } catch { /* no report: EmulatorJS falls back to legacy as well */ }
  const supported = !!document.createElement('canvas').getContext('webgl2');
  return `${core}${webgl2 && supported ? '' : '-legacy'}-wasm.data`;
}

/**
 * WebGL normally throws the picture away once it is on screen, so reading the canvas
 * (for a screenshot) gives black. Keep it for the WebGL contexts EmulatorJS creates.
 */
function preserveWebGlPicture() {
  const proto = HTMLCanvasElement.prototype;
  if (proto.getContext.runThemAll) return;
  const original = proto.getContext;
  proto.getContext = function getContext(type, attributes) {
    if (/webgl/i.test(type)) attributes = { ...attributes, preserveDrawingBuffer: true };
    return original.call(this, type, attributes);
  };
  proto.getContext.runThemAll = true;
}

export class EmulatorJsRunner extends Runner {
  /** EmulatorJS handles save games and states itself (menu in the player). */
  get supportsFileSync() { return false; }

  /**
   * @param {import('./workspace.js').Workspace} workspace
   * @param {string} program path of the game file inside the workspace
   * @param {EjsOptions} opts
   */
  async start(workspace, program, opts) {
    if (this.running) throw new Error('The emulator is already running. Please reload the page.');
    this.running = true;
    this.workspace = workspace;
    const { status, log, ejsContainer } = this.ui;
    const system = SYSTEM_BY_ID.get(opts.system);
    if (!system) throw new Error(`Unbekanntes System: ${opts.system}`);

    const data = new URL('emulatorjs/data/', document.baseURI).href;
    const ejsVersion = await fetch('emulatorjs/version.json').then((r) => r.json()).then((v) => v.version).catch(() => '');
    this.ui.emulatorInfo(`EmulatorJS ${ejsVersion} · ${system.label} · Core ${system.core}`.replace('  ', ' '));
    this.ui.steps([`Download the emulator (EmulatorJS, core ${system.core})`, 'Read the game', 'Start the emulator']);

    // 1. Download EmulatorJS and the core with a progress bar (EmulatorJS then hits the cache).
    this.ui.step(0);
    await prefetch(['loader.js', 'emulator.min.js', 'emulator.min.css', `cores/${await coreFile(data, system.core)}`]
      .map((f) => data + f), this.ui);

    // 2. Game file. CD images with a .cue sheet are passed as ZIP together with their tracks.
    this.ui.step(1);
    status('Reading the game …');
    const entry = workspace.files.find((f) => f.path === program);
    const [dir, name] = splitPath(program);
    let game;
    if (extOf(program) === 'cue') {
      const cue = await entry.load();
      const parts = [{ name, data: cue }];
      for (const ref of cueReferences(new TextDecoder().decode(cue))) {
        const refPath = dir ? `${dir}/${ref}` : ref;
        const track = workspace.files.find((f) => f.path.toLowerCase() === refPath.toLowerCase());
        if (track) parts.push({ name: ref, data: await track.load() });
        else log(`Track missing: ${ref}`, true);
      }
      game = new File([createZip(parts)], name.replace(/\.cue$/i, '.zip'));
    } else {
      game = new File([await entry.load()], name);
    }

    // BIOS: from the opened files and/or chosen by the user; always passed as ZIP.
    const biosParts = [];
    for (const f of findBiosInWorkspace(system, workspace)) {
      biosParts.push({ name: f.path.split('/').pop(), data: await f.load() });
    }
    for (const f of opts.biosFiles ?? []) {
      biosParts.push({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) });
    }
    if (system.bios?.required && biosParts.length === 0) {
      throw new Error(`${system.label} needs a BIOS file (${system.bios.files.join(', ')}). `
        + 'Put it into the ZIP/folder or choose it before starting.');
    }
    let biosUrl = '';
    if (biosParts.length) {
      biosUrl = URL.createObjectURL(createZip(biosParts));
      log(`BIOS: ${biosParts.map((p) => p.name).join(', ')}`, false);
    } else if (system.bios?.builtin) {
      log(`BIOS: ${system.bios.builtin}`, false);
    }

    log(`EmulatorJS: ${system.label}, core ${system.core}, game ${game.name}`, false);
    this.ui.step(2);
    ejsContainer.hidden = false;
    ejsContainer.replaceChildren(Object.assign(document.createElement('div'), { id: 'ejs-player' }));

    Object.assign(window, {
      EJS_player: '#ejs-player',
      EJS_core: system.core,
      EJS_pathtodata: data,
      EJS_gameUrl: game,
      EJS_gameName: name.replace(/\.[^.]+$/, ''),
      EJS_biosUrl: biosUrl,
      EJS_startOnLoaded: true,
      EJS_volume: 0.5, // muting is done by the sound button (audio.js)
      EJS_Buttons: { netplay: false },
      EJS_defaultOptions: system.options ?? {},
      EJS_onGameStart: () => {
        status('Running');
        this.ui.ready();
      },
    });

    preserveWebGlPicture();
    await loadScript(data + 'loader.js');
  }

  async readAllFiles() {
    return [];
  }

  fullscreen() {
    this.ui.ejsContainer.requestFullscreen?.();
  }

  async screenshot() {
    // EmulatorJS crops the canvas to the game picture (readable thanks to preserveWebGlPicture).
    const ejs = window.EJS_emulator;
    if (typeof ejs?.screenshot !== 'function') return super.screenshot();
    const blob = await Promise.race([
      new Promise((resolve) => ejs.screenshot((b) => resolve(b), 'canvas', 'png', 1)),
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    return blob ?? super.screenshot();
  }

  get supportsPause() { return true; }

  setPaused(paused) {
    // EmulatorJS's own pause (also updates its pause/play button)
    if (paused) window.EJS_emulator?.pause();
    else window.EJS_emulator?.play();
  }
}
