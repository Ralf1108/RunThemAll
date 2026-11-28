// The network card of a PC (v86) in an encrypted multiplayer room. v86 hands every Ethernet
// frame to us ("net0-send") instead of talking to the relay itself; the frames go over the
// player's Ethernet port of the relay (/v1/eth), sealed with the room key (netcrypt.js).
// Only the two MAC addresses stay readable, the relay switches by them; type and content of
// every frame are encrypted.
//
// Because the relay cannot read the frames, it cannot hand out addresses either: every browser
// answers DHCP (and ARP for the server address) of its own PC. The address comes from the
// player's number in the room, so the PCs of a room never get the same one:
// 192.168.77.<9 + number>/24, the virtual server is 192.168.77.1 (like the relay's own DHCP).

import { context } from './netcrypt.js';
import { ethernetUrl } from './netplay.js';

const SERVER_MAC = [0x02, 0x52, 0x54, 0x41, 0x00, 0x01];
const NET = [192, 168, 77];
const SERVER_IP = [...NET, 1];
const LEASE_SECONDS = 24 * 60 * 60;

export class SealedEthernet {
  /**
   * @param {{add_listener:Function, bus:{send:Function}}} emulator v86
   * @param {import('./netplay.js').NetplayClient} client in a room with a cipher
   */
  constructor(emulator, client) {
    this.emulator = emulator;
    this.client = client;
    this.cipher = client.cipher;
    this.address = [...NET, 9 + Math.max(1, client.num)];
    this.waiting = []; // frames before the port is open
    this.tx = Promise.resolve();
    this.rx = Promise.resolve();
    this.ws = new WebSocket(ethernetUrl(client.relay, client.token));
    this.ws.binaryType = 'arraybuffer';
    this.ws.onopen = () => { for (const f of this.waiting.splice(0)) this.ws.send(f); };
    this.ws.onmessage = (e) => this.receive(new Uint8Array(e.data));
    emulator.add_listener('net0-send', (frame) => this.send(new Uint8Array(frame)));
  }

  get addressText() { return this.address.join('.'); }

  send(frame) {
    if (frame.length < 14) return;
    const reply = this.answerLocally(frame);
    if (reply !== undefined) {
      if (reply) setTimeout(() => this.emulator.bus.send('net0-receive', reply), 0);
      return;
    }
    const header = frame.slice(0, 12);
    const sealed = this.cipher.seal(frame.slice(12), context('e', header));
    this.tx = this.tx.then(() => sealed).then((s) => {
      const out = new Uint8Array(12 + s.length);
      out.set(header);
      out.set(s, 12);
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(out);
      else if (this.ws.readyState === WebSocket.CONNECTING && this.waiting.length < 64) this.waiting.push(out);
    }).catch(() => {});
  }

  receive(data) {
    if (data.length < 12) return;
    const header = data.slice(0, 12);
    const opened = this.cipher.open(data.slice(12), context('e', header));
    this.rx = this.rx.then(() => opened).then((rest) => {
      const frame = new Uint8Array(12 + rest.length);
      frame.set(header);
      frame.set(rest, 12);
      this.emulator.bus.send('net0-receive', frame);
    }, () => { /* not sealed with the room key: dropped */ });
  }

  close() {
    this.ws.close();
  }

  /**
   * DHCP and ARP for the virtual server, answered here. Returns undefined for frames that go to
   * the network, null for frames that end here without an answer, else the answer.
   */
  answerLocally(f) {
    const type = (f[12] << 8) | f[13];
    if (type === 0x0806 && f.length >= 42 && same(f.subarray(38, 42), SERVER_IP)) return this.arp(f);
    if (type !== 0x0800 || f.length < 42 || f[14] >> 4 !== 4 || f[23] !== 17) return undefined;
    const ihl = (f[14] & 15) * 4;
    const udp = 14 + ihl;
    if (f.length < udp + 8 || ((f[udp + 2] << 8) | f[udp + 3]) !== 67) return undefined;
    return this.dhcp(f.subarray(udp + 8));
  }

