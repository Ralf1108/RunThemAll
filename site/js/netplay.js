// Netplay: the browser side of the relay in /netplay (Go). One WebSocket per player carries
// the room handshake (JSON text messages) and the network packets of the emulator (binary
// messages: 4 bytes peer ID, big endian, then the packet). See netplay/README.md.
// With a room cipher (netcrypt.js) packets, messages and player names are end-to-end encrypted
// with session keys (ECDH, forward secrecy): the relay only sees sealed bytes.

import { RoomCipher, context, fromBase64, importAesKey, pairCipher, safetyCode, sessionKeys, toBase64 } from './netcrypt.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
/** Sealed data starts with receiver (4 bytes), session (8) and sequence number (8). */
const SEALED_HEAD = 20;
export const hexOf = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));

/**
 * @typedef {object} Member
 * @property {number} peer
 * @property {string} name
 * @property {boolean} host
 */

/** Turns "relay.example.org", "wss://relay.example.org/" or "ws://localhost:8090" into the control URL. */
export function controlUrl(relay) {
  let base = relay.trim().replace(/\/+$/, '');
  if (!/^wss?:\/\//i.test(base)) base = (/^(localhost|127\.|\[::1\])/.test(base) ? 'ws://' : 'wss://') + base.replace(/^https?:\/\//i, '');
  return `${base}/v1`;
}

/** The Ethernet port of a player for PC emulators (v86): one WebSocket, one frame per message. */
export function ethernetUrl(relay, token) {
  return `${controlUrl(relay)}/eth?token=${encodeURIComponent(token)}`;
}

/** Room codes are typed in any case, with or without the dash. */
export function normalizeCode(code) {
  const c = code.toUpperCase().replace(/[^ABCDEFGHJKMNPQRSTUVWXYZ23456789]/g, '');
  return c.length === 10 ? `${c.slice(0, 5)}-${c.slice(5)}` : '';
}

/**
 * A player in a room. Events: "members" (detail: Member[]), "packet" (detail: {from, data}),
 * "message" (detail: {from, data}) and "close" (detail: reason text).
 */
export class NetplayClient extends EventTarget {
  constructor() {
    super();
    this.ws = null;
    this.relay = '';
    this.room = '';
    this.peer = 0;
    this.host = 0;
    this.token = '';
    this.num = 0; // number in the room (1, 2, …): addresses in virtual networks
    /** @type {Member[]} */
    this.members = [];
    this.relayMembers = [];
    this.sent = 0;
    this.received = 0;
    /** @type {import('./netcrypt.js').RoomCipher|null} room key: seals the handshake */
    this.cipher = null;
    this.pairSalt = null;
    this.name = '';
    /** Own keys of this connection (sessionKeys in netcrypt.js). */
    this.keys = null;
    /** What we know of the other members: peer -> Sender (see receiveHello). */
    this.senders = new Map();
    this.session = new Uint8Array(8); // own session, new for every connection (reset)
    this.sessionHex = '';
    this.seq = 0;
    /** Safety code of the room (encrypted rooms), see netcrypt.js. */
    this.safetyCode = '';
    // Sealing runs in parallel, sending keeps the order; received data is handled in order.
    this.tx = Promise.resolve();
    this.rx = Promise.resolve();
    this.rejected = 0; // data that could not be opened (other key or changed on the way)
    this.replayed = 0; // opened, but sent again, too old or from an unknown session
    this.reset();
  }

  get encrypted() { return Boolean(this.cipher); }

  get connected() { return this.ws?.readyState === WebSocket.OPEN && this.peer !== 0; }
  get isHost() { return this.peer !== 0 && this.peer === this.host; }

  /**
   * Connects and creates or joins a room.
   * @param {string} relay
   * @param {{type:'create'|'join'|'enter', room?:string, password?:string, name?:string}} hello
   * @param {{cipher?:import('./netcrypt.js').RoomCipher, pairSalt?:Uint8Array, room?:string, name?:string}} [secure]
   *   encrypted room (roomSecrets in netcrypt.js): hello carries only the room ID and password
   *   check; the room name and the player name stay in the browser
   */
  async open(relay, hello, secure = {}) {
    this.close();
    this.cipher = secure.cipher ?? null;
    this.pairSalt = secure.pairSalt ?? null;
    this.name = secure.name ?? hello.name ?? '';
    this.keys = this.cipher ? await sessionKeys() : null;
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(controlUrl(relay));
      } catch (err) {
        reject(new Error(`Invalid relay address: ${err.message}`));
        return;
      }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      this.relay = relay;
      let settled = false;
      const fail = (message) => {
        if (settled) return;
        settled = true;
        reject(new Error(message));
      };
      const timer = setTimeout(() => { fail('The relay did not answer.'); ws.close(); }, 15000);
      ws.onopen = () => ws.send(JSON.stringify(hello));
      ws.onerror = () => fail(`Cannot reach the relay ${relay}.`);
      ws.onclose = () => {
        clearTimeout(timer);
        fail(`Cannot reach the relay ${relay}.`);
        if (this.ws === ws) {
          const was = this.room;
          this.reset();
          if (was) this.dispatchEvent(new CustomEvent('close', { detail: 'The connection to the relay was closed.' }));
        }
      };
      ws.onmessage = (e) => {
        if (typeof e.data !== 'string') {
          const view = new DataView(e.data);
          if (e.data.byteLength < 4) return;
          this.received += e.data.byteLength - 4;
          const from = view.getUint32(0);
          if (!this.cipher) {
            // A copy with its own buffer: js-dos hands the buffer on to its worker.
            this.dispatchEvent(new CustomEvent('packet', { detail: { from, data: new Uint8Array(e.data, 4).slice() } }));
            return;
          }
          const sealed = new Uint8Array(e.data, 4).slice();
          this.inOrder(ws, () => this.openFromSender(from, 'p', sealed, (data) => {
            this.dispatchEvent(new CustomEvent('packet', { detail: { from, data } }));
          }));
          return;
        }
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === 'error') {
          clearTimeout(timer);
          fail(msg.message || msg.code);
        } else if (msg.type === 'joined') {
          clearTimeout(timer);
          Object.assign(this, { room: secure.room ?? msg.room, peer: msg.peer, host: msg.host, token: msg.token, num: msg.num ?? 0 });
          settled = true;
          resolve(msg);
        } else if (msg.type === 'members') {
          const before = new Set(this.relayMembers.map((m) => m.peer));
          this.relayMembers = msg.members ?? [];
          this.host = msg.host;
          if (this.cipher) {
            const now = new Set(this.relayMembers.map((m) => m.peer));
            for (const peer of this.senders.keys()) if (!now.has(peer)) this.senders.delete(peer);
            // Somebody new: introduce ourselves (name, session, public key, see sendHello).
            if (this.relayMembers.some((m) => !before.has(m.peer))) this.sendHello();
          }
          this.updateMembers();
        } else if (msg.type === 'msg') {
          if (!this.cipher) {
            this.dispatchEvent(new CustomEvent('message', { detail: { from: msg.from, data: msg.data } }));
            return;
          }
          // "R…": sealed with the room key (handshake), "S…": with the sender's sending key.
          if (typeof msg.data !== 'string' || !/^[RS]/.test(msg.data)) return;
          let sealed;
          try { sealed = fromBase64(msg.data.slice(1)); } catch { return; }
          const from = msg.from;
          if (msg.data[0] === 'R') this.inOrder(ws, () => this.openHandshake(from, sealed));
          else {
            this.inOrder(ws, () => this.openFromSender(from, 'm', sealed, (plain) => {
              let data;
              try { data = JSON.parse(dec.decode(plain)); } catch { return; }
              this.dispatchEvent(new CustomEvent('message', { detail: { from, data } }));
            }));
          }
        }
      };
    });
  }

  /** Sends a packet to one member (0: to everybody else). */
  sendPacket(to, data) {
    if (!this.connected) return false;
    this.sent += data.byteLength;
    if (!this.cipher) {
      const buf = new Uint8Array(4 + data.byteLength);
      new DataView(buf.buffer).setUint32(0, to);
      buf.set(data, 4);
      this.ws.send(buf);
      return true;
    }
    this.sendSealed(this.keys.sender, 'p', to, data, (sealed) => {
      const buf = new Uint8Array(4 + sealed.length);
      new DataView(buf.buffer).setUint32(0, to);
      buf.set(sealed, 4);
      return buf;
    });
    return true;
  }

  /** Sends a small JSON message to one member (0: everybody else). */
  sendMessage(to, data) {
    if (!this.connected) return;
    if (!this.cipher) this.ws.send(JSON.stringify({ type: 'msg', to, data }));
    else this.sendSealed(this.keys.sender, 'm', to, enc.encode(JSON.stringify(data)), (sealed) => JSON.stringify({ type: 'msg', to, data: `S${toBase64(sealed)}` }));
  }

  /** Handshake messages are sealed with the room key (kind "h"). */
  sendHandshake(to, data) {
    if (!this.connected) return;
    this.sendSealed(this.cipher, 'h', to, enc.encode(JSON.stringify(data)), (sealed) => JSON.stringify({ type: 'msg', to, data: `R${toBase64(sealed)}` }));
  }

  /** The members with their own names (encrypted rooms: from their hello messages). */
  updateMembers() {
    this.members = !this.cipher ? this.relayMembers : this.relayMembers.map((m) => ({
      ...m, name: m.peer === this.peer ? this.name || 'Player' : this.senders.get(m.peer)?.name ?? `Player ${m.num ?? ''}`.trim(),
    }));
    this.dispatchEvent(new CustomEvent('members', { detail: this.members }));
    if (this.cipher) this.updateSafetyCode();
  }

  /** Safety code over the own key and the keys of all members we exchange data with. */
  async updateSafetyCode() {
    const ws = this.ws;
    const keys = [{ session: this.sessionHex, pub: this.keys.pub }];
    for (const s of this.senders.values()) if (s.ready) keys.push({ session: s.session, pub: s.pub });
    const code = keys.length > 1 ? await safetyCode(keys) : '';
    if (this.ws !== ws || code === this.safetyCode) return;
    this.safetyCode = code;
    this.dispatchEvent(new CustomEvent('members', { detail: this.members }));
  }

  // Handshake and replay protection (encrypted rooms).
  //
  // Every sealed packet and message starts with [4 bytes receiver][8 bytes session][8 bytes
  // sequence number]. The session is random per connection, the number counts up. A receiver
  // takes data only from a sender whose session is live and with a higher number than the last.
  //
  // Hello {netplay:'hello', name, pub, know:[sessions]} (room key) introduces a player with its
  // ECDH public key. A sender is live once its hello lists the receiver's own fresh session, so
  // a recording of an older session never counts. Everybody sends a hello when somebody new joins
  // and when it learns a new session. With the other's public key each side derives the pair key
  // and sends {netplay:'key', box} (room key outside, pair key inside): its sending key. Data of
  // a sender counts once it is live and its sending key is there ("ready").

  sendHello() {
    const know = [...this.senders.values()].map((s) => s.session);
    this.sendHandshake(0, { netplay: 'hello', name: this.name, pub: toBase64(this.keys.pub), know });
  }

  /** Seals [receiver][session][sequence][data] now and sends it in the order of the calls. */
  sendSealed(cipher, kind, to, data, wrap) {
    const ws = this.ws;
    const plain = new Uint8Array(SEALED_HEAD + data.byteLength);
    const view = new DataView(plain.buffer);
    view.setUint32(0, to);
    plain.set(this.session, 4);
    view.setBigUint64(12, BigInt(++this.seq));
    plain.set(data, SEALED_HEAD);
    const sealed = cipher.seal(plain, context(kind, this.peer));
    this.tx = this.tx.then(() => sealed).then((s) => {
      if (this.ws === ws && ws.readyState === WebSocket.OPEN) ws.send(wrap(s));
    }).catch(() => {});
  }

  /** Handles received data one after the other (keys arrive before the data sealed with them). */
  inOrder(ws, job) {
    this.rx = this.rx.then(() => (this.ws === ws ? job() : undefined)).catch(() => { this.rejected++; });
  }

  /** Opens sealed data; returns {to, session, seq, body} or null when it is not for us. */
  async unseal(cipher, kind, from, sealed) {
    const plain = await cipher.open(sealed, context(kind, from));
    if (plain.length < SEALED_HEAD) return null;
    const view = new DataView(plain.buffer, plain.byteOffset);
    const to = view.getUint32(0);
    if (to !== 0 && to !== this.peer) return null; // meant for somebody else
    return { session: hexOf(plain.subarray(4, 12)), seq: view.getBigUint64(12), body: plain.slice(SEALED_HEAD) };
  }

  async openFromSender(from, kind, sealed, deliver) {
    const s = this.senders.get(from);
    if (!s?.ready) { this.replayed++; return; }
    const u = await this.unseal(s.cipher, kind, from, sealed);
    if (u && this.accept(from, u.session, u.seq, 'seq')) deliver(u.body);
  }

  async openHandshake(from, sealed) {
    const u = await this.unseal(this.cipher, 'h', from, sealed);
    if (!u) return;
    let data;
    try { data = JSON.parse(dec.decode(u.body)); } catch { return; }
    if (data?.netplay === 'hello') await this.receiveHello(from, u.session, u.seq, data);
    else if (data?.netplay === 'key') await this.receiveKey(from, u.session, u.seq, data);
  }

  async receiveHello(from, session, seq, data) {
    let s = this.senders.get(from);
    if (s?.live && s.session !== session) { this.replayed++; return; } // an old hello of a live member
    const isNew = !s || s.session !== session;
    if (isNew) {
      let pub;
      try { pub = fromBase64(String(data.pub ?? '')); } catch { return; }
      if (pub.length !== 65) return;
      s = { session, seq: 0n, eseq: 0n, live: false, name: '', pub, pair: null, cipher: null, ready: false };
      try {
        s.pair = await pairCipher(this.keys.ecdh.privateKey, pub, this.pairSalt, this.sessionHex, session);
      } catch { return; } // not a valid public key
    } else if (seq <= s.seq) { this.replayed++; return; }
    s.seq = seq;
    s.name = String(data.name ?? '').trim().slice(0, 32) || 'Player';
    s.live = Array.isArray(data.know) && data.know.includes(this.sessionHex);
    this.senders.set(from, s);
    if (isNew) {
      this.sendHello(); // tell the new session that we know it
      // Our sending key, sealed with the pair key: only this session can open it.
      const box = await s.pair.seal(this.keys.sendRaw, context('k', fromHex(this.sessionHex), fromHex(session)));
      this.sendHandshake(from, { netplay: 'key', box: toBase64(box) });
    }
    this.checkReady(s);
  }

  async receiveKey(from, session, seq, data) {
    const s = this.senders.get(from);
    if (!s || s.session !== session || seq <= s.seq) { this.replayed++; return; }
    s.seq = seq;
    const raw = await s.pair.open(fromBase64(String(data.box ?? '')), context('k', fromHex(session), fromHex(this.sessionHex)));
    s.cipher = new RoomCipher(await importAesKey(raw));
    this.checkReady(s);
  }

  checkReady(s) {
    const ready = s.live && Boolean(s.cipher);
    s.ready = ready;
    // Names update; a member that became ready gets the lobby status again (members event).
    this.updateMembers();
  }

  /**
   * Replay check: true when the data comes from a ready session with a new sequence number.
   * @param {number|null} from peer ID (null: find the sender by its session, for Ethernet frames)
   * @param {'seq'|'eseq'} counter control socket or Ethernet port (each has its own numbering)
   */
  accept(from, session, seq, counter) {
    const s = from === null ? this.senderBySession(session) : this.senders.get(from);
    if (!s || !s.ready || s.session !== session || seq <= s[counter]) {
      this.replayed++;
      return false;
    }
    s[counter] = seq;
    return true;
  }

  senderBySession(session) {
    for (const s of this.senders.values()) if (s.session === session) return s;
    return null;
  }

  reset() {
    Object.assign(this, { ws: null, room: '', peer: 0, host: 0, token: '', num: 0, members: [], relayMembers: [], safetyCode: '' });
    this.senders = new Map();
    this.session = crypto.getRandomValues(new Uint8Array(8));
    this.sessionHex = hexOf(this.session);
    this.seq = 0;
  }

  close() {
    const ws = this.ws;
    this.reset();
    if (ws && ws.readyState <= WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'leave' })); } catch { /* closing anyway */ }
      ws.close();
    }
  }
}

