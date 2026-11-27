// Netplay for Windows programs (Boxedwine): a virtual LAN on the level of sockets.
//
// Boxedwine's web build passes the guest's TCP and UDP sockets to a "transport" object in
// Module.boxedwineNetworking (project/emscripten/boxedwine-net.js in Boxedwine). Without one,
// it uses a WebSocket gateway server. In a netplay room this module is the transport and
// carries TCP and UDP between the players over the relay:
//
// - every player has the address 192.168.78.<number in the room> (/24); Boxedwine shows it as
//   the address of eth0 (transport.virtualIp)
// - UDP: datagrams to one player or to all (broadcast .255 or 255.255.255.255)
// - TCP: connect/listen/accept with a small handshake; the relay is reliable and keeps the
//   order, so the data needs no sequence numbers or retransmission
// - 127.x and the own address reach the own sockets (loopback)
// - DNS (UDP port 53, any server): the names of the players and the own hostname resolve to
//   their addresses; other names do not exist
// There is no internet: other addresses are refused.
//
// The transport runs on the page's main thread (Boxedwine proxies the calls from its workers).
// It uses BoxedWineNetwork, HEAPU8 and growMemViews of boxedwine.js, which are globals.

const LAN = '192.168.78.';
const CHUNK = 12 * 1024; // below the relay's message limit
const MAX_QUEUE = 1024; // datagrams waiting in one socket
const BYTES_PER_SECOND = 512 * 1024; // stays below the relay's limit per player (1 MiB/s)
const OWN_NAMES = ['boxedwine', 'box', 'localhost'];

// Packet types (first byte); TCP packets carry a direction and the connection ID.
const UDP = 0x21; // [type][src port u16][dst port u16][data]
const SYN = 0x22; // [type][dir][id u32][src port u16][dst port u16]
const SYNACK = 0x23; // [type][dir][id u32]
const DATA = 0x24; // [type][dir][id u32][data]
const RST = 0x25; // [type][dir][id u32]
const FIN = 0x26; // [type][dir][id u32]
const TO_ACCEPTOR = 0;
const TO_CONNECTOR = 1;

// Linux errno values (Boxedwine passes them on to the guest).
const EAGAIN = 11;
const EINVAL = 22;
const EMSGSIZE = 90;
const EDESTADDRREQ = 89;
const EAFNOSUPPORT = 97;
const EADDRINUSE = 98;
const ECONNRESET = 104;
const EISCONN = 106;
const ENOTCONN = 107;
const ESHUTDOWN = 108;
const ECONNREFUSED = 111;
const EALREADY = 114;
const EINPROGRESS = 115;
const EPIPE = 32;

const POLLIN = 0x1;
const POLLOUT = 0x4;
const POLLERR = 0x8;
const POLLHUP = 0x10;
const MSG_PEEK = 0x2;

/** The address of a player in the room. */
export function wineAddress(num) {
  return num ? LAN + num : '0.0.0.0';
}

/** Boxedwine's IPv4 numbers: the first part of the address in the lowest byte. */
export function ipv4ToString(n) {
  return [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255].join('.');
}
export function ipv4FromString(s) {
  const p = String(s).split('.').map(Number);
  return p.length === 4 ? ((p[0] | (p[1] << 8) | (p[2] << 16) | (p[3] << 24)) >>> 0) : 0;
}

export class WineNet {
  /** @param {import('./netplay.js').NetplayClient} client */
  constructor(client) {
    this.client = client;
    this.sockets = new Map(); // handle -> socket
    this.udp = new Map(); // port -> socket
    this.tcpPorts = new Map(); // port -> socket (bound or listening)
    this.conns = new Map(); // "c|a/peer/id" -> socket
    this.nextPort = 49152;
    this.out = []; // [peer, bytes] waiting for the byte budget
    this.budget = BYTES_PER_SECOND;
    this.lastRefill = performance.now();
    this.timer = 0;
    this.onPacket = (e) => this.receive(e.detail.from, e.detail.data);
    this.onMembers = () => this.membersChanged();
    client.addEventListener('packet', this.onPacket);
    client.addEventListener('members', this.onMembers);
  }

  get ownAddress() { return wineAddress(this.client.num); }

  /** Read by Boxedwine (bw_net_get_room_ipv4) as the address of eth0. */
  get virtualIp() { return this.ownAddress; }

  addressOf(peer) {
    if (peer === this.client.peer) return this.ownAddress;
    return wineAddress(this.client.members.find((m) => m.peer === peer)?.num);
  }

