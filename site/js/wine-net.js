// Netplay for Windows programs (Boxedwine): a virtual LAN on the level of sockets.
//
// Boxedwine passes Winsock calls on to the socket emulation of Emscripten (SOCKFS in
// boxedwine.js), which would turn every connection into a WebSocket to the target address and
// cannot listen for connections at all. In a netplay room the fetch script's patch of
// boxedwine.js asks `window.runThemAllNet` for the socket operations instead, and this module
// carries TCP and UDP between the players over the relay:
//
// - every player has the address 192.168.78.<number in the room> (/24, like the network Wine sees);
//   the hostname of the browser resolves to it, the names of the players to theirs
// - UDP: datagrams to one player or to all (broadcast .255 or 255.255.255.255)
// - TCP: connect/listen/accept with a small handshake; the relay is reliable and keeps the
//   order, so the data needs no sequence numbers or retransmission
// - 127.x and the own address reach the own sockets (loopback)
// There is no internet: other addresses are refused.

const LAN = '192.168.78.';
const CHUNK = 12 * 1024; // below the relay's message limit
const MAX_QUEUE = 1024; // datagrams waiting in one socket
const BYTES_PER_SECOND = 512 * 1024; // stays below the relay's limit per player (1 MiB/s)

// Packet types (first byte); TCP packets carry a direction and the connection ID.
const UDP = 0x21; // [type][src port u16][dst port u16][data]
const SYN = 0x22; // [type][dir][id u32][src port u16][dst port u16]
const SYNACK = 0x23; // [type][dir][id u32]
const DATA = 0x24; // [type][dir][id u32][data]
const RST = 0x25; // [type][dir][id u32]
const FIN = 0x26; // [type][dir][id u32]
const TO_ACCEPTOR = 0;
const TO_CONNECTOR = 1;

// Emscripten's errno numbers (boxedwine.js ERRNO_CODES).
const EADDRINUSE = 3;
const EAGAIN = 6;
const EALREADY = 7;
const ECONNREFUSED = 14;
const ECONNRESET = 15;
const EDESTADDRREQ = 17;
const EINVAL = 28;
const EISCONN = 30;
const EMSGSIZE = 35;
const ENOTCONN = 53;
const EPIPE = 64;

const POLLIN = 1 | 64; // POLLIN | POLLRDNORM
const POLLOUT = 4;
const POLLHUP = 16;

/** The address of a player in the room. */
export function wineAddress(num) {
  return num ? LAN + num : '0.0.0.0';
}

