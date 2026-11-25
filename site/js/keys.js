// Virtual keyboard: keys a page cannot get from the real keyboard (Esc is taken by the
// browser to release the mouse) or that are awkward to type, sent into the emulator.
// Each runner turns a key into what its emulator understands (see Runner.sendKey).

/**
 * @typedef {object} VirtualKey
 * @property {string} id
 * @property {string} label
 * @property {string} key      KeyboardEvent.key
 * @property {string} code     KeyboardEvent.code
 * @property {number} keyCode  legacy KeyboardEvent.keyCode (read by Emscripten)
 * @property {number} dos      key code of js-dos (GLFW numbering)
 * @property {number[]} scan   PC scancode set 1 for the press (v86); release adds 0x80
 * @property {boolean} [modifier]
 */

const k = (id, label, key, code, keyCode, dos, scan, modifier = false) => ({ id, label, key, code, keyCode, dos, scan, modifier });

/** @type {VirtualKey[]} */
export const VIRTUAL_KEYS = [
  k('Escape', 'Esc', 'Escape', 'Escape', 27, 256, [0x01]),
  k('Tab', 'Tab', 'Tab', 'Tab', 9, 258, [0x0f]),
  k('Enter', 'Enter', 'Enter', 'Enter', 13, 257, [0x1c]),
  k('Backspace', '⌫', 'Backspace', 'Backspace', 8, 259, [0x0e]),
  k('Space', 'Space', ' ', 'Space', 32, 32, [0x39]),
  ...Array.from({ length: 12 }, (_, i) => k(`F${i + 1}`, `F${i + 1}`, `F${i + 1}`, `F${i + 1}`, 112 + i, 290 + i,
    [i < 10 ? 0x3b + i : 0x57 + (i - 10)])),
  k('Insert', 'Ins', 'Insert', 'Insert', 45, 260, [0xe0, 0x52]),
  k('Delete', 'Del', 'Delete', 'Delete', 46, 261, [0xe0, 0x53]),
  k('Home', 'Home', 'Home', 'Home', 36, 268, [0xe0, 0x47]),
  k('End', 'End', 'End', 'End', 35, 269, [0xe0, 0x4f]),
  k('PageUp', 'PgUp', 'PageUp', 'PageUp', 33, 266, [0xe0, 0x49]),
  k('PageDown', 'PgDn', 'PageDown', 'PageDown', 34, 267, [0xe0, 0x51]),
  k('ArrowLeft', '←', 'ArrowLeft', 'ArrowLeft', 37, 263, [0xe0, 0x4b]),
  k('ArrowUp', '↑', 'ArrowUp', 'ArrowUp', 38, 265, [0xe0, 0x48]),
  k('ArrowDown', '↓', 'ArrowDown', 'ArrowDown', 40, 264, [0xe0, 0x50]),
  k('ArrowRight', '→', 'ArrowRight', 'ArrowRight', 39, 262, [0xe0, 0x4d]),
  k('Control', 'Ctrl', 'Control', 'ControlLeft', 17, 341, [0x1d], true),
  k('Alt', 'Alt', 'Alt', 'AltLeft', 18, 342, [0x38], true),
  k('Shift', 'Shift', 'Shift', 'ShiftLeft', 16, 340, [0x2a], true),
  // Letters and digits (for the gamepad mapping); js-dos and keyCode use the ASCII code.
  ...[...'QWERTYUIOP'].map((c, i) => letter(c, 0x10 + i)),
  ...[...'ASDFGHJKL'].map((c, i) => letter(c, 0x1e + i)),
  ...[...'ZXCVBNM'].map((c, i) => letter(c, 0x2c + i)),
  ...[...'1234567890'].map((c, i) => k(`Digit${c}`, c, c, `Digit${c}`, c.charCodeAt(0), c.charCodeAt(0), [0x02 + i])),
];

function letter(c, scan) {
  return k(`Key${c}`, c, c.toLowerCase(), `Key${c}`, c.charCodeAt(0), c.charCodeAt(0), [scan]);
}

export const KEY_BY_ID = new Map(VIRTUAL_KEYS.map((key) => [key.id, key]));

/** Scancodes for releasing a key (set 1: press code + 0x80, after the 0xE0 prefix). */
export function releaseScancodes(key) {
  const codes = [...key.scan];
  codes[codes.length - 1] |= 0x80;
  return codes;
}

/**
 * Sends a key as browser keyboard event, as if it was typed. Emscripten programs
 * (Boxedwine, EmulatorJS) read keyCode/which, which a constructed event leaves at 0,
 * so they are set on the event.
 * @param {EventTarget} target
 * @param {VirtualKey} key
 * @param {boolean} pressed
 * @param {{ctrlKey?:boolean, altKey?:boolean, shiftKey?:boolean}} [mods]
 */
export function dispatchKey(target, key, pressed, mods = {}) {
  const event = new KeyboardEvent(pressed ? 'keydown' : 'keyup', {
    key: key.key, code: key.code, bubbles: true, cancelable: true, ...mods,
  });
  Object.defineProperty(event, 'keyCode', { get: () => key.keyCode });
  Object.defineProperty(event, 'which', { get: () => key.keyCode });
  Object.defineProperty(event, 'charCode', { get: () => 0 });
  target.dispatchEvent(event);
}
