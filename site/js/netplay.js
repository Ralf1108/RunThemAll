// Netplay: the browser side of the relay in /netplay (Go). One WebSocket per player carries
// the room handshake (JSON text messages) and the network packets of the emulator (binary
// messages: 4 bytes peer ID, big endian, then the packet). See netplay/README.md.

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
    /** @type {Member[]} */
    this.members = [];
    this.sent = 0;
    this.received = 0;
  }

  get connected() { return this.ws?.readyState === WebSocket.OPEN && this.peer !== 0; }
  get isHost() { return this.peer !== 0 && this.peer === this.host; }

  /**
   * Connects and creates or joins a room.
   * @param {string} relay
   * @param {{type:'create'|'join', room?:string, password?:string, name?:string}} hello
   */
  open(relay, hello) {
    this.close();
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
          // A copy with its own buffer: js-dos hands the buffer on to its worker.
          this.dispatchEvent(new CustomEvent('packet', { detail: { from: view.getUint32(0), data: new Uint8Array(e.data, 4).slice() } }));
          return;
        }
        let msg;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.type === 'error') {
          clearTimeout(timer);
          fail(msg.message || msg.code);
        } else if (msg.type === 'joined') {
          clearTimeout(timer);
          Object.assign(this, { room: msg.room, peer: msg.peer, host: msg.host, token: msg.token });
          settled = true;
          resolve(msg);
        } else if (msg.type === 'members') {
          this.members = msg.members ?? [];
          this.host = msg.host;
          this.dispatchEvent(new CustomEvent('members', { detail: this.members }));
        } else if (msg.type === 'msg') {
          this.dispatchEvent(new CustomEvent('message', { detail: { from: msg.from, data: msg.data } }));
        }
      };
    });
  }

  /** Sends a packet to one member (0: to everybody else). */
  sendPacket(to, data) {
    if (!this.connected) return false;
    const buf = new Uint8Array(4 + data.byteLength);
    new DataView(buf.buffer).setUint32(0, to);
    buf.set(data, 4);
    this.ws.send(buf);
    this.sent += data.byteLength;
    return true;
  }

  /** Sends a small JSON message to one member (0: everybody else). */
  sendMessage(to, data) {
    if (this.connected) this.ws.send(JSON.stringify({ type: 'msg', to, data }));
  }

  reset() {
    Object.assign(this, { ws: null, room: '', peer: 0, host: 0, token: '', members: [] });
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
