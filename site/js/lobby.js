// Multiplayer: the room panel of the start page (opened with the Multiplayer button at the top
// right). Everybody who enters the same room name (and password) lands in the same room on the
// relay server. While the page is in a room, programs start connected to the room: DOS programs
// with IPX networking (dos.js), PCs (v86) with a network card on the room's LAN (v86.js),
// Windows programs on a virtual LAN (wine-net.js) and console games with their inputs shared
// between the players (ejs-netplay.js).
//
// The members tell each other what they are running ({lobby: 'status'} messages), so the list
// shows who is already on the network in an emulator. Quitting a program reloads the page; the
// room is entered again by itself (sessionStorage, this tab only).

import { cleanRoomName, roomSecrets } from './netcrypt.js';
import { NetplayClient, ethernetUrl, jsdosNet } from './netplay.js';
import { wineAddress } from './wine-net.js';

const RELAY_KEY = 'runthemall-netplay-relay';
const NAME_KEY = 'runthemall-netplay-name';
const REJOIN_KEY = 'runthemall-netplay-room'; // sessionStorage: the room of this tab

/** Default relay: the one used last; on a local copy of the site the local relay. */
function defaultRelay() {
  const saved = localStorage.getItem(RELAY_KEY);
  if (saved) return saved;
  return /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'ws://localhost:8090' : '';
}

export const client = new NetplayClient();

/** What the members run: peer -> {title, system, net}. */
const activities = new Map();
/** What this page runs, sent to the others. */
let ownActivity = null;
let render = () => {};
let withPassword = false;

/**
 * What a DOS start needs to join the network, or null when not in a room.
 * @returns {{net:object, isHost:boolean, hostPeer:number}|null}
 */
export function netplayForDos() {
  if (!client.connected) return null;
  return { net: jsdosNet(client), isHost: client.isHost, hostPeer: client.host };
}

/**
 * What a PC (v86) needs for its network card, or null when not in a room.
 * @returns {{client:NetplayClient, ethUrl:string, room:string}|null}
 */
export function netplayForPc() {
  if (!client.connected) return null;
  return { client, ethUrl: ethernetUrl(client.relay, client.token), room: client.room };
}

/** Windows programs (Boxedwine) get a virtual LAN on the level of sockets (wine-net.js). */
export function netplayForWindows() {
  return client.connected ? { client } : null;
}

/** Console games (EmulatorJS) share their inputs over the room's control connection. */
export function netplayForConsole() {
  return client.connected ? { client } : null;
}

/** Short text for the toolbar while a program runs, e.g. "Room 4711 · host · 2 players". */
export function netplayStatus() {
  if (!client.connected) return '';
  const n = client.members.length;
  return `Room ${client.room} · ${client.isHost ? 'host' : 'guest'} · ${n} player${n === 1 ? '' : 's'}`;
}

/**
 * Tells the room what this page runs now (null: nothing).
 * @param {{title:string, system:string, kind:'dos'|'pc'|'windows'|'console'}|null} what
 */
export function setActivity(what) {
  ownActivity = what && { title: what.title, system: what.system, net: networkText(what.kind) };
  sendActivity(0);
  render();
}

function networkText(kind) {
  switch (kind) {
    case 'dos': return 'IPX network';
    case 'pc': return 'network card (DHCP)';
    case 'windows': return `IP ${wineAddress(client.num)}`;
    case 'console': return 'shared controllers';
    default: return '';
  }
}

function sendActivity(to) {
  if (client.connected) client.sendMessage(to, { lobby: 'status', activity: ownActivity });
}

