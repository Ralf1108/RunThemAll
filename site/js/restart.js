// Restart with other options: the emulators cannot be stopped and started again
// cleanly in the same page, so the page reloads. What is needed to start the same
// program again is kept in IndexedDB for this one reload and deleted right after.

const DB = 'runthemall-restart';
const STORE = 'pending';
const KEY = 'next';

/** A kept restart is only used within this time; older ones are just deleted. */
export const RESTART_TTL_MS = 10 * 60 * 1000;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run(mode, action) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * @typedef {object} RestartPlan
 * @property {string} [demoId]          a demo: started again from the demo list
 * @property {string} program           path of the program to start
 * @property {string} [system]          system of a game
 * @property {object} options           start options
 * @property {string} [name]            name of the workspace
 * @property {{path:string, blob:Blob}[]} [files]  the user's files
 * @property {FileSystemDirectoryHandle} [dirHandle] an opened folder (used again if the permission is still there)
 * @property {File[]} [bios]            BIOS files chosen for the game
 */

/** @param {RestartPlan} plan */
export function saveRestart(plan) {
  return run('readwrite', (store) => store.put({ ...plan, savedAt: Date.now() }, KEY));
}

/**
 * The plan saved before the reload, if any. It is deleted on every page load,
 * so the files never stay longer than until the page is opened again; a plan
 * older than RESTART_TTL_MS is deleted without being used.
 * @returns {Promise<RestartPlan|null>}
 */
export async function takeRestart() {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const plan = await run('readonly', (store) => store.get(KEY));
    if (!plan) return null;
    await run('readwrite', (store) => store.delete(KEY));
    return Date.now() - (plan.savedAt ?? 0) <= RESTART_TTL_MS ? plan : null;
  } catch {
    return null;
  }
}
