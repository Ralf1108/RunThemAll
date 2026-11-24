// Consoles and home computers run with EmulatorJS (libretro cores).
// This table is shared by the browser (detection, BIOS handling) and by
// scripts/fetch-runtimes.mjs (which cores to download).
//
// bios.required: the system does not start without the original BIOS/firmware.
// bios.files:    file names EmulatorJS/the core looks for (case-insensitive match
//                against the user's files). Nothing of this is shipped by Run Them All.
// bios.builtin:  free replacement already contained in the core.

/**
 * @typedef {object} SystemInfo
 * @property {string} id        Run Them All id (also EmulatorJS EJS_core value)
 * @property {string} label     shown in the program list
 * @property {string} core      libretro core used (npm package @emulatorjs/core-<core>)
 * @property {string[]} ext     file extensions that clearly belong to this system
 * @property {{required:boolean, files:string[], builtin?:string, note?:string}} [bios]
 * @property {Record<string,string>} [options] libretro core options (EJS_defaultOptions)
 */

// VICE: speed up loading while autostarting (warp), keeps true drive emulation.
const VICE_OPTIONS = { vice_autoloadwarp: 'enabled' };

/** @type {SystemInfo[]} */
export const SYSTEMS = [
  // Home computers
  { id: 'c64', label: 'Commodore 64', core: 'vice_x64sc',
    ext: ['d64', 'd71', 'd81', 'g64', 'x64', 't64', 'prg', 'p00', 'crt'],
    bios: { required: false, files: [], builtin: 'C64-ROMs sind im VICE-Core enthalten' }, options: VICE_OPTIONS },
  { id: 'c128', label: 'Commodore 128', core: 'vice_x128', ext: [],
    bios: { required: false, files: [], builtin: 'ROMs im VICE-Core enthalten' }, options: VICE_OPTIONS },
  { id: 'vic20', label: 'Commodore VIC-20', core: 'vice_xvic', ext: ['20', '40', '60', 'a0', 'b0'],
    bios: { required: false, files: [], builtin: 'ROMs im VICE-Core enthalten' }, options: VICE_OPTIONS },
  { id: 'plus4', label: 'Commodore Plus/4', core: 'vice_xplus4', ext: [],
    bios: { required: false, files: [], builtin: 'ROMs im VICE-Core enthalten' }, options: VICE_OPTIONS },
  { id: 'pet', label: 'Commodore PET', core: 'vice_xpet', ext: [],
    bios: { required: false, files: [], builtin: 'ROMs im VICE-Core enthalten' }, options: VICE_OPTIONS },
  { id: 'amiga', label: 'Amiga', core: 'puae', ext: ['adf', 'adz', 'dms', 'ipf', 'hdf', 'hdz', 'lha', 'uae'],
    bios: { required: false, builtin: 'freier AROS-Kickstart im PUAE-Core enthalten',
      note: 'Original-Kickstart verbessert die Kompatibilität',
      files: ['kick33180.A500', 'kick34005.A500', 'kick37175.A500', 'kick37350.A600', 'kick40063.A600',
        'kick39106.A1200', 'kick40068.A1200', 'kick39106.A4000', 'kick40068.A4000', 'kick34005.CDTV',
        'kick40060.CD32'] } },
  { id: 'zxspectrum', label: 'ZX Spectrum', core: 'fuse', ext: ['tzx', 'z80', 'sna', 'szx'],
    bios: { required: false, files: [], builtin: 'Spectrum-ROMs im Fuse-Core enthalten' } },
  { id: 'zx81', label: 'ZX81', core: '81', ext: ['p', '81'],
    bios: { required: false, files: [], builtin: 'ROM im Core enthalten' } },
  { id: 'cpc', label: 'Amstrad CPC', core: 'cap32', ext: ['cdt', 'sna'],
    bios: { required: false, files: [], builtin: 'CPC-ROMs im Caprice32-Core enthalten' } },

  // Nintendo
  { id: 'nes', label: 'NES', core: 'fceumm', ext: ['nes', 'unf', 'unif', 'fds'],
    bios: { required: false, files: ['disksys.rom'], note: 'disksys.rom nur für Famicom-Disk-System (.fds)' } },
  { id: 'snes', label: 'SNES', core: 'snes9x', ext: ['sfc', 'smc', 'fig', 'swc', 'bs'] },
  { id: 'gb', label: 'Game Boy / Color', core: 'gambatte', ext: ['gb', 'gbc', 'dmg'] },
  { id: 'gba', label: 'Game Boy Advance', core: 'mgba', ext: ['gba', 'agb'],
    bios: { required: false, files: ['gba_bios.bin'], builtin: 'HLE-BIOS im mGBA-Core enthalten' } },
  { id: 'nds', label: 'Nintendo DS', core: 'melonds', ext: ['nds'],
    bios: { required: false, files: ['bios7.bin', 'bios9.bin', 'firmware.bin'], builtin: 'freies BIOS im melonDS-Core' } },
  { id: 'n64', label: 'Nintendo 64', core: 'mupen64plus_next', ext: ['n64', 'z64', 'v64'] },
  { id: 'vb', label: 'Virtual Boy', core: 'beetle_vb', ext: ['vb', 'vboy'] },

  // Sega
  { id: 'segaMS', label: 'Sega Master System', core: 'smsplus', ext: ['sms'] },
  { id: 'segaGG', label: 'Sega Game Gear', core: 'genesis_plus_gx', ext: ['gg'] },
  { id: 'segaMD', label: 'Sega Mega Drive', core: 'genesis_plus_gx', ext: ['md', 'gen', 'smd', 'sg'] },
  { id: 'sega32x', label: 'Sega 32X', core: 'picodrive', ext: ['32x'] },
  { id: 'segaCD', label: 'Sega Mega-CD', core: 'genesis_plus_gx', ext: [],
    bios: { required: true, files: ['bios_CD_U.bin', 'bios_CD_E.bin', 'bios_CD_J.bin'] } },
  { id: 'segaSaturn', label: 'Sega Saturn', core: 'yabause', ext: [],
    bios: { required: false, files: ['saturn_bios.bin'], builtin: 'HLE-BIOS im Yabause-Core' } },

  // Sony
  { id: 'psx', label: 'PlayStation', core: 'pcsx_rearmed', ext: ['pbp'],
    bios: { required: false, files: ['scph5500.bin', 'scph5501.bin', 'scph5502.bin', 'scph1001.bin'],
      builtin: 'HLE-BIOS im PCSX-ReARMed-Core' } },
  { id: 'psp', label: 'PlayStation Portable', core: 'ppsspp', ext: ['cso'] },

  // Atari
  { id: 'atari2600', label: 'Atari 2600', core: 'stella2014', ext: ['a26'] },
  { id: 'atari5200', label: 'Atari 5200', core: 'a5200', ext: ['a52'],
    bios: { required: true, files: ['5200.rom'] } },
  { id: 'atari7800', label: 'Atari 7800', core: 'prosystem', ext: ['a78'],
    bios: { required: false, files: ['7800 BIOS (U).rom'] } },
  { id: 'lynx', label: 'Atari Lynx', core: 'handy', ext: ['lnx', 'lyx'],
    bios: { required: true, files: ['lynxboot.img'] } },
  { id: 'jaguar', label: 'Atari Jaguar', core: 'virtualjaguar', ext: ['j64', 'jag'] },

  // Others
  { id: 'pce', label: 'PC Engine / TurboGrafx-16', core: 'mednafen_pce', ext: ['pce', 'sgx'],
    bios: { required: false, files: ['syscard3.pce'], note: 'syscard3.pce nur für CD-Spiele' } },
  { id: 'pcfx', label: 'PC-FX', core: 'mednafen_pcfx', ext: [],
    bios: { required: true, files: ['pcfx.rom'] } },
  { id: 'ngp', label: 'Neo Geo Pocket', core: 'mednafen_ngp', ext: ['ngp', 'ngc'] },
  { id: 'ws', label: 'WonderSwan', core: 'mednafen_wswan', ext: ['ws', 'wsc'] },
  { id: 'coleco', label: 'ColecoVision', core: 'gearcoleco', ext: ['col'],
    bios: { required: true, files: ['colecovision.rom'] } },
  { id: '3do', label: '3DO', core: 'opera', ext: [],
    bios: { required: true, files: ['panafz10.bin', 'panafz1.bin', 'panafz10-norsa.bin', 'goldstar.bin'] } },
  { id: 'arcade', label: 'Arcade (FBNeo)', core: 'fbneo', ext: [],
    bios: { required: false, files: ['neogeo.zip'], note: 'neogeo.zip für Neo-Geo-Spiele' } },
  { id: 'mame', label: 'Arcade (MAME 2003-Plus)', core: 'mame2003_plus', ext: [] },
];