/** @param {(id:string)=>HTMLElement} $ */
export function initLobby($) {
  const panel = $('multiplayer');
  const button = $('btn-multiplayer');
  const relay = $('np-relay');
  const name = $('np-name');
  relay.value = defaultRelay();
  name.value = localStorage.getItem(NAME_KEY) ?? '';
  $('np-server').open = !relay.value;

  const open = (show) => {
    panel.hidden = !show;
    button.setAttribute('aria-expanded', String(show));
    button.classList.toggle('active', show);
    document.querySelector('.layout')?.classList.toggle('mp-open', show);
    if (!show) return;
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (!client.connected) (name.value ? $('np-code') : name).focus({ preventScroll: true });
  };
  button.addEventListener('click', () => open(panel.hidden));
  $('mp-close').addEventListener('click', () => open(false));

  // A shared link: ?room=NAME (and &relay=...) opens the panel with the room filled in.
  const params = new URLSearchParams(location.search);
  if (params.get('room')) {
    $('np-code').value = params.get('room');
    if (params.get('relay')) relay.value = params.get('relay');
    open(true);
  }

  const error = (text) => {
    $('np-error').textContent = text;
    $('np-error').hidden = !text;
  };

  render = () => {
    const inRoom = client.connected;
    $('np-setup').hidden = inRoom;
    $('np-room').hidden = !inRoom;
    $('mp-button-room').hidden = !inRoom;
    button.classList.toggle('in-room', inRoom);
    if (!inRoom) return;
    const members = client.members;
    $('mp-button-room').textContent = `${client.room} · ${members.length}`;
    $('np-room-code').textContent = client.room;
    $('np-lock-text').textContent = withPassword ? 'Encrypted' : 'Encrypted (room name)';
    $('np-lock').title = withPassword
      ? 'End-to-end encrypted with keys of this session, protected by the room password: '
        + 'the relay server cannot read anything.'
      : 'End-to-end encrypted with keys of this session. Without a password, a relay server that '
        + 'guesses the room name could put itself in between: compare the safety code, or use a password.';
    $('np-safety').hidden = !client.safetyCode;
    $('np-safety-code').textContent = client.safetyCode;
    $('np-count').textContent = `${members.length} in the room`
      + ` · ${members.filter((m) => activityOf(m.peer)).length} on the network`;
    $('np-members').replaceChildren(...members.map((m) => memberItem(m, activityOf(m.peer))));
    $('np-role').textContent = (client.isHost
      ? 'You are the host: start the game first, the others follow. '
      : 'Start the same game as the host, after the host. ')
      + 'The multiplayer demos (Doom, Heretic, Duke Nukem 3D) start their network game by themselves. '
      + 'Other DOS games: choose IPX network play. '
      + (client.isHost ? 'Console games: your game is copied to the others, you are player 1.' : 'Console games: you play as player 2, 3 or 4.')
      + ' Several players on one computer: use one browser window each, not tabs (a hidden tab stops).';
  };
  const activityOf = (peer) => (peer === client.peer ? ownActivity : activities.get(peer));

  client.addEventListener('members', () => {
    // Somebody new does not know yet what everybody runs.
    const known = new Set(client.members.map((m) => m.peer));
    for (const peer of activities.keys()) if (!known.has(peer)) activities.delete(peer);
    if (ownActivity) sendActivity(0);
    render();
    if (!$('run-netplay').hidden) $('run-netplay').textContent = netplayStatus();
  });
  client.addEventListener('message', (e) => {
    const { from, data } = e.detail;
    if (data?.lobby !== 'status') return;
    if (data.activity && typeof data.activity === 'object') {
      activities.set(from, {
        title: String(data.activity.title ?? '').slice(0, 80),
        system: String(data.activity.system ?? '').slice(0, 40),
        net: String(data.activity.net ?? '').slice(0, 40),
      });
    } else activities.delete(from);
    render();
  });
  client.addEventListener('close', (e) => {
    activities.clear();
    sessionStorage.removeItem(REJOIN_KEY);
    render();
    error(e.detail);
    open(true);
  });

  async function enter({ relayUrl, room, password, who }) {
    if (!relayUrl) {
      $('np-server').open = true;
      error('Enter the address of a relay server first (under Server).');
      return false;
    }
    error('');
    $('np-enter').disabled = true;
    try {
      // End-to-end encryption (netcrypt.js): the relay gets a room ID and a password check
      // instead of name and password, and "Player" instead of the player's name.
      $('np-enter').textContent = 'Encrypting …';
      const { roomId, check, cipher, pairSalt } = await roomSecrets(room, password);
      await client.open(relayUrl, { type: 'enter', room: roomId, password: check, name: 'Player' },
        { cipher, pairSalt, room: cleanRoomName(room), name: who || 'Player' });
      withPassword = !!password;
      sessionStorage.setItem(REJOIN_KEY, JSON.stringify({ relayUrl, room, password, who }));
      render();
      return true;
    } catch (err) {
      error(err.message);
      return false;
    } finally {
      $('np-enter').disabled = false;
      $('np-enter').textContent = 'Enter room';
    }
  }

  $('np-setup').addEventListener('submit', (e) => {
    e.preventDefault();
    const room = $('np-code').value.trim();
    if (!room) {
      error('Enter a room name or number.');
      return;
    }
    const relayUrl = relay.value.trim();
    localStorage.setItem(RELAY_KEY, relayUrl);
    localStorage.setItem(NAME_KEY, name.value.trim());
    enter({ relayUrl, room, password: $('np-password').value, who: name.value.trim() });
  });
  $('np-leave').addEventListener('click', () => {
    sessionStorage.removeItem(REJOIN_KEY);
    activities.clear();
    client.close();
    render();
  });
  $('np-share').addEventListener('click', async () => {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('room', client.room);
    url.searchParams.set('relay', client.relay);
    const text = `Join my room ${client.room} on RunThemAll`;
    try {
      if (navigator.share) await navigator.share({ title: 'RunThemAll', text, url: url.href });
      else {
        await navigator.clipboard.writeText(url.href);
        $('np-share').textContent = 'Link copied';
        setTimeout(() => { $('np-share').textContent = 'Share link'; }, 2000);
      }
    } catch { /* cancelled */ }
  });

  // Back on the start page after quitting a program (the page reloads): enter the room again.
  try {
    const again = JSON.parse(sessionStorage.getItem(REJOIN_KEY) ?? 'null');
    if (again && !params.get('room')) {
      $('np-code').value = again.room;
      enter(again);
    }
  } catch { /* nothing stored */ }
  render();
}

/** One line of the member list: name, host/you, and what the member runs on the network. */
function memberItem(m, activity) {
  const li = document.createElement('li');
  li.className = activity ? 'mp-member online' : 'mp-member';
  const avatar = document.createElement('span');
  avatar.className = 'mp-avatar';
  avatar.textContent = [...(m.name || '?')][0].toUpperCase();
  avatar.style.setProperty('--hue', String((m.num * 67) % 360));
  const text = document.createElement('div');
  text.className = 'mp-member-text';
  const line = document.createElement('div');
  line.className = 'mp-member-name';
  const nameEl = document.createElement('span');
  nameEl.textContent = m.name;
  line.append(nameEl);
  for (const [show, label, cls] of [[m.host, 'host', 'mp-tag-host'], [m.peer === client.peer, 'you', 'mp-tag-you']]) {
    if (!show) continue;
    const tag = document.createElement('span');
    tag.className = `mp-tag ${cls}`;
    tag.textContent = label;
    line.append(tag);
  }
  const state = document.createElement('div');
  state.className = 'mp-member-state';
  if (activity) {
    state.title = `${activity.title} (${activity.system}) · ${activity.net}`;
    const dot = document.createElement('span');
    dot.className = 'mp-dot';
    state.append(dot, `${activity.title} · ${activity.net}`);
  } else state.textContent = 'in the room, no game started';
  text.append(line, state);
  li.append(avatar, text);
  return li;
}