  arp(f) {
    const a = f.subarray(14);
    if (((a[6] << 8) | a[7]) !== 1) return null; // only requests
    const out = new Uint8Array(42);
    out.set(a.subarray(8, 14), 0); // to the asking MAC
    out.set(SERVER_MAC, 6);
    out.set([0x08, 0x06], 12);
    const r = out.subarray(14);
    r.set(a.subarray(0, 6)); // hardware/protocol type and sizes
    r.set([0, 2], 6);
    r.set(SERVER_MAC, 8);
    r.set(SERVER_IP, 14);
    r.set(a.subarray(8, 18), 18); // sender MAC + IP become the target
    return out;
  }

  dhcp(b) {
    if (b.length < 240 || b[0] !== 1 || b[236] !== 0x63 || b[237] !== 0x82 || b[238] !== 0x53 || b[239] !== 0x63) return null;
    const opts = options(b.subarray(240));
    const type = opts.get(53)?.[0];
    const sid = opts.get(54);
    if (sid && !same(sid, SERVER_IP)) return null; // the PC chose another DHCP server
    if (type === 1) return this.dhcpReply(b, 2, true); // discover -> offer
    if (type === 3) { // request
      const want = opts.get(50) ?? b.subarray(12, 16);
      const unspecified = want.every((x) => x === 0);
      return this.dhcpReply(b, unspecified || same(want, this.address) ? 5 : 6, true);
    }
    if (type === 8) return this.dhcpReply(b, 5, false); // inform
    return null;
  }

  /** The DHCP answer as a whole Ethernet frame to the PC's MAC and the IP broadcast address. */
  dhcpReply(req, type, withAddress) {
    const d = [];
    const put = (...x) => d.push(...x);
    const zero = (n) => { for (let i = 0; i < n; i++) d.push(0); };
    put(2, 1, 6, 0, ...req.subarray(4, 8), 0, 0, ...req.subarray(10, 12));
    if (!withAddress) put(...req.subarray(12, 16)); else zero(4); // ciaddr
    if (withAddress && type !== 6) put(...this.address); else zero(4); // yiaddr
    put(...SERVER_IP);
    zero(4);
    put(...req.subarray(28, 44)); // client hardware address
    zero(192);
    put(0x63, 0x82, 0x53, 0x63);
    put(53, 1, type, 54, 4, ...SERVER_IP);
    if (type !== 6) {
      put(1, 4, 255, 255, 255, 0);
      if (withAddress) put(51, 4, (LEASE_SECONDS >>> 24) & 255, (LEASE_SECONDS >>> 16) & 255, (LEASE_SECONDS >>> 8) & 255, LEASE_SECONDS & 255);
    }
    put(255);
    while (d.length < 300) d.push(0); // BOOTP minimum size

    const frame = new Uint8Array(42 + d.length);
    frame.set(req.subarray(28, 34), 0);
    frame.set(SERVER_MAC, 6);
    frame.set([0x08, 0x00], 12);
    const ip = frame.subarray(14, 34);
    ip.set([0x45, 0, (20 + 8 + d.length) >> 8, (20 + 8 + d.length) & 255, 0, 0, 0, 0, 64, 17, 0, 0, ...SERVER_IP, 255, 255, 255, 255]);
    const sum = checksum(ip);
    ip[10] = sum >> 8;
    ip[11] = sum & 255;
    frame.set([0, 67, 0, 68, (8 + d.length) >> 8, (8 + d.length) & 255, 0, 0], 34); // UDP checksum 0: none
    frame.set(d, 42);
    return frame;
  }
}

function same(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function options(b) {
  const out = new Map();
  for (let i = 0; i < b.length;) {
    const code = b[i];
    if (code === 255) break;
    if (code === 0) { i++; continue; }
    if (i + 1 >= b.length || i + 2 + b[i + 1] > b.length) break;
    out.set(code, b.subarray(i + 2, i + 2 + b[i + 1]));
    i += 2 + b[i + 1];
  }
  return out;
}

function checksum(b) {
  let sum = 0;
  for (let i = 0; i + 1 < b.length; i += 2) sum += (b[i] << 8) | b[i + 1];
  while (sum > 0xffff) sum = (sum & 0xffff) + (sum >>> 16);
  return ~sum & 0xffff;
}
