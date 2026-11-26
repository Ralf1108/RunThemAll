// Netplay lobby on the start page: create or join a room on a relay server. While the page is
// in a room, DOS programs start with IPX networking over the relay (see dos.js).

import { NetplayClient, jsdosNet, normalizeCode } from './netplay.js';

const RELAY_KEY = 'runthemall-netplay-relay';
const NAME_KEY = 'runthemall-netplay-name';

/** Default relay: the one used last; on a local copy of the site the local relay. */
function defaultRelay() {
  const saved = localStorage.getItem(RELAY_KEY);
  if (saved) return saved;
  return /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? 'ws://localhost:8090' : '';
}

export const client = new NetplayClient();

/**
 * What a DOS start needs to join the network, or null when not in a room.
 * @returns {{net:object, isHost:boolean, hostPeer:number}|null}
 */
export function netplayForDos() {
  if (!client.connected) return null;
  return { net: jsdosNet(client), isHost: client.isHost, hostPeer: client.host };
}

/** Short text for the toolbar while a program runs, e.g. "Room ABCDE-FGHJK · host · 2 players". */
export function netplayStatus() {
  if (!client.connected) return '';
  const n = client.members.length;
  return `Room ${client.room} · ${client.isHost ? 'host' : 'guest'} · ${n} player${n === 1 ? '' : 's'}`;
}

/** @param {(id:string)=>HTMLElement} $ */
export function initLobby($) {
  const relay = $('np-relay');
  const name = $('np-name');
  relay.value = defaultRelay();
  name.value = localStorage.getItem(NAME_KEY) ?? '';

  // A shared link: ?room=CODE (and &relay=...) opens the lobby with the code filled in.
  const params = new URLSearchParams(location.search);
  if (params.get('room')) {
    $('np-code').value = normalizeCode(params.get('room')) || params.get('room');
    if (params.get('relay')) relay.value = params.get('relay');
    $('netplay').open = true;
  }

  const error = (text) => {
    $('np-error').textContent = text;
    $('np-error').hidden = !text;
  };
  const show = () => {
    const inRoom = client.connected;
    $('np-setup').hidden = inRoom;
    $('np-room').hidden = !inRoom;
    if (!inRoom) return;
    $('np-room-code').textContent = client.room;
    $('np-members').replaceChildren(...client.members.map((m) => {
      const li = document.createElement('li');
      li.textContent = `${m.name}${m.host ? ' (host)' : ''}${m.peer === client.peer ? ' – you' : ''}`;
      return li;
    }));
    $('np-role').textContent = client.isHost
      ? 'You are the host: start the game first, then the others. In the game choose IPX network play.'
      : 'Start the game after the host did, then choose IPX network play in the game.';
  };
  client.addEventListener('members', show);
  client.addEventListener('close', (e) => { show(); error(e.detail); });

  async function enter(hello) {
    const relayUrl = relay.value.trim();
    if (!relayUrl) {
      error('Enter the address of a relay server first.');
      return;
    }
    error('');
    localStorage.setItem(RELAY_KEY, relayUrl);
    localStorage.setItem(NAME_KEY, name.value.trim());
    for (const b of [$('np-create'), $('np-join')]) b.disabled = true;
    try {
      await client.open(relayUrl, { ...hello, name: name.value.trim() || 'Player' });
      show();
    } catch (err) {
      error(err.message);
    } finally {
      for (const b of [$('np-create'), $('np-join')]) b.disabled = false;
    }
  }

  $('np-create').addEventListener('click', () => enter({ type: 'create', password: $('np-create-password').value }));
  $('np-join').addEventListener('click', () => {
    const room = normalizeCode($('np-code').value);
    if (!room) {
      error('A room code has 10 letters and digits, e.g. ABCDE-FGHJK.');
      return;
    }
    enter({ type: 'join', room, password: $('np-join-password').value });
  });
  $('np-leave').addEventListener('click', () => { client.close(); show(); });
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
  show();
}
