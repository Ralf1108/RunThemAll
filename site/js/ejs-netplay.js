// Netplay for console games (EmulatorJS): every player runs the same game, the inputs are shared
// in lockstep over the relay. EmulatorJS' own netplay (Socket.IO) is experimental and unfinished
// in 4.2, so this module replaces it and keeps EmulatorJS unmodified:
//
// 1. The host's game is the reference: when players are ready, the host sends its save state
//    (compressed, in chunks) and everybody loads it, so all start from the same frame.
// 2. A local input (keyboard, gamepad, touch buttons) is not applied at once but scheduled for
//    DELAY frames later and sent to the others. Every player sends one small packet per frame,
//    also without input, so the others know that the frame is complete.
// 3. Before every frame the emulator asks preMainLoop (Emscripten main loop hook). The frame only
//    runs when the inputs of all players for it have arrived; then they are applied in the same
//    order everywhere. Same state + same inputs at the same frames = the same game everywhere.
//
// Each player controls the controller of his slot: the host player 1, the others 2, 3, 4 in the
// order they joined the room.

/** Frames between pressing a button and its effect (~67 ms at 60 frames/s): hides the delay of the network. */
const DELAY = 4;
const MAX_PLAYERS = 4;
const CHUNK = 12 * 1024; // below the relay's message limit (16 KB)
const WINDOW = 16; // state chunks in flight before the host waits for an answer
/** Input indices 24 and more are EmulatorJS hotkeys (save/load state, fast forward …): not in netplay. */
const FIRST_HOTKEY = 24;
const INPUTS = 24;

/** Every CHECK frames the players compare a checksum of the game state (~5 s at 60 frames/s). */
const CHECK = 300;

const T_INPUT = 1;
const T_CHUNK = 2;

/**
 * Wraps window.EJS_Runtime (the core's Emscripten factory, set when the core script loads) so that
 * the module gets our preMainLoop hook. Emscripten only reads it while it starts.
 * @param {() => boolean} preMainLoop returns false to skip a main loop iteration (= hold the frame)
 */
export function hookMainLoop(preMainLoop) {
  let factory;
  Object.defineProperty(window, 'EJS_Runtime', {
    configurable: true,
    get: () => factory && ((config) => factory(Object.assign(config, { preMainLoop }))),
    set: (f) => { factory = f; },
  });
}

/** FNV-1a: a quick checksum of the game state. */
function fnv(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return h >>> 0;
}