export const SYSTEM_BY_ID = new Map(SYSTEMS.map((s) => [s.id, s]));

/** All cores that must be downloaded. */
export const CORES = [...new Set(SYSTEMS.map((s) => s.core))];

const BY_EXT = new Map();
for (const s of SYSTEMS) for (const e of s.ext) if (!BY_EXT.has(e)) BY_EXT.set(e, s.id);

/** Extensions that need a look into the file (several systems possible). */
const INSPECT_EXT = new Set(['bin', 'iso', 'img', 'rom', 'cue', 'chd', 'tap', 'dsk', 'sna', 'zip', '7z']);

/** Is this file worth checking for a system at all? */
export function isPossibleGame(path) {
  const ext = extOf(path);
  return BY_EXT.has(ext) || INSPECT_EXT.has(ext);
}

/** Is this file a known BIOS/firmware file of any system? */
const ALL_BIOS = new Set(SYSTEMS.flatMap((s) => s.bios?.files ?? []).map((f) => f.toLowerCase()));
export function isBiosFile(path) {
  return ALL_BIOS.has(path.split('/').pop().toLowerCase());
}

export function extOf(path) {
  const name = path.split('/').pop();
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

// ---------------------------------------------------------------------------
// Detection by extension and magic bytes

const ascii = (bytes, offset, length) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length));
const startsWith = (bytes, offset, text) => ascii(bytes, offset, text.length) === text;
const hasBytes = (bytes, offset, values) => values.every((v, i) => bytes[offset + i] === v);
const findText = (bytes, text) => {
  const first = text.charCodeAt(0);
  outer: for (let i = 0; i + text.length <= bytes.length; i++) {
    if (bytes[i] !== first) continue;
    for (let j = 1; j < text.length; j++) if (bytes[i + j] !== text.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
};

// Nintendo logo fragments in cartridge headers.
const GB_LOGO = [0xce, 0xed, 0x66, 0x66, 0xcc, 0x0d];
const GBA_LOGO = [0x24, 0xff, 0xae, 0x51, 0x69, 0x9a];

/** Bytes to read from the start of a file for detection. */
export const HEAD_BYTES = 0x10000;

/**
 * Detects the system(s) a game file belongs to.
 * @param {string} path
 * @param {number} size
 * @param {Uint8Array} head first HEAD_BYTES bytes (or the whole file if smaller)
 * @returns {string[]} candidate system ids, most likely first; empty if not a game
 */
export function detectSystems(path, size, head) {
  const ext = extOf(path);
  const b = head;

  // 1. Unambiguous magic bytes
  if (startsWith(b, 0, 'NES\x1a')) return ['nes'];
  if (startsWith(b, 0, 'FDS\x1a') || startsWith(b, 1, '*NINTENDO-HVC*')) return ['nes'];
  if (startsWith(b, 0, 'C64 CARTRIDGE')) return ['c64'];
  if (startsWith(b, 0, 'C64-TAPE-RAW')) return ['c64'];
  if (startsWith(b, 0, 'C64 tape image') || startsWith(b, 0, 'C64S tape')) return ['c64'];
  if (startsWith(b, 0, 'GCR-1541')) return ['c64'];
  if (startsWith(b, 0, 'DMS!')) return ['amiga'];
  if (startsWith(b, 0, 'CAPS')) return ['amiga'];
  if (startsWith(b, 0, 'RDSK')) return ['amiga'];
  if (startsWith(b, 0, 'LYNX')) return ['lynx'];
  if (startsWith(b, 1, 'ATARI7800')) return ['atari7800'];
  if (startsWith(b, 0, 'MV - CPC') || startsWith(b, 0, 'EXTENDED CPC DSK')) return ['cpc'];
  if (startsWith(b, 0, 'ZXST')) return ['zxspectrum'];
  if (startsWith(b, 0, 'ZXTape!\x1a')) return ext === 'cdt' ? ['cpc'] : ['zxspectrum', 'cpc'];
  if (startsWith(b, 0, 'CISO')) return ['psp'];
  if (hasBytes(b, 0, [0x80, 0x37, 0x12, 0x40]) || hasBytes(b, 0, [0x37, 0x80, 0x40, 0x12])
    || hasBytes(b, 0, [0x40, 0x12, 0x37, 0x80])) return ['n64'];
  if (b.length > 0xc6 && hasBytes(b, 0xc0, GBA_LOGO) && ext === 'nds') return ['nds'];
  if (b.length > 0x0a && hasBytes(b, 0x04, GBA_LOGO)) return ['gba'];
  if (b.length > 0x10a && hasBytes(b, 0x104, GB_LOGO)) return ['gb'];
  if (startsWith(b, 0x100, 'SEGA 32X')) return ['sega32x'];
  if (startsWith(b, 0x100, 'SEGA') && ext !== 'iso' && ext !== 'cue') return ['segaMD'];
  if (b[8] === 0xaa && b[9] === 0xbb && ext === 'smd') return ['segaMD'];

  // CD images: look for system identifiers in the first sectors
  if (['iso', 'bin', 'img', 'chd', 'cue'].includes(ext)) {
    if (findText(b, 'SEGADISCSYSTEM') >= 0) return ['segaCD'];
    if (findText(b, 'SEGA SEGASATURN') >= 0) return ['segaSaturn'];
    if (findText(b, 'PSP GAME') >= 0) return ['psp'];
    if (findText(b, 'PLAYSTATION') >= 0) return ['psx'];
    if (hasBytes(b, 0, [0x01, 0x5a, 0x5a, 0x5a, 0x5a, 0x5a, 0x01])) return ['3do'];
  }

  // Sega Master System / Game Gear: "TMR SEGA" near the end of the first 8/16/32 KB
  for (const off of [0x7ff0, 0x3ff0, 0x1ff0]) {
    if (b.length > off + 0x10 && startsWith(b, off, 'TMR SEGA')) {
      const region = b[off + 0x0f] >> 4;
      return region >= 5 ? ['segaGG', 'segaMS'] : ['segaMS', 'segaGG'];
    }
  }

  // 2. Disk/tape images recognised by content, size or an ambiguous extension
  if ([174848, 175531, 196608, 197376].includes(size) && ext === 'img') return ['c64'];
  if (ext === 'adf' || ((size === 901120 || size === 1802240) && startsWith(b, 0, 'DOS'))) return ['amiga'];
  if (ext === 'prg' && b[0] === 0x01 && b[1] === 0x08) return ['c64', 'c128'];
  if (ext === 'sna') return size === 49179 || size === 131103 ? ['zxspectrum'] : ['cpc', 'zxspectrum'];
  if (ext === 'tap') return ['zxspectrum', 'c64'];
  if (ext === 'dsk') return ['cpc'];

  // 3. By extension
  if (BY_EXT.has(ext)) return [BY_EXT.get(ext)];

  // 4. Generic CD images without identifier
  if (ext === 'cue' || ext === 'chd' || ext === 'iso') return ['psx', 'segaCD', 'segaSaturn', 'pce', '3do', 'pcfx'];
  if (ext === 'bin') return ['segaMD', 'atari2600', 'psx'];
  if (ext === 'zip' || ext === '7z') return ['arcade', 'mame'];
  return [];
}