export class WineNet {
  /** @param {import('./netplay.js').NetplayClient} client */
  constructor(client) {
    this.client = client;
    this.ops = null;
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

  /** Name lookup (DNS.lookup_name): the hostname of the browser and the names of the players. */
  lookupName(name) {
    const lower = String(name).toLowerCase();
    if (lower === 'emscripten' || lower === 'boxedwine') return this.ownAddress;
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

  // --- sending ---------------------------------------------------------------------------

  send(peer, bytes) {
    if (peer === this.client.peer) {
      queueMicrotask(() => this.receive(peer, bytes));
      return;
    }
    if (peer === 0) queueMicrotask(() => this.receive(this.client.peer, bytes)); // broadcast: also here
    this.out.push([peer, bytes]);
    this.pump();
  }

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
  queueData(sock, bytes) {
    const v = sock.vnet;
    v.unsent.push(bytes);
    if (v.flushing) return;
    v.flushing = true;
    queueMicrotask(() => {
      v.flushing = false;
      if (v.state !== 'open') return;
      const total = v.unsent.reduce((n, b) => n + b.length, 0);
      const all = new Uint8Array(total);
      let at = 0;
      for (const b of v.unsent) {
        all.set(b, at);
        at += b.length;
      }
      v.unsent = [];
      for (let i = 0; i < total; i += CHUNK) {
        const part = all.subarray(i, i + CHUNK);
        const buf = this.tcpPacket(DATA, v.dir, v.id, part.length);
        buf.set(part, 6);
        this.send(v.peer, buf);
      }
    });
  }

  // --- receiving -------------------------------------------------------------------------

  receive(from, data) {
    if (data.length < 1) return;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (data[0] === UDP && data.length >= 5) {
      const sock = this.udp.get(view.getUint16(3));
      if (sock && sock.recv_queue.length < MAX_QUEUE) {
        sock.recv_queue.push({ addr: this.addressOf(from), port: view.getUint16(1), data: data.slice(5) });
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
    const sock = this.conns.get(`${dir === TO_ACCEPTOR ? 'a' : 'c'}/${from}/${id}`);
    if (!sock) {
      if (data[0] === DATA) this.send(from, this.tcpPacket(RST, 1 - dir, id));
      return;
    }
    const v = sock.vnet;
    switch (data[0]) {
      case SYNACK:
        if (v.state === 'connecting') {
          v.state = 'open';
          const unsent = v.unsent;
          v.unsent = [];
          for (const b of unsent) this.queueData(sock, b);
        }
        break;
      case DATA:
        sock.recv_queue.push({ addr: sock.daddr, port: sock.dport, data: data.slice(6) });
        break;
      case RST:
        if (v.state === 'connecting') sock.error = ECONNREFUSED;
        else sock.error = ECONNRESET;
        this.closed(sock);
        break;
      case FIN:
        this.closed(sock);
        break;
    }
  }

  incomingConnection(from, id, srcPort, dstPort) {
    const listener = this.tcpPorts.get(dstPort);
    if (!listener || listener.vnet.state !== 'listening' || listener.pending.length >= 64) {
      this.send(from, this.tcpPacket(RST, TO_CONNECTOR, id));
      return;
    }
    const sock = this.SOCKFS.createSocket(2, 1, 6); // AF_INET, SOCK_STREAM, TCP: uses our ops
    sock.vnet = { state: 'open', peer: from, id, dir: TO_CONNECTOR, key: `a/${from}/${id}`, unsent: [] };
    sock.saddr = this.ownAddress;
    sock.sport = dstPort;
    sock.daddr = this.addressOf(from);
    sock.dport = srcPort;
    this.conns.set(sock.vnet.key, sock);
    listener.pending.push(sock);
    this.send(from, this.tcpPacket(SYNACK, TO_CONNECTOR, id));
  }

  /** The connection ended (data already received can still be read, then EOF). */
  closed(sock) {
    sock.vnet.state = 'closed';
    this.conns.delete(sock.vnet.key);
  }

  membersChanged() {
    const present = new Set(this.client.members.map((m) => m.peer));
    for (const sock of [...this.conns.values()]) {
      if (!present.has(sock.vnet.peer)) {
        sock.error = ECONNRESET;
        this.closed(sock);
      }
    }
  }

  // --- the socket operations for SOCKFS --------------------------------------------------

  /**
   * Called by the patched SOCKFS.createSocket for every new socket.
   * @returns {object} sock_ops like SOCKFS.websocket_sock_ops
   */
  sockOps(SOCKFS, FS) {
    if (this.ops) return this.ops;
    this.SOCKFS = SOCKFS;
    const net = this;
    const fail = (errno) => new FS.ErrnoError(errno);
    const state = (sock) => (sock.vnet ??= { state: 'new', unsent: [] });

    // UDP and TCP sockets get a local port on first use if the program did not bind one.
    const autobind = (sock) => {
      if (sock.sport) return;
      const map = sock.type === 2 ? net.udp : net.tcpPorts;
      sock.sport = net.freePort(map);
      sock.saddr ??= '0.0.0.0';
      if (sock.type === 2) map.set(sock.sport, sock);
    };

    this.ops = {
      poll(sock) {
        const v = state(sock);
        if (v.state === 'listening') return sock.pending.length ? POLLIN : 0;
        let mask = 0;
        if (sock.recv_queue.length) mask |= POLLIN;
        if (sock.type === 2) return mask | POLLOUT;
        if (v.state === 'open') mask |= POLLOUT;
        if (v.state === 'closed') mask |= POLLIN | (sock.error === ECONNREFUSED ? POLLOUT : POLLHUP);
        if (v.state === 'new') mask |= POLLOUT;
        return mask;
      },
      ioctl: SOCKFS.websocket_sock_ops.ioctl,
      close(sock) {
        const v = state(sock);
        if (sock.type === 2) {
          if (net.udp.get(sock.sport) === sock) net.udp.delete(sock.sport);
        } else {
          if (net.tcpPorts.get(sock.sport) === sock) net.tcpPorts.delete(sock.sport);
          for (const p of sock.pending) net.ops.close(p);
          if (v.state === 'open' || v.state === 'connecting') net.send(v.peer, net.tcpPacket(FIN, v.dir, v.id));
          if (v.key) net.conns.delete(v.key);
          v.state = 'closed';
        }
        return 0;
      },
      bind(sock, addr, port) {
        if (sock.sport) throw fail(EINVAL); // already bound
        const map = sock.type === 2 ? net.udp : net.tcpPorts;
        if (!port) port = net.freePort(map);
        else if (map.has(port)) throw fail(EADDRINUSE);
        sock.saddr = addr;
        sock.sport = port;
        map.set(port, sock);
      },
      connect(sock, addr, port) {
        const v = state(sock);
        if (sock.type === 2) {
          autobind(sock);
          sock.daddr = addr;
          sock.dport = port;
          return;
        }
        if (v.state === 'connecting') throw fail(EALREADY);
        if (v.state === 'open') throw fail(EISCONN);
        const peer = net.peerOf(addr);
        if (!peer) throw fail(ECONNREFUSED); // not in the room (no internet), or broadcast
        autobind(sock);
        const id = crypto.getRandomValues(new Uint32Array(1))[0];
        Object.assign(v, { state: 'connecting', peer, id, dir: TO_ACCEPTOR, key: `c/${peer}/${id}` });
        net.conns.set(v.key, sock);
        sock.daddr = addr;
        sock.dport = port;
        const syn = net.tcpPacket(SYN, TO_ACCEPTOR, id, 4);
        new DataView(syn.buffer).setUint16(6, sock.sport);
        new DataView(syn.buffer).setUint16(8, port);
        net.send(peer, syn);
        // Like Emscripten's own sockets: report success now, data waits until the other side accepts.
      },
      listen(sock) {
        if (sock.type !== 1) throw fail(EINVAL);
        if (!sock.sport) {
          sock.sport = net.freePort(net.tcpPorts);
          net.tcpPorts.set(sock.sport, sock);
        }
        state(sock).state = 'listening';
        sock.server = true; // SOCKFS: no recv() on a listening socket
      },
      accept(sock) {
        if (state(sock).state !== 'listening') throw fail(EINVAL);
        if (!sock.pending.length) throw fail(EAGAIN);
        const newsock = sock.pending.shift();
        newsock.stream.flags = sock.stream.flags;
        return newsock;
      },
      getname(sock, peer) {
        if (peer) {
          if (sock.daddr === undefined) throw fail(ENOTCONN);
          return { addr: sock.daddr, port: sock.dport };
        }
        let addr = sock.saddr || '0.0.0.0';
        if (addr === '0.0.0.0' && sock.daddr !== undefined) addr = net.ownAddress;
        return { addr, port: sock.sport || 0 };
      },
      sendmsg(sock, buffer, offset, length, addr, port) {
        const v = state(sock);
        const bytes = new Uint8Array(buffer.buffer ?? buffer, (buffer.byteOffset ?? 0) + offset, length).slice();
        if (sock.type === 2) {
          if (addr === undefined || port === undefined) {
            addr = sock.daddr;
            port = sock.dport;
          }
          if (addr === undefined) throw fail(EDESTADDRREQ);
          if (length > CHUNK) throw fail(EMSGSIZE);
          autobind(sock);
          const peer = net.peerOf(addr);
          if (peer === null) return length; // outside the LAN: lost, like on a network without a router
          const buf = new Uint8Array(5 + length);
          buf[0] = UDP;
          new DataView(buf.buffer).setUint16(1, sock.sport);
          new DataView(buf.buffer).setUint16(3, port);
          buf.set(bytes, 5);
          net.send(peer, buf);
          return length;
        }
        if (v.state === 'closed') throw fail(EPIPE);
        if (v.state !== 'open' && v.state !== 'connecting') throw fail(ENOTCONN);
        if (v.state === 'connecting') v.unsent.push(bytes);
        else net.queueData(sock, bytes);
        return length;
      },
      recvmsg(sock, length) {
        const v = state(sock);
        if (v.state === 'listening') throw fail(ENOTCONN);
        const queued = sock.recv_queue.shift();
        if (!queued) {
          if (sock.type === 1 && v.state === 'closed') return null; // EOF
          if (sock.type === 1 && v.state === 'new') throw fail(ENOTCONN);
          throw fail(EAGAIN);
        }
        const n = Math.min(length, queued.data.length);
        if (sock.type === 1 && n < queued.data.length) {
          sock.recv_queue.unshift({ ...queued, data: queued.data.subarray(n) });
        }
        return { buffer: queued.data.subarray(0, n), addr: queued.addr, port: queued.port };
      },
    };
    return this.ops;
  }

  close() {
    this.client.removeEventListener('packet', this.onPacket);
    this.client.removeEventListener('members', this.onMembers);
  }
}