  /** The peer behind an address, the own peer for loopback, 0 for broadcast, null if unknown. */
  peerOf(addr) {
    if (addr === this.ownAddress || addr.startsWith('127.') || addr === '0.0.0.0') return this.client.peer;
    if (addr === '255.255.255.255' || addr === `${LAN}255`) return 0;
    if (!addr.startsWith(LAN)) return null;
    return this.client.members.find((m) => wineAddress(m.num) === addr)?.peer ?? null;
  }

  /** Name lookup: the own hostname and the names of the players. */
  lookupName(name) {
    const lower = String(name).toLowerCase().replace(/\.$/, '');
    if (OWN_NAMES.includes(lower)) return lower === 'localhost' ? '127.0.0.1' : this.ownAddress;
    const m = this.client.members.find((p) => p.name.toLowerCase() === lower);
    return m ? wineAddress(m.num) : null;
  }

  freePort(map) {
    for (let i = 0; i < 16384; i++) {
      const port = this.nextPort;
      this.nextPort = this.nextPort >= 65535 ? 49152 : this.nextPort + 1;
      if (!map.has(port)) return port;
    }
    return 0;
  }

  // --- Boxedwine's state of a socket -----------------------------------------------------

  events(s) {
    let ev = 0;
    if (s.error) ev |= POLLERR;
    if (s.rx.length || s.pending.length || s.state === 'closed') ev |= POLLIN;
    if (s.kind === 'udp' || (s.state === 'open' && !s.outClosed)) ev |= POLLOUT;
    if (s.kind === 'tcp' && s.state === 'closed') ev |= POLLHUP;
    return ev;
  }

  /** Tells Boxedwine that the state changed (wakes up poll, select and blocking calls). */
  notify(s) {
    if (!s.handle) return;
    const ev = this.events(s);
    globalThis.BoxedWineNetwork?.setEvents(s.handle, ev, s.rxBytes);
  }

  newSocket(kind, handle = 0) {
    return {
      handle, kind, state: kind === 'udp' ? 'open' : 'new', rx: [], rxBytes: 0, error: 0,
      localPort: 0, localIpv4: 0, peerIpv4: 0, peerPort: 0, pending: [], unsent: [],
      outClosed: false, lastRecvIpv4: 0, lastRecvPort: 0,
    };
  }

  /** UDP and TCP sockets get a local port on first use if the program did not bind one. */
  autobind(s) {
    if (s.localPort) return;
    const map = s.kind === 'udp' ? this.udp : this.tcpPorts;
    s.localPort = this.freePort(map);
    if (s.kind === 'udp') map.set(s.localPort, s);
  }

  // --- sending ---------------------------------------------------------------------------

  /** Sends what the byte budget allows; the rest a little later (the relay drops excess). */
  pump() {
    const now = performance.now();
    this.budget = Math.min(BYTES_PER_SECOND, this.budget + (now - this.lastRefill) * BYTES_PER_SECOND / 1000);
    this.lastRefill = now;
    while (this.out.length && this.budget > 0) {
      const [peer, bytes] = this.out.shift();
      this.budget -= bytes.length;
      this.client.sendPacket(peer, bytes);
    }
    if (this.out.length && !this.timer) {
      this.timer = setTimeout(() => {
        this.timer = 0;
        this.pump();
      }, 20);
    }
  }

  tcpPacket(type, dir, id, extra = 0) {
    const buf = new Uint8Array(6 + extra);
    buf[0] = type;
    buf[1] = dir;
    new DataView(buf.buffer).setUint32(2, id);
    return buf;
  }

  /** TCP data: writes in the same task go out together, in chunks below the message limit. */
  queueData(s, bytes) {
    s.unsent.push(bytes);
    if (s.flushing) return;
    s.flushing = true;
    queueMicrotask(() => {
      s.flushing = false;
      if (s.state !== 'open') return;
      const total = s.unsent.reduce((n, b) => n + b.length, 0);
      const all = new Uint8Array(total);
      let at = 0;
      for (const b of s.unsent) {
        all.set(b, at);
        at += b.length;
      }
      s.unsent = [];
      for (let i = 0; i < total; i += CHUNK) {
        const part = all.subarray(i, i + CHUNK);
        const buf = this.tcpPacket(DATA, s.dir, s.id, part.length);
        buf.set(part, 6);
        this.sendRaw(s.peer, buf);
      }
    });
  }

  // --- receiving -------------------------------------------------------------------------

