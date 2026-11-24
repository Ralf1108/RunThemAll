// Detects which kind of program an executable is, based on its header.
//
//   .COM                         -> DOS
//   MZ only                      -> DOS
//   MZ + "LE"/"LX" (DOS/4GW etc.) -> DOS (DOS extender)
//   MZ + "NE"                    -> Windows 16-bit (Windows 3.x)
//   MZ + "PE\0\0"                -> Windows 32-bit
//   .BAT                         -> decided by the other programs in the folder

/** @typedef {'dos'|'win16'|'win32'|'bat'|'unknown'} ProgramKind */

export const KIND_LABELS = {
  dos: 'DOS',
  win16: 'Windows 16-Bit',
  win32: 'Windows 32-Bit',
  bat: 'Batchdatei',
  unknown: 'Unbekannt',
};

/** Number of leading bytes needed in most cases. */
export const HEADER_PEEK = 4096;

/**
 * @param {string} name file name
 * @param {(offset:number, length:number) => Promise<Uint8Array>} read reads a byte range
 * @returns {Promise<ProgramKind>}
 */
export async function detectKind(name, read) {
  if (/\.com$/i.test(name)) return 'dos';
  if (/\.bat$/i.test(name)) return 'bat';

  const head = await read(0, 64);
  if (head.length < 2 || head[0] !== 0x4d || head[1] !== 0x5a) {
    // Not an MZ executable. A file named .EXE without MZ header is most likely a renamed .COM.
    return head.length ? 'dos' : 'unknown';
  }
  if (head.length < 64) return 'dos';

  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const relocTableOffset = view.getUint16(0x18, true);
  const newHeaderOffset = view.getUint32(0x3c, true);
  // Plain DOS executables have their relocation table directly after the
  // 28-byte header, so the e_lfanew field at 0x3C is not meaningful.
  if (relocTableOffset < 0x40 && relocTableOffset !== 0) return 'dos';
  if (newHeaderOffset < 0x40 || newHeaderOffset > 0x1000000) return 'dos';

  const sig = await read(newHeaderOffset, 4);
  if (sig.length < 2) return 'dos';
  const s = String.fromCharCode(sig[0], sig[1]);
  if (s === 'PE' && sig[2] === 0 && sig[3] === 0) return 'win32';
  if (s === 'NE') return 'win16';
  return 'dos'; // LE/LX (DOS extenders) or unknown stub
}

/**
 * Decides which emulator runs a program.
 * @param {ProgramKind} kind
 * @param {ProgramKind[]} siblings kinds of the other programs in the workspace
 * @returns {'dos'|'windows'}
 */
export function emulatorFor(kind, siblings) {
  if (kind === 'dos') return 'dos';
  if (kind === 'win16' || kind === 'win32') return 'windows';
  // .bat or unknown: Windows if the folder contains Windows programs, otherwise DOS.
  return siblings.some((k) => k === 'win16' || k === 'win32') ? 'windows' : 'dos';
}
