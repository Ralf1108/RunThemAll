// Man-in-the-middle test: two players go through a malicious relay (mitm-relay.mjs) that knows
// the room name. Needs a running relay (RELAY, default ws://localhost:8090), see encryption.test.mjs.
//
//   room without password: the attack works (the room name is the room key), the attacker reads
//     along, but the two players see different safety codes;
//   room with password: the attacker reads nothing and both see the same code;
//   direct connection: the same code.
//   node tests/netplay/mitm.test.mjs

import { startMitm } from './mitm-relay.mjs';

const root = new URL('../../site/js/', import.meta.url).href;
const { roomSecrets, cleanRoomName } = await import(root + 'netcrypt.js');
const { NetplayClient } = await import(root + 'netplay.js');
const RELAY = process.env.RELAY ?? 'ws://localhost:8090';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const ok = (cond, what) => { console.log(cond ? 'ok  ' : 'FAIL', what); if (!cond) fails++; };

async function enter(relay, room, password, who) {
  const s = await roomSecrets(room, password);
  const c = new NetplayClient();
  await c.open(relay, { type: 'enter', room: s.roomId, password: s.check, name: 'Player' },
    { cipher: s.cipher, pairSalt: s.pairSalt, room: cleanRoomName(room), name: who });
  return c;
}

/** Alice and Bob meet in a room, Alice sends a message and 20 packets. */
async function play(relay, room, password) {
  const A = await enter(relay, room, password, 'Alice');
  await sleep(200);
  const B = await enter(relay, room, password, 'Bob');
  await sleep(1500);
  const got = [];
  const msgs = [];
  B.addEventListener('packet', (e) => got.push(e.detail.data));
  B.addEventListener('message', (e) => msgs.push(e.detail.data));
  A.sendMessage(0, { chat: 'meet at the bridge, secret plan 42' });
  for (let i = 0; i < 20; i++) A.sendPacket(B.peer, new TextEncoder().encode(`IPX game packet ${i}`));
  await sleep(1000);
  const result = { codeA: A.safetyCode, codeB: B.safetyCode, msgs, packets: got.length, names: B.members.map((m) => m.name).join(',') };
  A.close();
  B.close();
  await sleep(300);
  return result;
}

const tag = Date.now() % 100000;
let port = 8196;

// 1. Room without password: the malicious relay knows the name.
{
  const room = `mitm open ${tag}`;
  const mitm = await startMitm({ port: ++port, room, upstream: RELAY });
  const r = await play(`ws://localhost:${port}`, room, '');
  ok(r.msgs[0]?.chat === 'meet at the bridge, secret plan 42' && r.packets === 20 && r.names === 'Alice,Bob', 'no password, attacked: the game still works (the attack is invisible there)');
  ok(mitm.stats.keysStolen === 2 && mitm.read.some((t) => t.includes('secret plan 42')) && mitm.read.some((t) => t.includes('IPX game packet')),
    `no password, attacked: the attacker reads along (${JSON.stringify(mitm.stats)})`);
  ok(r.codeA && r.codeB && r.codeA !== r.codeB, `no password, attacked: the safety codes differ (${r.codeA} / ${r.codeB})`);
  mitm.close();
}

// 2. Room with password: the malicious relay knows only the name.
{
  const room = `mitm pw ${tag}`;
  const mitm = await startMitm({ port: ++port, room, upstream: RELAY });
  const r = await play(`ws://localhost:${port}`, room, 'Zauberer-im-Schloss');
  ok(r.msgs[0]?.chat && r.packets === 20, 'password, attacked: the game works');
  ok(mitm.stats.keysStolen === 0 && mitm.stats.hellosSwapped === 0 && mitm.read.length === 0, `password, attacked: the attacker reads nothing (${JSON.stringify(mitm.stats)})`);
  ok(r.codeA && r.codeA === r.codeB, `password, attacked: the same safety code (${r.codeA})`);
  mitm.close();
}

// 3. Direct connection without password: the same code.
{
  const r = await play(RELAY, `mitm direct ${tag}`, '');
  ok(r.codeA && r.codeA === r.codeB, `no password, honest relay: the same safety code (${r.codeA})`);
}

console.log(fails ? `${fails} FAILED` : 'man in the middle: all ok');
process.exit(fails ? 1 : 0);
