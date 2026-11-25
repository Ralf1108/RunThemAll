// Runs complete operating systems from disk images (CD, floppy, hard disk)
// with the v86 x86 PC emulator. v86 is loaded unmodified from ./v86/.

import { toPng } from './report.js';
import { Runner, prefetch, splitPath } from './runner.js';
import { extOf } from './systems.js';
import { fitToBox, pcAspect } from './fit.js';

/** Standard floppy sizes in bytes (160 KB to 2.88 MB). */
const FLOPPY_SIZES = new Set([163840, 184320, 327680, 368640, 737280, 1228800, 1474560, 1720320, 2949120]);

/**
 * How v86 should attach an image: as CD-ROM, floppy or hard disk.
 * @param {string} path
 * @param {number} size
 * @returns {'cdrom'|'fda'|'hda'}
 */
export function diskSlot(path, size) {
  const ext = extOf(path);
  if (ext === 'iso') return 'cdrom';
  if (['ima', 'vfd', 'flp'].includes(ext) || FLOPPY_SIZES.has(size)) return 'fda';
  return 'hda';
}

const SLOT_LABELS = { cdrom: 'CD-ROM', fda: 'floppy', hda: 'hard disk' };

/**
 * @typedef {object} V86Options
 * @property {number} memory RAM in MB
 * @property {boolean} sound
 */

export class V86Runner extends Runner {
  /** Disk images are kept in memory only; nothing is written back. */
  get supportsFileSync() { return false; }

  /**
   * @param {import('./workspace.js').Workspace} workspace
   * @param {string} program path of the disk image inside the workspace
   * @param {V86Options} opts
   */
  async start(workspace, program, opts) {
    if (this.running) throw new Error('The emulator is already running. Please reload the page.');
    this.running = true;
    this.workspace = workspace;
    const { status, log, v86Container } = this.ui;
    const base = new URL('v86/', document.baseURI).href;
    const info = await fetch(base + 'version.json').then((r) => r.json()).catch(() => ({}));
    const entry = workspace.files.find((f) => f.path === program);
    const slot = diskSlot(program, entry.size);
    const memory = opts.memory || 128;
    this.ui.emulatorInfo(`v86 ${info.v86 ?? ''} · ${SLOT_LABELS[slot]} · ${memory} MB RAM`.replace('  ', ' '));
    this.ui.steps(['Download the emulator (v86, SeaBIOS)', `Read the image (${SLOT_LABELS[slot]})`, 'Start the PC']);

    // 1. Emulator and BIOS with a progress bar.
    this.ui.step(0);
    const files = await prefetch(['libv86.mjs', 'v86.wasm', 'bios/seabios.bin', 'bios/vgabios.bin'].map((f) => base + f), this.ui);
    const buffer = (name) => {
      const bytes = files.get(base + name);
      return { buffer: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    };

    // 2. Disk image: in memory, or (large demo images) as zstd parts that v86 loads on demand.
    this.ui.step(1);
    status('Reading the image …');
    let image;
    if (entry.remote) {
      image = { url: entry.remote.url, size: entry.remote.size, async: true, use_parts: true,
        fixed_chunk_size: entry.remote.chunk };
    } else {
      const bytes = await entry.load();
      image = { buffer: bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    }
    log(`v86: ${splitPath(program)[1]} as ${SLOT_LABELS[slot]} (${(entry.size / 1048576).toFixed(1)} MB${entry.remote ? ', loaded in parts on demand' : ''}), ${memory} MB RAM`, false);

    // 3. Boot.
    this.ui.step(2);
    status('Starting the PC …');
    const { V86 } = await import(base + 'libv86.mjs');
    v86Container.hidden = false;
    const text = Object.assign(document.createElement('div'), { className: 'v86-text' });
    const screen = Object.assign(document.createElement('canvas'), { className: 'v86-canvas' });
    v86Container.replaceChildren(text, screen);
    // Text mode and graphics mode use the whole emulator area, shown as on a PC monitor.
    fitToBox(text, v86Container, () => 4 / 3);
    fitToBox(screen, v86Container, pcAspect);
    this.emulator = new V86({
      wasm_path: base + 'v86.wasm',
      memory_size: memory * 1024 * 1024,
      vga_memory_size: 8 * 1024 * 1024,
      screen_container: v86Container,
      bios: buffer('bios/seabios.bin'),
      vga_bios: buffer('bios/vgabios.bin'),
      [slot]: image,
      disable_speaker: false, // muting is done by the sound button (audio.js)
      acpi: false,
      autostart: true,
    });
    this.emulator.add_listener('emulator-started', () => {
      this.ui.ready();
      this.ui.hint?.('Click into the picture to use the mouse; Esc releases it.');
    });
    v86Container.addEventListener('click', () => this.emulator?.lock_mouse());
  }

  async readAllFiles() {
    return [];
  }

  async screenshot() {
    const image = this.emulator?.screen_make_screenshot();
    return image ? toPng(image) : super.screenshot();
  }

  get supportsPause() { return true; }

  setPaused(paused) {
    if (paused) this.emulator?.stop();
    else this.emulator?.run();
  }

  fullscreen() {
    this.ui.v86Container.requestFullscreen?.();
  }
}