/** gzip with the browser's CompressionStream: save states shrink a lot. */
async function gzip(bytes, direction = 'compress') {
  const Stream = direction === 'compress' ? CompressionStream : DecompressionStream;
  const stream = new Blob([bytes]).stream().pipeThrough(new Stream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Lockstep for one EmulatorJS game in a netplay room.
 * Events (on the returned object): "status" (detail: text for the user).
 */
export class ConsoleNetplay extends EventTarget {
  /**
   * @param {import('./netplay.js').NetplayClient} client
   * @param {{name:string, size:number}} game to check that everybody runs the same game
   */
  constructor(client, game) {
    super();
    this.client = client;
    this.game = game;
    this.ejs = null;
    this.gm = null;
    this.epoch = 0;
    this.active = false; // lockstep running (after a sync)
    this.frozen = false; // waiting for the host's state
    this.players = []; // peer IDs, index = controller slot
    this.base = 0; // emulator frame counter at the sync
    this.next = 1; // the frame that runs next (counted from the sync)
    this.sentUpTo = 0; // own inputs are sent for frames up to here
    this.applied = 0;
    this.inputs = new Map(); // frame -> Map(peer -> [[index, value], ...])
    this.pending = []; // local inputs for the next packet
    this.ready = new Map(); // host: peer -> game info of players whose game runs
    this.incoming = null; // guest: state being received
    this.stalls = 0;
    this.checks = new Map(); // frame -> own checksum (guests) / host checksum that came first
    this.onPacket = (e) => this.packet(e.detail.from, e.detail.data);
    this.onMessage = (e) => this.message(e.detail.from, e.detail.data);
    this.onMembers = () => this.membersChanged();
    client.addEventListener('packet', this.onPacket);
    client.addEventListener('message', this.onMessage);
    client.addEventListener('members', this.onMembers);
    hookMainLoop(() => this.beforeFrame());
  }

  status(text) {
    this.dispatchEvent(new CustomEvent('status', { detail: text }));
  }

  get isHost() { return this.client.isHost; }

  /** Called when EmulatorJS has started the game. */
  gameStarted(ejs) {
    this.ejs = ejs;
    this.gm = ejs.gameManager;
    // Local inputs go through gameManager.simulateInput: catch them there.
    const original = this.gm.simulateInput.bind(this.gm);
    this.gm.simulateInput = (player, index, value) => {
      if (!this.active && !this.frozen) return original(player, index, value);
      if (player !== 0 || index >= FIRST_HOTKEY) return; // one controller per browser, no hotkeys
      this.pending.push([index, Math.max(-32767, Math.min(32767, Math.round(value)))]);
    };
    if (this.isHost) {
      this.ready.set(this.client.peer, this.game);
      this.status('Netplay: you are the host (player 1). The others join when their game has started.');
      this.client.sendMessage(0, { ejs: 'host-started' }); // players who were faster
      this.sync();
    } else {
      this.frozen = true;
      this.status('Netplay: waiting for the host …');
      this.client.sendMessage(this.client.host, { ejs: 'ready', game: this.game });
    }
  }

  // --- frames ---------------------------------------------------------------------------

  /** Emscripten main loop hook before every iteration; false holds the frame. */
  beforeFrame() {
    if (this.frozen) return false;
    if (!this.active || !this.gm) return true;
    const frame = this.gm.getFrameNum() - this.base + 1;
    if (frame < this.next) return true; // the last iteration did not produce a frame
    this.next = frame;
    // Own inputs for DELAY frames ahead (one packet per frame, empty or not).
    while (this.sentUpTo < frame + DELAY) {
      this.sentUpTo++;
      this.sendInputs(this.sentUpTo, this.pending);
      this.pending = [];
    }
    if (this.applied >= frame) return true;
    const all = this.inputs.get(frame);
    if (!all || this.players.some((p) => !all.has(p))) {
      if (++this.stalls === 60) this.status('Netplay: waiting for the other players …');
      return false;
    }
    if (this.stalls >= 60) this.status('');
    this.stalls = 0;
    if (frame % CHECK === 0) this.check(frame);
    this.players.slice(0, MAX_PLAYERS).forEach((peer, slot) => {
      for (const [index, value] of all.get(peer)) this.gm.functions.simulateInput(slot, index, value);
    });
    this.inputs.delete(frame);
    this.applied = frame;
    return true;
  }

  /** Compares the state before frame `frame` with the host's (the same on every player). */
  check(frame) {
    let sum;
    try {
      sum = fnv(this.gm.getState());
    } catch {
      return; // the core cannot save states
    }
    if (this.isHost) {
      this.client.sendMessage(0, { ejs: 'check', epoch: this.epoch, frame, sum });
      return;
    }
    const host = this.checks.get(frame);
    if (host === undefined) this.checks.set(frame, sum);
    else this.compare(frame, sum, host);
  }

  compare(frame, mine, host) {
    this.checks.delete(frame);
    console.debug(`netplay check frame ${frame}: ${mine === host ? 'same' : 'DIFFERENT'}`);
    if (mine !== host) {
      this.status('Netplay: the games ran apart, getting the host’s state again …');
      this.client.sendMessage(this.client.host, { ejs: 'desync', epoch: this.epoch, frame });
    }
  }

  sendInputs(frame, list) {
    this.storeInputs(this.client.peer, frame, list);
    const buf = new Uint8Array(8 + 3 * list.length);
    const v = new DataView(buf.buffer);
    v.setUint8(0, T_INPUT);
    v.setUint16(1, this.epoch);
    v.setUint32(3, frame);
    v.setUint8(7, list.length);
    list.forEach(([index, value], i) => {
      v.setUint8(8 + 3 * i, index);
      v.setInt16(9 + 3 * i, value);
    });
    for (const peer of this.players) if (peer !== this.client.peer) this.client.sendPacket(peer, buf);
  }

  storeInputs(peer, frame, list) {
    if (frame <= this.applied) return;
    if (!this.inputs.has(frame)) this.inputs.set(frame, new Map());
    this.inputs.get(frame).set(peer, list);
  }

  packet(from, data) {
    if (data.length < 3) return;
    const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
    if (v.getUint16(1) !== this.epoch) return; // from before the last sync
    if (data[0] === T_INPUT && data.length >= 8) {
      const n = v.getUint8(7);
      const list = [];
      for (let i = 0; i < n && 10 + 3 * i <= data.length; i++) list.push([v.getUint8(8 + 3 * i), v.getInt16(9 + 3 * i)]);
      if (this.players.includes(from)) this.storeInputs(from, v.getUint32(3), list);
    } else if (data[0] === T_CHUNK && this.incoming && data.length >= 7) {
      const index = v.getUint16(3);
      this.incoming.parts ??= new Array(v.getUint16(5)).fill(null);
      if (index >= this.incoming.parts.length || this.incoming.parts[index]) return;
      this.incoming.parts[index] = data.slice(7);
      this.incoming.got++;
      if (this.incoming.got % WINDOW === 0 || this.incoming.got === this.incoming.parts.length) {
        this.client.sendMessage(from, { ejs: 'got', epoch: this.epoch, n: this.incoming.got });
      }
      if (this.incoming.got === this.incoming.parts.length) this.loadIncoming();
    }
  }

  // --- start state ------------------------------------------------------------------------

  /**
   * Host: snapshot the game and send it to everybody whose game runs; all (the host too) start
   * the lockstep from it. Runs again when players come or go.
   */
  async sync() {
    if (this.syncing) {
      this.syncAgain = true;
      return;
    }
    this.syncing = true;
    try {
      do {
        this.syncAgain = false;
        const members = new Set(this.client.members.map((m) => m.peer));
        for (const peer of this.ready.keys()) if (!members.has(peer)) this.ready.delete(peer);
        const players = [...this.ready.keys()].filter((p) => p !== this.client.peer);
        players.unshift(this.client.peer);
        const epoch = (this.epoch + 1) & 0xffff || 1;
        this.prepare(epoch, players);
        if (players.length === 1) {
          if (this.active) this.status('Netplay: the others left, you play alone until somebody starts the game again.');
          this.active = false; // alone: play without delay
          continue;
        }
        // Everybody (the host too) loads the same state and starts the lockstep right after it.
        const state = this.gm.getState();
        this.gm.loadState(state);
        this.start();
        // At once, before the first own inputs of this round go out (the guests drop older rounds).
        this.client.sendMessage(0, { ejs: 'sync', epoch, players });
        await this.sendState(epoch, state);
        this.status(`Netplay: ${players.length} players, you are player 1.`);
      } while (this.syncAgain);
    } finally {
      this.syncing = false;
    }
  }

  /** Host: the state in chunks of CHUNK bytes, at most WINDOW * 2 ahead of the slowest receiver. */
  async sendState(epoch, state) {
    const packed = await gzip(state);
    const total = Math.ceil(packed.length / CHUNK);
    this.acks = new Map(this.players.slice(1).map((p) => [p, 0]));
    this.status(`Netplay: sending the game state to ${this.players.length - 1} player(s) …`);
    for (let i = 0; i < total; i++) {
      await this.waitForAcks(i - WINDOW * 2);
      const part = packed.subarray(i * CHUNK, (i + 1) * CHUNK);
      const buf = new Uint8Array(7 + part.length);
      const v = new DataView(buf.buffer);
      v.setUint8(0, T_CHUNK);
      v.setUint16(1, epoch);
      v.setUint16(3, i);
      v.setUint16(5, total);
      buf.set(part, 7);
      for (const p of this.acks.keys()) this.client.sendPacket(p, buf);
    }
  }

  /** Host: wait until every receiver has confirmed at least n chunks (or gave up). */
  async waitForAcks(n) {
    for (let t = 0; t < 400 && [...this.acks.values()].some((got) => got < n); t++) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /** A new round: inputs of older rounds are ignored from now on. */
  prepare(epoch, players) {
    this.epoch = epoch;
    this.players = players;
    this.inputs = new Map();
    this.checks = new Map();
    this.applied = 0;
  }

  /** Starts the lockstep right after loading the state: frame 1 is the first after it. */
  start() {
    const players = this.players;
    this.pending = [];
    this.base = this.gm.getFrameNum();
    this.next = 1;
    this.sentUpTo = DELAY;
    this.stalls = 0;
    // The first DELAY frames run without inputs (nobody pressed anything yet).
    for (let f = 1; f <= DELAY; f++) this.inputs.set(f, new Map(players.map((p) => [p, []])));
    // All buttons up, for every slot.
    for (let slot = 0; slot < MAX_PLAYERS; slot++) {
      for (let i = 0; i < INPUTS; i++) this.gm.functions.simulateInput(slot, i, 0);
    }
    this.active = true;
    this.frozen = false;
  }

  async loadIncoming() {
    const { epoch, parts } = this.incoming;
    this.incoming = null;
    const packed = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      packed.set(p, at);
      at += p.length;
    }
    const state = await gzip(packed, 'decompress');
    if (this.epoch !== epoch) return;
    this.gm.loadState(state);
    this.start();
    const slot = this.players.indexOf(this.client.peer);
    this.status(slot < MAX_PLAYERS
      ? `Netplay: ${this.players.length} players, you are player ${slot + 1}.`
      : 'Netplay: the game is full (4 players), you are watching.');
  }

  message(from, data) {
    if (!data || typeof data !== 'object' || !data.ejs) return;
    if (data.ejs === 'ready' && this.isHost && this.gm) {
      if (data.game?.name !== this.game.name || data.game?.size !== this.game.size) {
        this.client.sendMessage(from, { ejs: 'wrong-game', game: this.game });
        return;
      }
      this.ready.set(from, data.game);
      this.sync();
    } else if (data.ejs === 'check' && from === this.client.host && data.epoch === this.epoch) {
      const mine = this.checks.get(data.frame);
      if (mine === undefined) this.checks.set(data.frame, data.sum);
      else this.compare(data.frame, mine, data.sum);
    } else if (data.ejs === 'desync' && this.isHost && data.epoch === this.epoch) {
      this.sync();
    } else if (data.ejs === 'got' && this.acks?.has(from) && data.epoch === this.epoch) {
      this.acks.set(from, data.n);
    } else if (data.ejs === 'sync' && from === this.client.host && Array.isArray(data.players)) {
      if (!this.gm || !data.players.includes(this.client.peer)) return;
      this.active = false;
      this.frozen = true;
      this.prepare(data.epoch, data.players); // the host's inputs may come before the state is loaded
      this.incoming = { epoch: data.epoch, parts: null, got: 0 };
      this.status('Netplay: receiving the game from the host …');
    } else if (data.ejs === 'host-started' && !this.isHost && this.frozen && !this.incoming && this.gm) {
      this.client.sendMessage(this.client.host, { ejs: 'ready', game: this.game });
    } else if (data.ejs === 'wrong-game') {
      this.frozen = false;
      this.status(`Netplay: the host plays a different game (${data.game?.name}). Start the same file to play together.`);
    }
  }

  membersChanged() {
    if (!this.gm) return;
    const members = new Set(this.client.members.map((m) => m.peer));
    if (this.isHost) {
      // A player left (or the host changed): continue with the others.
      if (this.players.some((p) => !members.has(p)) || this.players[0] !== this.client.peer) {
        if (!this.ready.has(this.client.peer)) this.ready.set(this.client.peer, this.game);
        this.sync();
      }
    } else if (this.players.length && !members.has(this.players[0])) {
      // The host left: wait for the new host's state.
      this.active = false;
      this.frozen = true;
      this.status('Netplay: the host left, waiting for the new host …');
      this.client.sendMessage(this.client.host, { ejs: 'ready', game: this.game });
    }
  }

  close() {
    this.client.removeEventListener('packet', this.onPacket);
    this.client.removeEventListener('message', this.onMessage);
    this.client.removeEventListener('members', this.onMembers);
    this.active = false;
    this.frozen = false;
  }
}
