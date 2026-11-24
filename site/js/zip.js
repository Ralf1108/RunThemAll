// Minimal ZIP reader/writer without dependencies.
// Reading supports "stored" and "deflate" entries (via DecompressionStream),
// writing produces "stored" entries. ZIP64 and encryption are not supported.
// Works in browsers and in Node.js (>= 22).

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

// Code page 437 (the classic DOS charset) for file names without the UTF-8 flag.
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

function decodeName(bytes, utf8) {
  if (utf8) return new TextDecoder('utf-8').decode(bytes);
  let s = '';
  for (const b of bytes) s += b < 0x80 ? String.fromCharCode(b) : CP437_HIGH[b - 0x80];
  return s;
}

/**
 * Lists the entries of a ZIP archive.
 * @param {Uint8Array} data
 * @returns {{name:string, isDir:boolean, method:number, flags:number, crc:number,
 *            compressedSize:number, size:number, localOffset:number}[]}
 */
export function listZip(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let eocd = -1;
  for (let i = data.length - 22, min = Math.max(0, i - 0xffff); i >= min; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Keine gültige ZIP-Datei (Verzeichnis nicht gefunden).');

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (count === 0xffff || offset === 0xffffffff) {
    throw new Error('ZIP64-Archive werden nicht unterstützt.');
  }

  const entries = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(offset, true) !== SIG_CENTRAL) {
      throw new Error('Beschädigtes ZIP-Verzeichnis.');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const rawName = data.subarray(offset + 46, offset + 46 + nameLen);
    const name = decodeName(rawName, (flags & 0x800) !== 0).replace(/\\/g, '/');
    entries.push({
      name,
      isDir: name.endsWith('/'),
      method,
      flags,
      crc,
      compressedSize,
      size,
      localOffset,
    });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Returns the uncompressed content of one entry.
 * @param {Uint8Array} data the whole archive
 * @param {ReturnType<typeof listZip>[number]} entry
 */
export async function readZipEntry(data, entry) {
  if (entry.flags & 0x1) throw new Error(`Verschlüsselte Datei nicht unterstützt: ${entry.name}`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const lo = entry.localOffset;
  if (view.getUint32(lo, true) !== SIG_LOCAL) throw new Error(`Beschädigter Eintrag: ${entry.name}`);
  const start = lo + 30 + view.getUint16(lo + 26, true) + view.getUint16(lo + 28, true);
  const raw = data.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return raw.slice();
  if (entry.method === 8) return inflateRaw(raw);
  throw new Error(`Kompressionsverfahren ${entry.method} nicht unterstützt: ${entry.name}`);
}

/**
 * Returns an entry exactly as stored (still compressed), for copying it into
 * another archive with createZip() without recompressing.
 */
export function readZipEntryRaw(data, entry) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const lo = entry.localOffset;
  if (view.getUint32(lo, true) !== SIG_LOCAL) throw new Error(`Beschädigter Eintrag: ${entry.name}`);
  const start = lo + 30 + view.getUint16(lo + 26, true) + view.getUint16(lo + 28, true);
  return {
    method: entry.method,
    crc: entry.crc,
    size: entry.size,
    compressed: data.slice(start, start + entry.compressedSize),
  };
}

// ---------------------------------------------------------------------------
// CRC32 + writer

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Builds a ZIP archive. Entries given as `data` are stored uncompressed;
 * entries given as `raw` (from readZipEntryRaw) are copied as they are.
 * @param {({name:string, data:Uint8Array} | {name:string, raw:ReturnType<typeof readZipEntryRaw>})[]} files
 * @returns {Blob}
 */
export function createZip(files) {
  const enc = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = enc.encode(file.name);
    const raw = file.raw;
    const method = raw ? raw.method : 0;
    const crc = raw ? raw.crc : crc32(file.data);
    const size = raw ? raw.size : file.data.length;
    const data = raw ? raw.compressed : file.data;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, SIG_LOCAL, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x800, true); // UTF-8 names
    local.setUint16(8, method, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, size, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(local, nameBytes, data);

    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, SIG_CENTRAL, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x800, true);
    cd.setUint16(10, method, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, data.length, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint32(42, offset, true);
    central.push(cd, nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const centralSize = central.reduce((s, p) => s + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, SIG_EOCD, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);

  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}
