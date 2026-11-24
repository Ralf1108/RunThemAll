// Browsers start Web Audio only after a user action. The emulators create
// their AudioContext seconds after the click (when everything is downloaded),
// so it can start "suspended" and stay silent. All contexts created on this
// page are tracked and resumed on the next click or key press.

const contexts = new Set();

for (const name of ['AudioContext', 'webkitAudioContext']) {
  const Original = window[name];
  if (typeof Original !== 'function') continue;
  window[name] = class extends Original {
    constructor(...args) {
      super(...args);
      contexts.add(this);
      this.addEventListener?.('statechange', () => { if (this.state === 'closed') contexts.delete(this); });
    }
  };
}

/** Resumes every suspended audio context. */
export function resumeAudio() {
  for (const ctx of contexts) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }
}

/** True if an emulator has created audio that the browser still holds back. */
export function audioSuspended() {
  return [...contexts].some((ctx) => ctx.state === 'suspended');
}

for (const type of ['pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(type, resumeAudio, { capture: true, passive: true });
}
