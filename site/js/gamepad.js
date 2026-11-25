// Touch gamepad over the emulator picture: a D-pad and a few buttons that hold keys while
// a finger (or the mouse) is on them. Which key each button sends can be set per program.

import { KEY_BY_ID } from './keys.js';

/** The buttons of the pad: [id, label]. */
export const PAD_BUTTONS = [
  ['up', 'Up'], ['down', 'Down'], ['left', 'Left'], ['right', 'Right'],
  ['a', 'A'], ['b', 'B'], ['x', 'X'], ['y', 'Y'], ['select', 'Select'], ['start', 'Start'],
];

/** Usual keys of DOS games: arrows to move, Ctrl/Alt to jump or fire, Enter and Esc for menus. */
export const DEFAULT_MAPPING = {
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  a: 'Control', b: 'Alt', x: 'Space', y: 'Shift', select: 'Escape', start: 'Enter',
};

const STORE_KEY = 'runthemall-gamepad';

function savedMappings() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { return {}; }
}

/** The mapping for a program ('' = button does nothing); defaults where nothing was set. */
export function loadMapping(programKey) {
  return { ...DEFAULT_MAPPING, ...(savedMappings()[programKey] ?? {}) };
}

/** Remembers a mapping for a program; null forgets it (back to the defaults). */
export function saveMapping(programKey, mapping) {
  const all = savedMappings();
  if (mapping) all[programKey] = mapping; else delete all[programKey];
  localStorage.setItem(STORE_KEY, JSON.stringify(all));
}

/** Direction pressed on the D-pad for a point relative to its centre (8 directions, dead zone in the middle). */
function directions(dx, dy, radius) {
  if (Math.hypot(dx, dy) < radius * 0.25) return [];
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI; // 0 = right, 90 = down
  const sector = Math.round(angle / 45); // -4 … 4
  return {
    0: ['right'], 1: ['right', 'down'], 2: ['down'], 3: ['down', 'left'], 4: ['left'], [-4]: ['left'],
    [-3]: ['left', 'up'], [-2]: ['up'], [-1]: ['up', 'right'],
  }[sector];
}

/**
 * Builds the pad inside `container` (the emulator area, so it also shows in fullscreen).
 * @param {HTMLElement} container
 * @param {{send:(key:import('./keys.js').VirtualKey, pressed:boolean)=>void, onSettings:()=>void}} hooks
 */
export function createGamepad(container, { send, onSettings }) {
  let mapping = { ...DEFAULT_MAPPING };
  const holds = new Map(); // key id -> number of pad buttons holding it
  const pressedButtons = new Set();

  function press(button) {
    if (pressedButtons.has(button)) return;
    pressedButtons.add(button);
    pad.querySelector(`[data-pad="${button}"]`)?.classList.add('down');
    const id = mapping[button];
    if (!id || !KEY_BY_ID.has(id)) return;
    const n = holds.get(id) ?? 0;
    holds.set(id, n + 1);
    if (n === 0) send(KEY_BY_ID.get(id), true);
  }
  function release(button) {
    if (!pressedButtons.delete(button)) return;
    pad.querySelector(`[data-pad="${button}"]`)?.classList.remove('down');
    const id = mapping[button];
    if (!id || !holds.has(id)) return;
    const n = holds.get(id) - 1;
    if (n > 0) holds.set(id, n);
    else { holds.delete(id); send(KEY_BY_ID.get(id), false); }
  }
  function releaseAll() {
    for (const button of [...pressedButtons]) release(button);
  }

  const el = (tag, className, text = '') => Object.assign(document.createElement(tag), { className, textContent: text });
  const pad = el('div', 'gamepad');
  pad.hidden = true;
  pad.setAttribute('aria-label', 'Touch gamepad');

  // D-pad: one area, the finger may slide between directions (diagonals press two keys).
  const dpad = el('div', 'gp-dpad');
  for (const dir of ['up', 'down', 'left', 'right']) {
    const arm = el('span', `gp-arm gp-${dir}`);
    arm.dataset.pad = dir;
    dpad.append(arm);
  }
  let dpadPointer = null;
  const updateDpad = (e) => {
    const r = dpad.getBoundingClientRect();
    const want = new Set(directions(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), r.width / 2));
    for (const dir of ['up', 'down', 'left', 'right']) {
      if (want.has(dir)) press(dir); else release(dir);
    }
  };
  const endDpad = (e) => {
    if (e.pointerId !== dpadPointer) return;
    dpadPointer = null;
    for (const dir of ['up', 'down', 'left', 'right']) release(dir);
  };
  dpad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (dpadPointer !== null) return;
    dpadPointer = e.pointerId;
    dpad.setPointerCapture(e.pointerId);
    updateDpad(e);
  });
  dpad.addEventListener('pointermove', (e) => { if (e.pointerId === dpadPointer) updateDpad(e); });
  dpad.addEventListener('pointerup', endDpad);
  dpad.addEventListener('pointercancel', endDpad);
  dpad.addEventListener('lostpointercapture', endDpad);

  // Buttons: held while the finger is on them.
  const holdButton = (id, className) => {
    const b = el('button', className);
    b.type = 'button';
    b.dataset.pad = id;
    let pointer = null;
    const end = (e) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      release(id);
    };
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault(); // keep the focus in the emulator
      if (pointer !== null) return;
      pointer = e.pointerId;
      b.setPointerCapture(e.pointerId);
      press(id);
    });
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('lostpointercapture', end);
    return b;
  };
  const actions = el('div', 'gp-actions');
  for (const id of ['y', 'x', 'b', 'a']) actions.append(holdButton(id, `gp-btn gp-${id}`));
  const middle = el('div', 'gp-middle');
  middle.append(holdButton('select', 'gp-small'), holdButton('start', 'gp-small'));
  const settings = el('button', 'gp-settings', '⚙');
  settings.type = 'button';
  settings.title = 'Choose the keys of the gamepad buttons';
  settings.setAttribute('aria-label', settings.title);
  settings.addEventListener('pointerdown', (e) => e.preventDefault());
  settings.addEventListener('click', () => onSettings());
  middle.append(settings);
  pad.append(dpad, middle, actions);
  pad.addEventListener('contextmenu', (e) => e.preventDefault());
  container.append(pad);

  /** Shows on every button which key it sends. */
  function label() {
    for (const [id, name] of PAD_BUTTONS) {
      const key = KEY_BY_ID.get(mapping[id]);
      for (const node of pad.querySelectorAll(`[data-pad="${id}"]`)) {
        node.title = `${name}: ${key ? key.label : 'nothing'}`;
        if (node.tagName === 'BUTTON') {
          node.replaceChildren(el('b', '', name), el('small', '', key ? key.label : '–'));
        }
      }
    }
  }
  label();

  return {
    get visible() { return !pad.hidden; },
    setVisible(on) {
      if (!on) releaseAll();
      pad.hidden = !on;
    },
    setMapping(next) {
      releaseAll();
      mapping = { ...next };
      label();
    },
    releaseAll,
  };
}