/**
 * The network of js-dos 8.5 (option "sharedNet"), backed by the relay instead of js-dos' own
 * WebRTC network. js-dos polls recvBinary() every 16 ms and addresses players by peer ID; the
 * IPX server runs inside the DOSBox of the host, the others connect to the host's peer ID.
 * @param {NetplayClient} client
 */
export function jsdosNet(client) {
  const queue = [];
  const onPacket = (e) => {
    if (queue.length < 1024) queue.push({ peerId: e.detail.from, data: e.detail.data });
  };
  client.addEventListener('packet', onPacket);
  const net = {
    peerId: client.peer,
    connected: new Set(),
    wait() {},
    registerAlias: async () => {},
    unregisterAlias() {},
    // "=host" (or a peer ID) is all that is needed to find the IPX server.
    queryAliases: async (query) => {
      const name = query.replace(/^=/, '');
      const peer = name === 'host' ? client.host : Number(name);
      return peer ? [{ alias: name, peerId: peer }] : [];
    },
    sendBinary(data, peerId) {
      if (!peerId || peerId === client.peer) throw new Error(`Cannot send to self (${peerId})`);
      net.connected.add(peerId);
      return client.sendPacket(peerId, data) ? data.byteLength : 0;
    },
    recvBinary() {
      const packet = queue.shift();
      if (!packet) return null;
      net.connected.add(packet.peerId);
      return packet;
    },
    disconnect(peerId) { net.connected.delete(peerId); },
    shutdown() { client.removeEventListener('packet', onPacket); },
  };
  return net;
}