  receive(from, data) {
    if (data.length < 1) return;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data[0] === UDP && data.length >= 5) {
      const s = this.udp.get(view.getUint16(3));
      if (s && s.rx.length < MAX_QUEUE) {
        this.deliverUdp(s, ipv4FromString(this.addressOf(from)), view.getUint16(1), data.slice(5));
      }
      return;
    }
    if (data[0] < SYN || data[0] > FIN || data.length < 6) return;
    const dir = data[1];
    const id = view.getUint32(2);
    if (data[0] === SYN) {
      this.incomingConnection(from, id, view.getUint16(6), view.getUint16(8));
      return;
    }
    // The packet goes to the end named by dir; our socket for it is stored under that role.
    const s = this.conns.get(`${dir === TO_ACCEPTOR ? 'a' : 'c'}/${from}/${id}`);
    if (!s) {
      if (data[0] === DATA) this.sendRaw(from, this.tcpPacket(RST, 1 - dir, id));
      return;
    }
    switch (data[0]) {
      case SYNACK:
        if (s.state === 'connecting') {
          s.state = 'open';
          const unsent = s.unsent;
          s.unsent = [];
          for (const b of unsent) this.queueData(s, b);
        }
        break;
      case DATA: {
        const bytes = data.slice(6);
        s.rx.push(bytes);
        s.rxBytes += bytes.length;
        break;
      }
      case RST:
        s.error = s.state === 'connecting' ? ECONNREFUSED : ECONNRESET;
        this.closed(s);
        break;
      case FIN:
        this.closed(s);
        break;
    }
    this.notify(s);
  }

  deliverUdp(s, ipv4, port, bytes) {
    s.rx.push({ ipv4, port, data: bytes });
    s.rxBytes += bytes.length;
    this.notify(s);
  }

  incomingConnection(from, id, srcPort, dstPort) {
    const listener = this.tcpPorts.get(dstPort);
    if (!listener || listener.state !== 'listening' || listener.pending.length >= 64) {
      this.sendRaw(from, this.tcpPacket(RST, TO_CONNECTOR, id));
      return;
    }
    // The socket gets its handle when the program accepts it; data can arrive before.
    const s = this.newSocket('tcp');
    Object.assign(s, {
      state: 'open', peer: from, id, dir: TO_CONNECTOR, key: `a/${from}/${id}`,
      localIpv4: ipv4FromString(this.ownAddress), localPort: dstPort,
      peerIpv4: ipv4FromString(this.addressOf(from)), peerPort: srcPort,
    });
    this.conns.set(s.key, s);
    listener.pending.push(s);
    this.sendRaw(from, this.tcpPacket(SYNACK, TO_CONNECTOR, id));
    this.notify(listener);
  }

  /** The connection ended (data already received can still be read, then EOF). */
  closed(s) {
    s.state = 'closed';
    this.conns.delete(s.key);
  }

  membersChanged() {
    const present = new Set(this.client.members.map((m) => m.peer));
    for (const s of [...this.conns.values()]) {
      if (!present.has(s.peer)) {
        s.error = ECONNRESET;
        this.closed(s);
        this.notify(s);
      }
    }
  }

  /** Answers a DNS query (A records) from lookupName; other questions get "no such name". */
  dnsAnswer(query) {
    if (query.length < 12) return null;
    let at = 12;
    const labels = [];
    while (at < query.length && query[at]) {
      const n = query[at];
      labels.push(new TextDecoder().decode(query.subarray(at + 1, at + 1 + n)));
      at += 1 + n;
    }
    const qEnd = at + 5; // zero byte, type, class
    if (qEnd > query.length) return null;
    const qtype = (query[at + 1] << 8) | query[at + 2];
    const addr = this.lookupName(labels.join('.'));
    const answer = addr && qtype === 1;
    const out = new Uint8Array(qEnd + (answer ? 16 : 0));
    out.set(query.subarray(0, qEnd));
    out[2] = 0x81 | (query[2] & 0x01); // response, recursion desired as asked
    out[3] = answer || addr ? 0x80 : 0x83; // recursion available; NXDOMAIN if the name is unknown
    out.set([0, 1, 0, answer ? 1 : 0, 0, 0, 0, 0], 4);
    if (answer) {
      out.set([0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, ...addr.split('.').map(Number)], qEnd);
    }
    return out;
  }

  // --- heap access -----------------------------------------------------------------------

  copyFromHeap(ptr, len) {
    globalThis.growMemViews?.();
    return globalThis.HEAPU8.slice(ptr, ptr + len);
  }

  copyToHeap(ptr, bytes) {
    globalThis.growMemViews?.();
    globalThis.HEAPU8.set(bytes, ptr);
  }

  // --- the transport (called by boxedwine-net.js) ----------------------------------------

  /** Module.boxedwineNetworking for boxedwine.js. */
  get networking() {
    return { enabled: true, transport: this };
  }

  getSocket(handle) { return this.sockets.get(handle) ?? null; }

  socket(domain, type) {
    if (type !== 1 && type !== 2) return -EAFNOSUPPORT;
    const handle = globalThis.BoxedWineNetwork.allocateSocket(domain, type, 0);
    const s = this.newSocket(type === 2 ? 'udp' : 'tcp', handle);
    this.sockets.set(handle, s);
    if (s.kind === 'udp') this.autobind(s);
    this.notify(s);
    return handle;
  }

  close(handle) {
    const s = this.sockets.get(handle);
    if (!s) return 0;
    this.sockets.delete(handle);
    if (s.kind === 'udp') {
      if (this.udp.get(s.localPort) === s) this.udp.delete(s.localPort);
      return 0;
    }
    if (this.tcpPorts.get(s.localPort) === s) this.tcpPorts.delete(s.localPort);
    for (const p of s.pending) {
      this.sendRaw(p.peer, this.tcpPacket(FIN, p.dir, p.id));
      this.conns.delete(p.key);
    }
    if (s.state === 'open' || s.state === 'connecting') this.sendRaw(s.peer, this.tcpPacket(FIN, s.dir, s.id));
    if (s.key) this.conns.delete(s.key);
    s.state = 'closed';
    return 0;
  }

  bind(handle, ipv4, port) {
    const s = this.sockets.get(handle);
    if (!s) return -EAFNOSUPPORT;
    const map = s.kind === 'udp' ? this.udp : this.tcpPorts;
    if (s.localPort && map.get(s.localPort) === s) map.delete(s.localPort);
    if (!port) port = this.freePort(map);
    else if (map.has(port)) return -EADDRINUSE;
    s.localIpv4 = ipv4 >>> 0;
    s.localPort = port;
    map.set(port, s);
    if (s.kind === 'tcp') s.state = 'bound';
    this.notify(s);
    return 0;
  }

  listen(handle) {
    const s = this.sockets.get(handle);
    if (!s || s.kind !== 'tcp') return -EAFNOSUPPORT;
    if (!s.localPort) {
      s.localPort = this.freePort(this.tcpPorts);
      this.tcpPorts.set(s.localPort, s);
    }
    s.state = 'listening';
    this.notify(s);
    return 0;
  }

  accept(handle) {
    const listener = this.sockets.get(handle);
    if (!listener || listener.state !== 'listening') return -EINVAL;
    const s = listener.pending.shift();
    if (!s) return -EAGAIN;
    s.handle = globalThis.BoxedWineNetwork.allocateSocket(2, 1, 0);
    this.sockets.set(s.handle, s);
    this.notify(listener);
    this.notify(s);
    return s.handle;
  }

  connect(handle, ipv4, port) {
    const s = this.sockets.get(handle);
    if (!s) return -ENOTCONN;
    const addr = ipv4ToString(ipv4);
    if (s.kind === 'udp') {
      this.autobind(s);
      s.peerIpv4 = ipv4 >>> 0;
      s.peerPort = port;
      return 0;
    }
    if (s.state === 'open') return s.peerIpv4 === (ipv4 >>> 0) ? 0 : -EISCONN;
    if (s.state === 'connecting') return -EALREADY;
    if (s.state === 'closed' || s.error) return -(s.error || ECONNREFUSED);
    const peer = this.peerOf(addr);
    if (!peer) { // not in the room (no internet), or broadcast
      s.error = ECONNREFUSED;
      s.state = 'closed';
      this.notify(s);
      return -ECONNREFUSED;
    }
    this.autobind(s);
    const id = crypto.getRandomValues(new Uint32Array(1))[0];
    Object.assign(s, {
      state: 'connecting', peer, id, dir: TO_ACCEPTOR, key: `c/${peer}/${id}`,
      peerIpv4: ipv4 >>> 0, peerPort: port, localIpv4: ipv4FromString(this.ownAddress),
    });
    this.conns.set(s.key, s);
    const syn = this.tcpPacket(SYN, TO_ACCEPTOR, id, 4);
    new DataView(syn.buffer).setUint16(6, s.localPort);
    new DataView(syn.buffer).setUint16(8, port);
    this.sendRaw(peer, syn);
    this.notify(s);
    return -EINPROGRESS;
  }

  send(handle, buffer, len, flags, ipv4, port) {
    const s = this.sockets.get(handle);
    if (!s) return -ENOTCONN;
    const bytes = this.copyFromHeap(buffer, len);
    if (s.kind === 'udp') {
      if (!ipv4 || !port) {
        ipv4 = s.peerIpv4;
        port = s.peerPort;
      }
      if (!ipv4 || !port) return -EDESTADDRREQ;
      if (len > CHUNK) return -EMSGSIZE;
      this.autobind(s);
      const addr = ipv4ToString(ipv4);
      if (port === 53 && !addr.startsWith(LAN)) { // DNS: answered here
        const reply = this.dnsAnswer(bytes);
        if (reply) queueMicrotask(() => this.deliverUdp(s, ipv4 >>> 0, 53, reply));
        return len;
      }
      const peer = this.peerOf(addr);
      if (peer === null) return len; // outside the LAN: lost, like on a network without a router
      const buf = new Uint8Array(5 + len);
      buf[0] = UDP;
      new DataView(buf.buffer).setUint16(1, s.localPort);
      new DataView(buf.buffer).setUint16(3, port);
      buf.set(bytes, 5);
      this.sendRaw(peer, buf);
      return len;
    }
    if (s.error) return -s.error;
    if (s.outClosed) return -ESHUTDOWN;
    if (s.state === 'closed') return -EPIPE;
    if (s.state === 'connecting') return -EAGAIN;
    if (s.state !== 'open') return -ENOTCONN;
    this.queueData(s, bytes);
    return len;
  }

  recv(handle, buffer, len, flags) {
    const s = this.sockets.get(handle);
    if (!s) return -ENOTCONN;
    const peek = (flags & MSG_PEEK) !== 0;
    if (s.kind === 'udp') {
      const d = s.rx[0];
      if (!d) return -EAGAIN;
      const n = Math.min(d.data.length, len);
      s.lastRecvIpv4 = d.ipv4;
      s.lastRecvPort = d.port;
      if (n) this.copyToHeap(buffer, d.data.subarray(0, n));
      if (!peek) {
        s.rx.shift();
        s.rxBytes -= d.data.length;
      }
      this.notify(s);
      return n;
    }
    if (!s.rxBytes) {
      if (s.error) return -s.error;
      if (s.state === 'closed') return 0; // EOF
      if (s.state !== 'open' && s.state !== 'connecting') return -ENOTCONN;
      return -EAGAIN;
    }
    let written = 0;
    for (let i = 0; i < s.rx.length && written < len;) {
      const chunk = s.rx[i];
      const n = Math.min(chunk.length, len - written);
      this.copyToHeap(buffer + written, chunk.subarray(0, n));
      written += n;
      if (peek) {
        i++;
      } else if (n === chunk.length) {
        s.rx.shift();
      } else {
        s.rx[0] = chunk.subarray(n);
      }
    }
    if (!peek) s.rxBytes -= written;
    this.notify(s);
    return written;
  }

  shutdown(handle, how) {
    const s = this.sockets.get(handle);
    if (!s) return -ENOTCONN;
    if (how < 0 || how > 2) return -EINVAL;
    if ((how === 1 || how === 2) && s.kind === 'tcp' && !s.outClosed) {
      s.outClosed = true;
      if (s.state === 'open') this.sendRaw(s.peer, this.tcpPacket(FIN, s.dir, s.id));
    }
    this.notify(s);
    return 0;
  }

  getEvents(handle) {
    const s = this.sockets.get(handle);
    return s ? this.events(s) : POLLHUP;
  }

  getError(handle) { return this.sockets.get(handle)?.error ?? ECONNRESET; }

  readableBytes(handle) {
    const s = this.sockets.get(handle);
    if (!s) return 0;
    return s.kind === 'udp' ? (s.rx[0]?.data.length ?? 0) : s.rxBytes;
  }

  getPeerIpv4(handle) { return this.sockets.get(handle)?.peerIpv4 ?? 0; }

  getPeerPort(handle) { return this.sockets.get(handle)?.peerPort ?? 0; }

  getLocalIpv4(handle) {
    const s = this.sockets.get(handle);
    if (!s) return 0;
    if (!s.localIpv4 && (s.state === 'open' || s.state === 'connecting')) return ipv4FromString(this.ownAddress);
    return s.localIpv4;
  }

  getLocalPort(handle) { return this.sockets.get(handle)?.localPort ?? 0; }

  setsockopt() { return 0; }

  /** Sends bytes to a peer (the transport's send() is the socket call). */
  sendRaw(peer, bytes) {
    if (peer === this.client.peer) {
      queueMicrotask(() => this.receive(peer, bytes));
      return;
    }
    if (peer === 0) queueMicrotask(() => this.receive(this.client.peer, bytes)); // broadcast: also here
    this.out.push([peer, bytes]);
    this.pump();
  }

  /** Stops listening to the room. */
  dispose() {
    this.client.removeEventListener('packet', this.onPacket);
    this.client.removeEventListener('members', this.onMembers);
  }
}
