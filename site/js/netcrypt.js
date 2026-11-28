// End-to-end encryption of a multiplayer room. The relay only passes data on: everything the
// players send each other (emulator packets, Ethernet frames, lobby messages, player names) is
// sealed with AES-256-GCM in the browser, with keys that never leave the browser.
//
// Two levels of keys:
// - The room key (below) comes from password or room name. It only seals the handshake: hello
//   messages with the player's name and a fresh ECDH public key (P-256), and key messages.
// - Session keys: every connection makes a new ECDH key pair and a random sending key. Each pair
//   of players derives a shared key by ECDH (mixed with the room secret) and with it sends the
//   other its sending key. All packets, messages and frames are sealed with the sender's sending
//   key. So recorded traffic stays closed even when the password becomes known later (forward
//   secrecy), and in a room without a password the relay cannot read along by guessing the room
//   name: it would have to replace the public keys, which the safety code shows (all players
//   see the same code only when nobody sits in between).
//
// The key comes from the room password, or from the room name when the room has no password.
// The relay gets neither: it sees the room as an ID derived from the name (it cannot get the
// name back, only guess names and compare), and a password check value instead of the password.
//
//   nameBits = PBKDF2-SHA256(NAME, "RunThemAll netplay v1", 210 000 rounds)   NAME: the room name
//              as the relay compares it (spaces collapsed, upper case)
//   room ID  = HKDF(nameBits, "room id"), 16 bytes as hex: the room name the relay sees
//   secret   = password ? PBKDF2-SHA256(password, nameBits, 210 000 rounds) : nameBits
//   check    = HKDF(secret, "password check"), 16 bytes as hex: the password the relay sees
//   key      = HKDF(secret, "packets"): AES-256-GCM, the room key
//   pairSalt = HKDF(secret, "pair salt"), 32 bytes: salt of the ECDH pair keys
//
// A sealed message: 12 bytes random nonce, then the ciphertext with its 16 byte tag. Bound to it
// (additional data): the kind of message and its sender, so the relay can neither change nor
// redirect it unnoticed. See netplay/README.md, section "Encryption".

const enc = new TextEncoder();
const ROUNDS = 210000;
const NONCE = 12;
/** Bytes a sealed message is longer than the plain one. */
export const OVERHEAD = NONCE + 16;

/** The room name as the relay compares it: printable, spaces collapsed, at most 32 characters. */
export function cleanRoomName(name) {
  return [...name.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ')].slice(0, 32).join('').trim();
}

const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function pbkdf2(secret, salt) {
  const base = await crypto.subtle.importKey('raw', secret, 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ROUNDS }, base, 256));
}

async function hkdf(bits, info) {
  return crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveBits', 'deriveKey'])
    .then((base) => ({ base, params: { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(`RunThemAll netplay v1 ${info}`) } }));
}

async function hkdfBytes(bits, info, length) {
  const { base, params } = await hkdf(bits, info);
  return new Uint8Array(await crypto.subtle.deriveBits(params, base, length * 8));
}

/**
 * Derives what the relay gets (room ID, password check) and the key of the room.
 * @param {string} name room name as typed
 * @param {string} password may be empty
 * @returns {Promise<{roomId:string, check:string, cipher:RoomCipher, pairSalt:Uint8Array}>}
 */
export async function roomSecrets(name, password) {
  if (!crypto?.subtle) throw new Error('Encryption needs a secure page (https or localhost).');
  const nameBits = await pbkdf2(enc.encode(cleanRoomName(name).toUpperCase()), enc.encode('RunThemAll netplay v1'));
  const roomId = hex(await hkdfBytes(nameBits, 'room id', 16));
  const secret = password ? await pbkdf2(enc.encode(password), nameBits) : nameBits;
  const check = password ? hex(await hkdfBytes(secret, 'password check', 16)) : '';
  const { base, params } = await hkdf(secret, 'packets');
  const key = await crypto.subtle.deriveKey(params, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const pairSalt = await hkdfBytes(secret, 'pair salt', 32);
  return { roomId, check, cipher: new RoomCipher(key), pairSalt };
}

/**
 * The keys of one connection: an ECDH key pair (the private key cannot be exported) and a
 * random sending key.
 */
export async function sessionKeys() {
  const ecdh = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', ecdh.publicKey));
  const sendRaw = crypto.getRandomValues(new Uint8Array(32));
  return { ecdh, pub, sendRaw, sender: new RoomCipher(await importAesKey(sendRaw)) };
}

export function importAesKey(raw) {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/**
 * The key of two players: ECDH of own private and other public key, HKDF with the room's pair
 * salt (so it also needs the password) and both sessions (hex, any order).
 */
export async function pairCipher(privateKey, otherPub, pairSalt, sessionA, sessionB) {
  const pub = await crypto.subtle.importKey('raw', otherPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, privateKey, 256));
  const base = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const info = enc.encode(`RunThemAll netplay v1 pair ${[sessionA, sessionB].sort().join(' ')}`);
  const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: pairSalt, info }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return new RoomCipher(key);
}

/**
 * Safety code of a room: the same for all players exactly when they all see the same public
 * keys, i.e. when nobody (the relay) has put own keys in between. 12 digits from SHA-256 of all
 * sessions and public keys.
 * @param {{session:string, pub:Uint8Array}[]} keys own and the other players'
 */
export async function safetyCode(keys) {
  const text = keys.map((k) => `${k.session}:${toBase64(k.pub)}`).sort().join(' | ');
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  let n = 0;
  for (let i = 0; i < 5; i++) n = n * 256 + h[i];
  const digits = String(n % 1e12).padStart(12, '0');
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** Additional data of a message: its kind (one letter) and up to two 32 bit numbers or bytes. */
export function context(kind, ...parts) {
  const out = [kind.charCodeAt(0)];
  for (const p of parts) {
    if (typeof p === 'number') out.push(p >>> 24, (p >>> 16) & 255, (p >>> 8) & 255, p & 255);
    else out.push(...p);
  }
  return new Uint8Array(out);
}

/** AES-GCM with the room key. */
export class RoomCipher {
  constructor(key) {
    this.key = key;
  }

  /** @returns {Promise<Uint8Array>} nonce + ciphertext + tag */
  async seal(plain, additional) {
    const iv = crypto.getRandomValues(new Uint8Array(NONCE));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: additional }, this.key, plain));
    const out = new Uint8Array(NONCE + ct.length);
    out.set(iv);
    out.set(ct, NONCE);
    return out;
  }

  /** @returns {Promise<Uint8Array>} the plain data; rejects when the message was changed or has another key */
  async open(sealed, additional) {
    if (sealed.length < OVERHEAD) throw new Error('too short');
    const iv = sealed.subarray(0, NONCE);
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: additional }, this.key, sealed.subarray(NONCE)));
  }
}

/** Base64 of bytes (messages travel inside the relay's JSON). */
export function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
