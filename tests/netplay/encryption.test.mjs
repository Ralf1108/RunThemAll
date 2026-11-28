// End-to-end encryption of multiplayer rooms, against a running relay (RELAY, default
// ws://localhost:8090): names, packets and messages, safety codes, forward secrecy, replays,
// what the relay sees, wrong password, rooms without password, PCs (sealed Ethernet, DHCP).
//   cd netplay && go run . -ban-exempt 127.0.0.0/8,::1     (in another terminal)
//   node tests/netplay/encryption.test.mjs
const root = new URL('../../site/js/', import.meta.url).href;
const { roomSecrets, cleanRoomName } = await import(root + 'netcrypt.js');
const { NetplayClient } = await import(root + 'netplay.js');
const { SealedEthernet } = await import(root + 'pc-net.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RELAY = process.env.RELAY ?? 'ws://localhost:8090';
let fails = 0;
const ok = (cond, what) => { console.log(cond ? 'ok  ' : 'FAIL', what); if (!cond) fails++; };

async function enter(room, password, who) {
  const t = Date.now();
  const s = await roomSecrets(room, password);
  const c = new NetplayClient();
  await c.open(RELAY, { type: 'enter', room: s.roomId, password: s.check, name: 'Player' }, { cipher: s.cipher, pairSalt: s.pairSalt, room: cleanRoomName(room), name: who });
  return { c, s, ms: Date.now() - t };
}

const room = `Secret LAN ${Date.now() % 100000}`;
const A = await enter(room, 'pw1', 'Alice');
const B = await enter(room.toUpperCase(), 'pw1', 'Bob');
// Record what reaches B (as a malicious relay could) to send it again later.
const recorded = [];
{ const orig = B.c.ws.onmessage; B.c.ws.onmessage = (e) => { recorded.push(e.data); orig(e); }; }
console.log('keys derived in', A.ms, 'ms; room ID', A.s.roomId);
ok(A.s.roomId === B.s.roomId && /^[0-9a-f]{32}$/.test(A.s.roomId), 'same room ID for any case, hex');
ok(A.c.room === cleanRoomName(room), 'client shows the real room name');
await sleep(500);
ok(A.c.members.map((m) => m.name).join() === 'Alice,Bob', `A sees names ${A.c.members.map((m) => m.name)}`);
ok(B.c.members.map((m) => m.name).join() === 'Alice,Bob', `B sees names ${B.c.members.map((m) => m.name)}`);
ok(A.c.relayMembers.every((m) => m.name === 'Player'), 'relay only knows "Player"');

// Packets and messages, order kept.
const got = [];
B.c.addEventListener('packet', (e) => got.push([...e.detail.data].join(',')));
const msgs = [];
B.c.addEventListener('message', (e) => msgs.push(e.detail.data));
for (let i = 0; i < 200; i++) A.c.sendPacket(B.c.peer, new Uint8Array([i & 255, 1, 2, 3]));
A.c.sendMessage(0, { hello: 'world', n: 42 });
await sleep(800);
ok(got.length === 200 && got.every((g, i) => g === `${i & 255},1,2,3`), `200 packets in order (${got.length})`);
ok(msgs.length === 1 && msgs[0].hello === 'world', 'message arrives decrypted');
ok(B.c.senders.get(A.c.peer)?.ready && A.c.senders.get(B.c.peer)?.ready, 'A and B know each other (live, sending keys)');
ok(A.c.safetyCode && A.c.safetyCode === B.c.safetyCode, `same safety code ${A.c.safetyCode} / ${B.c.safetyCode}`);
// Forward secrecy: the room key (password known) does not open recorded packets.
{
  const { context } = await import(root + 'netcrypt.js');
  const pk = recorded.find((d) => typeof d !== 'string');
  const from = new DataView(pk).getUint32(0);
  let opened = true;
  try { await A.s.cipher.open(new Uint8Array(pk, 4).slice(), context('p', from)); } catch { opened = false; }
  ok(!opened, 'room key alone does not open recorded packets (session keys)');
}

// Replay: the relay sends the recorded data again.
const before = got.length, rep0 = B.c.replayed;
const bins = recorded.filter((d) => typeof d !== 'string');
for (const d of bins.slice(0, 50)) B.c.ws.onmessage({ data: d });
for (const d of recorded.slice().filter((d) => typeof d === 'string' && d.includes('"msg"'))) B.c.ws.onmessage({ data: d });
await sleep(300);
ok(got.length === before && msgs.length === 1 && B.c.replayed > rep0, `replayed packets and messages dropped (${B.c.replayed - rep0} recognised)`);

// What the relay forwards: a raw listener in the room sees only sealed bytes.
const raw = new WebSocket(RELAY + '/v1');
raw.binaryType = 'arraybuffer';
const seen = [];
await new Promise((r) => { raw.onopen = () => raw.send(JSON.stringify({ type: 'enter', room: A.s.roomId, password: A.s.check, name: 'Eve' })); raw.onmessage = (e) => { seen.push(e.data); if (typeof e.data === 'string' && e.data.includes('joined')) r(); }; });
await sleep(300);
A.c.sendPacket(0, new TextEncoder().encode('ATTACK AT DAWN'));
A.c.sendMessage(0, { secret: 'ATTACK AT DAWN' });
await sleep(500);
const dump = seen.map((d) => (typeof d === 'string' ? d : Buffer.from(d).toString('latin1'))).join('\n');
ok(!dump.includes('ATTACK') && !dump.includes('Alice') && !dump.includes('Bob') && !dump.includes('Secret LAN'), 'relay stream has no plain text');
console.log('relay sees e.g.:', dump.split('\n').filter((l) => l.includes('"msg"')).slice(-1)[0]?.slice(0, 160));
raw.close();

// Wrong password; same name without password is another key.
try { await enter(room, 'wrong', 'Mallory'); ok(false, 'wrong password rejected'); } catch (e) { ok(/Wrong password/.test(e.message), `wrong password rejected: ${e.message}`); }

// Room without password: the room name is the key.
const C = await enter('Open room', '', 'Carol');
const D = await enter('open  ROOM', '', 'Dave');
await sleep(400);
const E = await enter('Open Room', '', 'Erin');
await sleep(600);
ok(C.c.safetyCode && C.c.safetyCode === D.c.safetyCode && D.c.safetyCode === E.c.safetyCode, `three players, one safety code ${C.c.safetyCode}`);
E.c.close();
await sleep(400);
const got2 = [];
D.c.addEventListener('packet', (e) => got2.push(e.detail.data[0]));
C.c.sendPacket(0, new Uint8Array([7]));
await sleep(300);
ok(got2.join() === '7' && C.s.check === '', 'room without password: encrypted with the room name');

// SealedEthernet: DHCP locally, frames sealed through /v1/eth.
const fake = (name) => {
  const listeners = []; const inbox = [];
  return { name, inbox, add_listener: (ev, fn) => listeners.push(fn), out: (f) => listeners.forEach((fn) => fn(f)), bus: { send: (ev, f) => inbox.push(f) } };
};
const ea = fake('A'), eb = fake('B');
const la = new SealedEthernet(ea, A.c), lb = new SealedEthernet(eb, B.c);
await sleep(500);
const macA = [0x52, 0x54, 0, 0, 0, 0xa], macB = [0x52, 0x54, 0, 0, 0, 0xb];
const discover = new Uint8Array(42 + 300);
discover.set([255, 255, 255, 255, 255, 255, ...macA, 8, 0]);
discover.set([0x45, 0, 0, 0, 0, 0, 0, 0, 64, 17], 14);
discover.set([0, 68, 0, 67], 34);
const d = discover.subarray(42);
d.set([1, 1, 6, 0, 1, 2, 3, 4]); d.set(macA, 28); d.set([0x63, 0x82, 0x53, 0x63], 236); d.set([53, 1, 1, 255], 240);
ea.out(discover);
await sleep(100);
const offer = ea.inbox.shift();
ok(offer && offer[42] === 2 && offer.subarray(58, 62).join('.') === la.addressText && offer[42 + 242] === 2, `DHCP offer ${offer?.subarray(58, 62).join('.')}`);
ok(lb.addressText !== la.addressText, `different addresses ${la.addressText} / ${lb.addressText}`);
const frame = new Uint8Array([...macB, ...macA, 0x08, 0x00, ...new TextEncoder().encode('hello from A over the LAN')]);
ea.out(frame); // unknown MAC: flooded to B
await sleep(500);
ok(eb.inbox.length === 1 && Buffer.from(eb.inbox[0]).equals(Buffer.from(frame)), 'Ethernet frame arrives decrypted at B');
const frames = [];
{ const orig = lb.ws.onmessage; lb.ws.onmessage = (e) => { frames.push(e.data); orig(e); }; }
ea.out(frame);
await sleep(300);
const n = eb.inbox.length;
for (const f of frames.slice()) lb.ws.onmessage({ data: f });
await sleep(300);
ok(n === 2 && eb.inbox.length === 2, `replayed Ethernet frame dropped (${eb.inbox.length})`);
la.close(); lb.close();
for (const x of [A, B, C, D]) x.c.close();
await sleep(500);

// A recorded older session: same room and password later, the relay pretends the old A is there.
const B2 = await enter(room, 'pw1', 'Bob');
await sleep(300);
const got2b = [], msgs2b = [];
B2.c.addEventListener('packet', (e) => got2b.push(e.detail.data));
B2.c.addEventListener('message', (e) => msgs2b.push(e.detail.data));
B2.c.ws.onmessage({ data: JSON.stringify({ type: 'members', host: A.c.peer || 1, members: [{ peer: recordedFrom(), name: 'Player', num: 1 }, { peer: B2.c.peer, name: 'Player', num: 2 }] }) });
for (const d of recorded) B2.c.ws.onmessage({ data: d });
await sleep(500);
ok(got2b.length === 0 && msgs2b.length === 0, `old session replayed into a new one: nothing delivered (${B2.c.replayed} recognised)`);
B2.c.close();
function recordedFrom() { const d = recorded.find((x) => typeof x !== 'string'); return new DataView(d).getUint32(0); }
console.log(fails ? `${fails} FAILED` : 'encryption: all ok');
process.exit(fails ? 1 : 0);
