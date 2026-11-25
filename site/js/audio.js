// Browsers start Web Audio only after a user action. The emulators create
// their AudioContext seconds after the click (when everything is downloaded),
// so it can start "suspended" and stay silent. All contexts created on this
// page are tracked and resumed on the next click or key press.
//
// Everything an emulator sends to the speakers goes through one master gain per
// context, so the sound button can mute every emulator the same way.

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

let muted = false;

/** The master gain of a context: sits between the emulator and the speakers. */
function master(ctx) {
  if (!ctx.__rtaMaster) {
    ctx.__rtaMaster = ctx.createGain();
    ctx.__rtaMaster.gain.value = muted ? 0 : 1;
    connect.call(ctx.__rtaMaster, ctx.destination);
  }
  return ctx.__rtaMaster;
}

const { connect, disconnect } = AudioNode.prototype;
AudioNode.prototype.connect = function (target, ...rest) {
  if (target instanceof AudioDestinationNode && this !== target.context.__rtaMaster) {
    return connect.call(this, master(target.context), ...rest);
  }
  return connect.call(this, target, ...rest);
};
AudioNode.prototype.disconnect = function (target, ...rest) {
  if (target instanceof AudioDestinationNode && target.context.__rtaMaster) {
    return disconnect.call(this, target.context.__rtaMaster, ...rest);
  }
  return disconnect.call(this, target, ...rest);
};

/** Mutes or unmutes all emulator sound (also audio created later). */
export function setMuted(value) {
  muted = value;
  for (const ctx of contexts) {
    if (ctx.__rtaMaster) ctx.__rtaMaster.gain.value = muted ? 0 : 1;
  }
}

export const isMuted = () => muted;

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
