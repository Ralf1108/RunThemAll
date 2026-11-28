// Netplay: the browser side of the relay in /netplay (Go). One WebSocket per player carries
// the room handshake (JSON text messages) and the network packets of the emulator (binary
// messages: 4 bytes peer ID, big endian, then the packet). See netplay/README.md.
// With a room cipher (netcrypt.js) packets, messages and player names are end-to-end encrypted:
// the relay only sees sealed bytes.

import { context, fromBase64, toBase64 } from './netcrypt.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
/** Sealed data starts with receiver (4 bytes), session (8) and sequence number (8). */
const SEALED_HEAD = 20;
const hexOf = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

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
    this.sent = 0;
    this.received = 0;
    /** @type {import('./netcrypt.js').RoomCipher|null} */
    this.cipher = null;
    this.name = '';
    this.relayMembers = [];
    /** Encrypted rooms, what we know of the other members: peer -> {session, seq, eseq, live, name}. */
    this.senders = new Map();
    this.session = new Uint8Array(8); // own session, new for every connection (reset)
    this.sessionHex = '';
    this.seq = 0;
    // Sealing and opening run in parallel, sending and handing on keep the order.
    this.tx = Promise.resolve();
    this.rx = Promise.resolve();
    this.rejected = 0; // messages that could not be opened (other key or changed on the way)
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
   * @param {{cipher?:import('./netcrypt.js').RoomCipher, room?:string, name?:string}} [secure]
   *   encrypted room: hello carries only the room ID and password check; the room name and the
   *   player name stay in the browser (the name goes to the members encrypted)
   */
  open(relay, hello, secure = {}) {
    this.close();
    this.cipher = secure.cipher ?? null;
    this.name = secure.name ?? hello.name ?? '';
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
          this.receiveSealed(ws, from, 'p', new Uint8Array(e.data, 4), (data) => {
            this.dispatchEvent(new CustomEvent('packet', { detail: { from, data } }));
          });
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
            // Somebody new: introduce ourselves (name and session, see sendHello).
            if (this.relayMembers.some((m) => !before.has(m.peer))) this.sendHello();
          }
          this.updateMembers();
        } else if (msg.type === 'msg') {
          if (!this.cipher) {
            this.dispatchEvent(new CustomEvent('message', { detail: { from: msg.from, data: msg.data } }));
            return;
          }
          if (typeof msg.data !== 'string') return; // not sealed: not from a member of this room
          let sealed;
          try { sealed = fromBase64(msg.data); } catch { return; }
          this.receiveSealed(ws, msg.from, 'm', sealed, (data) => {
            this.dispatchEvent(new CustomEvent('message', { detail: { from: msg.from, data } }));
          });
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
    this.sendSealed('p', to, data, (sealed) => {
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
    else this.sendSealed('m', to, enc.encode(JSON.stringify(data)), (sealed) => JSON.stringify({ type: 'msg', to, data: toBase64(sealed) }));
  }

  /** The members with their own names (encrypted rooms: from their name messages). */
  updateMembers() {
    this.members = !this.cipher ? this.relayMembers : this.relayMembers.map((m) => ({
      ...m, name: m.peer === this.peer ? this.name || 'Player' : this.senders.get(m.peer)?.name ?? `Player ${m.num ?? ''}`.trim(),
    }));
    this.dispatchEvent(new CustomEvent('members', { detail: this.members }));
  }

  // Replay protection (encrypted rooms). Every sealed packet and message starts with
  //   [4 bytes receiver][8 bytes session][8 bytes sequence number]
  // The session is random per connection, the sequence number counts up per session. A receiver
  // takes data only from a sender whose session it knows and only with a higher number than the
  // last one: the relay can neither send a packet again nor replay a recorded older session.
  // Sessions are learned from hello messages ({netplay:'hello', name, know:[sessions]}), and a
  // sender only counts once its hello lists the receiver's own (fresh, random) session: an old
  // recording cannot contain it. Everybody sends a hello when somebody new joins and when it
  // learns a new session, so all members know each other after two rounds.

  /** Introduces this player: name, and the sessions it knows (proof that it is live). */
  sendHello() {
    const know = [...this.senders.values()].map((s) => s.session);
    this.sendMessage(0, { netplay: 'hello', name: this.name, know });
  }

  /** Seals [receiver][session][sequence][data] now and sends it in the order of the calls. */
  sendSealed(kind, to, data, wrap) {
    const ws = this.ws;
    const plain = new Uint8Array(SEALED_HEAD + data.byteLength);
    const view = new DataView(plain.buffer);
    view.setUint32(0, to);
    plain.set(this.session, 4);
    view.setBigUint64(12, BigInt(++this.seq));
    plain.set(data, SEALED_HEAD);
    const sealed = this.cipher.seal(plain, context(kind, this.peer));
    this.tx = this.tx.then(() => sealed).then((s) => {
      if (this.ws === ws && ws.readyState === WebSocket.OPEN) ws.send(wrap(s));
    }).catch(() => {});
  }

  /** Opens a sealed packet or message of `from` and hands its data on, in the order received. */
  receiveSealed(ws, from, kind, sealed, deliver) {
    const opened = this.cipher.open(sealed.slice(), context(kind, from));
    this.rx = this.rx.then(() => opened).then((plain) => {
      if (this.ws !== ws || plain.length < SEALED_HEAD) return;
      const view = new DataView(plain.buffer, plain.byteOffset);
      const to = view.getUint32(0);
      if (to !== 0 && to !== this.peer) return; // meant for somebody else
      const session = hexOf(plain.subarray(4, 12));
      const seq = view.getBigUint64(12);
      const body = plain.slice(SEALED_HEAD); // own buffer: js-dos hands it on to its worker
      if (kind === 'm') {
        let data;
        try { data = JSON.parse(dec.decode(body)); } catch { return; }
        if (data?.netplay === 'hello') {
          this.receiveHello(from, session, seq, data);
          return;
        }
        if (this.accept(from, session, seq, 'seq')) deliver(data);
      } else if (this.accept(from, session, seq, 'seq')) deliver(body);
    }, () => { this.rejected++; });
  }

  receiveHello(from, session, seq, data) {
    let s = this.senders.get(from);
    if (s?.live && s.session !== session) { this.replayed++; return; } // an old hello of a live member
    const isNew = !s || s.session !== session;
    if (isNew) s = { session, seq: 0n, eseq: 0n, live: false, name: '' };
    else if (seq <= s.seq) { this.replayed++; return; }
    s.seq = seq;
    s.name = String(data.name ?? '').trim().slice(0, 32) || 'Player';
    const wasLive = s.live;
    s.live = Array.isArray(data.know) && data.know.includes(this.sessionHex);
    this.senders.set(from, s);
    if (isNew) this.sendHello(); // tell the new session that we know it
    if (s.live !== wasLive || isNew) this.updateMembers();
  }

  /**
   * Replay check: true when the data comes from a live session with a new sequence number.
   * @param {number|null} from peer ID (null: find the sender by its session, for Ethernet frames)
   * @param {'seq'|'eseq'} counter control socket or Ethernet port (each has its own numbering)
   */
  accept(from, session, seq, counter) {
    const s = from === null ? [...this.senders.values()].find((x) => x.session === session) : this.senders.get(from);
    if (!s || !s.live || s.session !== session || seq <= s[counter]) {
      this.replayed++;
      return false;
    }
    s[counter] = seq;
    return true;
  }

  reset() {
    Object.assign(this, { ws: null, room: '', peer: 0, host: 0, token: '', num: 0, members: [], relayMembers: [] });
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
