import { audioSuspended } from './audio.js';
import { fromDataTransfer, fromDirectoryHandle, fromFileList, findPrograms, totalSize } from './workspace.js';
import { fetchWithProgress } from './runner.js';
import { WindowsRunner, canUseThreads, clearPersistentStorage } from './emulator.js';
import { DosRunner } from './dos.js';
import { EmulatorJsRunner, findBiosInWorkspace } from './ejs.js';
import { V86Runner } from './v86.js';
import { KIND_LABELS } from './exe.js';
import { SYSTEMS, SYSTEM_BY_ID } from './systems.js';

const $ = (id) => document.getElementById(id);

const MAX_LOG_LINES = 2000;
const hasDirectoryPicker = typeof window.showDirectoryPicker === 'function';

/** @type {import('./workspace.js').Workspace|null} */
let workspace = null;
/** @type {import('./workspace.js').Program[]} */
let programs = [];
/** @type {import('./runner.js').Runner|null} */
let emulator = null;
/** BIOS files chosen by the user for the selected game. */
let chosenBios = [];

const EMULATOR_NAMES = { dos: 'DOSBox', windows: 'Boxedwine', emulatorjs: 'EmulatorJS', v86: 'v86' };

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function showError(message) {
  const el = $('pick-error');
  el.textContent = message;
  el.hidden = !message;
}

// ---------------------------------------------------------------------------
// Step 1: picking files

async function openWorkspace(loader, autostart) {
  showError('');
  try {
    const ws = await loader();
    if (!ws || ws.files.length === 0) throw new Error('Keine Dateien gefunden.');
    const found = await findPrograms(ws);
    if (found.length === 0) throw new Error('Kein startbares Programm oder Spiel gefunden.');
    workspace = ws;
    programs = found;
    showChooser();
    if (autostart) {
      const radio = [...document.querySelectorAll('input[name="program"]')]
        .find((r) => r.value.toLowerCase() === autostart.program.toLowerCase());
      if (radio) radio.checked = true;
      updateSystemPanel();
      if (autostart.system) {
        $('opt-system').value = autostart.system;
        updateBiosInfo();
      }
      // Options a demo needs only for this start (not saved as user settings).
      start(Object.fromEntries(Object.entries({ wine: autostart.wine, args: autostart.args, cycles: autostart.cycles }).filter(([, v]) => v)));
    }
  } catch (err) {
    if (err?.name === 'AbortError') return; // user cancelled a picker
    console.error(err);
    showError(err.message || String(err));
  }
}

$('btn-files').addEventListener('click', () => $('input-files').click());
$('input-files').addEventListener('change', (e) => {
  const files = e.target.files;
  if (files.length) openWorkspace(() => fromFileList(files));
  e.target.value = '';
});

$('btn-folder').addEventListener('click', async () => {
  if (hasDirectoryPicker) {
    openWorkspace(async () => fromDirectoryHandle(await window.showDirectoryPicker({ mode: 'readwrite' })));
  } else {
    $('input-folder').click();
  }
});
$('input-folder').addEventListener('change', (e) => {
  const files = e.target.files;
  if (files.length) openWorkspace(() => fromFileList(files));
  e.target.value = '';
});

$('folder-hint').textContent = hasDirectoryPicker
  ? 'Bei geöffneten Ordnern können geänderte Dateien (z. B. Spielstände) zurück in den Ordner geschrieben werden.'
  : 'Geänderte Dateien (z. B. Spielstände) kannst du nach dem Spielen als ZIP sichern.';

const dropzone = $('dropzone');
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('over'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('over'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('over');
  const promise = fromDataTransfer(e.dataTransfer); // must read the DataTransfer synchronously
  openWorkspace(() => promise);
});
// Avoid the browser opening a file dropped next to the drop zone.
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

// ---------------------------------------------------------------------------
// Step 2: choosing the program and options

function showChooser() {
  $('ws-summary').textContent =
    `${workspace.name}: ${workspace.files.length} Datei(en), ${formatSize(totalSize(workspace))}`;

  const list = $('program-list');
  list.replaceChildren(...programs.map((p, i) => {
    const li = document.createElement('li');
    const label = document.createElement('label');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'program';
    radio.value = p.path;
    radio.checked = i === 0;
    const name = document.createElement('span');
    name.className = 'prog-name';
    name.textContent = p.path;
    const size = document.createElement('span');
    size.className = 'prog-size';
    size.textContent = formatSize(p.size);
    const kind = document.createElement('span');
    kind.className = `kind ${p.emulator}`;
    if (p.kind === 'game') {
      kind.textContent = SYSTEM_BY_ID.get(p.systems[0]).label + (p.systems.length > 1 ? ' ?' : '');
    } else if (p.kind === 'bat' || p.kind === 'unknown') {
      kind.textContent = `${KIND_LABELS[p.kind]} (${p.emulator === 'dos' ? 'DOS' : 'Windows'})`;
    } else {
      kind.textContent = KIND_LABELS[p.kind];
    }
    kind.title = `Läuft mit ${EMULATOR_NAMES[p.emulator]}`;
    label.append(radio, name, kind, size);
    label.addEventListener('dblclick', () => start());
    radio.addEventListener('change', updateSystemPanel);
    li.append(label);
    return li;
  }));

  $('pick').hidden = true;
  $('choose').hidden = false;
  updateSystemPanel();
  $('btn-start').focus();
}

function selectedProgram() {
  const selected = document.querySelector('input[name="program"]:checked');
  return programs.find((p) => p.path === selected?.value);
}

/** Shows system choice and BIOS hints for console/home computer games. */
function updateSystemPanel() {
  const program = selectedProgram();
  const panel = $('system-panel');
  panel.hidden = program?.kind !== 'game';
  if (panel.hidden) return;

  chosenBios = [];
  $('bios-chosen').textContent = '';
  const select = $('opt-system');
  const candidates = program.systems.map((id) => SYSTEM_BY_ID.get(id));
  const others = SYSTEMS.filter((s) => !program.systems.includes(s.id));
  const option = (s) => Object.assign(document.createElement('option'), { value: s.id, textContent: s.label });
  const group = Object.assign(document.createElement('optgroup'), { label: 'Andere Systeme' });
  group.append(...others.map(option));
  select.replaceChildren(...candidates.map(option), group);
  select.value = candidates[0].id;
  updateBiosInfo();
}

function updateBiosInfo() {
  const system = SYSTEM_BY_ID.get($('opt-system').value);
  const bios = system.bios;
  const info = $('bios-info');
  const found = findBiosInWorkspace(system, workspace).map((f) => f.path.split('/').pop());
  const have = [...found, ...chosenBios.map((f) => f.name)];
  let text;
  let warn = false;
  if (!bios || (bios.files.length === 0 && !bios.builtin)) {
    text = 'Kein BIOS nötig.';
  } else if (have.length) {
    text = `BIOS: ${have.join(', ')}`;
  } else if (bios.required) {
    text = `Benötigt eine BIOS-Datei: ${bios.files.join(', ')}. Lege sie mit ins ZIP/in den Ordner oder füge sie hier hinzu.`;
    warn = true;
  } else {
    text = [bios.builtin ? `Kein BIOS nötig (${bios.builtin}).` : 'Kein BIOS nötig.',
      bios.note, bios.files.length ? `Optional: ${bios.files.join(', ')}` : ''].filter(Boolean).join(' ');
  }
  info.textContent = text;
  info.classList.toggle('warn', warn);
  $('btn-bios').hidden = !bios || bios.files.length === 0;
}

$('opt-system').addEventListener('change', updateBiosInfo);
$('btn-bios').addEventListener('click', () => $('input-bios').click());
$('input-bios').addEventListener('change', (e) => {
  chosenBios = [...e.target.files];
  $('bios-chosen').textContent = chosenBios.map((f) => f.name).join(', ');
  e.target.value = '';
  updateBiosInfo();
});

$('btn-reset').addEventListener('click', () => {
  workspace = null;
  $('choose').hidden = true;
  $('pick').hidden = false;
});

const threadsAvailable = canUseThreads();
$('thread-info').textContent = threadsAvailable
  ? 'Multithreading ist verfügbar, „Automatisch“ nutzt die schnellere Variante.'
  : 'Multithreading ist hier nicht verfügbar (Seite nicht „cross-origin isolated“). Es wird die Singlethread-Variante genutzt.';
if (!threadsAvailable) $('opt-threads').querySelector('option[value="mt"]').disabled = true;

// Remember options between visits.
const OPTION_IDS = ['opt-wine', 'opt-threads', 'opt-resolution', 'opt-bpp', 'opt-sound', 'opt-persistent', 'opt-cycles', 'opt-memory'];
try {
  const saved = JSON.parse(localStorage.getItem('runthemall-options') || '{}');
  for (const id of OPTION_IDS) {
    const el = $(id);
    if (!(id in saved)) continue;
    if (el.type === 'checkbox') el.checked = saved[id];
    else if ([...el.options].some((o) => o.value === saved[id] && !o.disabled)) el.value = saved[id];
  }
} catch { /* ignore broken settings */ }

function readOptions() {
  const saved = {};
  for (const id of OPTION_IDS) saved[id] = $(id).type === 'checkbox' ? $(id).checked : $(id).value;
  localStorage.setItem('runthemall-options', JSON.stringify(saved));
  return {
    wine: $('opt-wine').value,
    threads: $('opt-threads').value,
    resolution: $('opt-resolution').value,
    bpp: Number($('opt-bpp').value),
    sound: $('opt-sound').checked,
    persistent: $('opt-persistent').checked,
    cycles: $('opt-cycles').value,
    memory: Number($('opt-memory').value),
  };
}

// ---------------------------------------------------------------------------
// Step 3: running

const consoleOut = $('console-output');
function log(line, isError) {
  const div = document.createElement('div');
  div.textContent = line;
  if (isError) div.className = 'err';
  consoleOut.append(div);
  while (consoleOut.childElementCount > MAX_LOG_LINES) consoleOut.firstElementChild.remove();
  consoleOut.scrollTop = consoleOut.scrollHeight;
}

function status(text, fraction) {
  $('status-text').textContent = text;
  const bar = $('status-progress');
  bar.hidden = fraction === undefined;
  if (fraction !== undefined) bar.value = fraction;
}

function message(text) {
  $('run-message').textContent = text;
}

// Loading screen with steps and a progress bar
let loaderSteps = [];
function setSteps(labels) {
  loaderSteps = labels.map((label) => Object.assign(document.createElement('li'), { textContent: label }));
  $('loader-steps').replaceChildren(...loaderSteps);
}
function setStep(index, detail = '') {
  loaderSteps.forEach((li, i) => {
    li.classList.toggle('done', i < index);
    li.classList.toggle('active', i === index);
  });
  $('loader-progress').hidden = true;
  $('loader-detail').textContent = detail;
}
const mb = (n) => (n / 1048576).toFixed(1).replace('.', ',');
function setProgress(loaded, total) {
  const bar = $('loader-progress');
  bar.hidden = false;
  if (total > 0) {
    bar.value = Math.min(1, loaded / total);
    $('loader-detail').textContent = `${mb(loaded)} von ${mb(total)} MB`;
  } else {
    bar.removeAttribute('value');
    $('loader-detail').textContent = `${mb(loaded)} MB`;
  }
}
function hideLoader() {
  loaderSteps.forEach((li) => { li.classList.remove('active'); li.classList.add('done'); });
  $('loader').hidden = true;
  // The browser may hold back the sound until the next click or key press (see audio.js).
  setTimeout(() => {
    if (!$('opt-sound').checked || !audioSuspended()) return;
    message('Kein Ton? Einmal ins Bild klicken oder eine Taste drücken, dann gibt der Browser den Ton frei.');
    const clear = () => setTimeout(() => { if (!audioSuspended()) message(''); }, 300);
    window.addEventListener('pointerdown', clear, { once: true, capture: true });
    window.addEventListener('keydown', clear, { once: true, capture: true });
  }, 2000);
}

/** @param {object} [overrides] options a demo needs, e.g. a Wine version (not saved as user setting) */
async function start(overrides = {}) {
  const program = selectedProgram();
  if (!workspace || !program) return;
  const opts = { ...readOptions(), ...overrides };
  if (program.kind === 'game') {
    opts.system = $('opt-system').value;
    opts.biosFiles = chosenBios;
  }

  $('choose').hidden = true;
  hideDemoDetail();
  $('demos').hidden = true;
  $('run').hidden = false;
  const what = program.kind === 'game' ? SYSTEM_BY_ID.get(opts.system).label : EMULATOR_NAMES[program.emulator];
  $('run-title').textContent = `${program.path} (${what})`;

  const ui = {
    canvas: $('canvas'), dosContainer: $('dos-container'), ejsContainer: $('ejs-container'), v86Container: $('v86-container'), status, log,
    steps: setSteps, step: setStep, progress: setProgress, ready: hideLoader,
    emulatorInfo: (text) => { $('run-emulator').textContent = text; },
  };
  $('loader').hidden = false;
  if (program.kind === 'win16' && opts.wine === 'wine11') {
    // The Wine 11 file system of the web release has no 16-bit Windows support.
    opts.wine = 'wine6';
    log('16-Bit-Programm: Wine 11 unterstützt hier kein Win16, verwende Wine 6.', false);
  }
  const Runner = opts.system && SYSTEM_BY_ID.get(opts.system).emulator === 'v86'
    ? V86Runner
    : { dos: DosRunner, windows: WindowsRunner, emulatorjs: EmulatorJsRunner }[program.emulator];
  emulator = new Runner(ui);
  $('btn-download').hidden = !emulator.supportsFileSync;
  $('btn-writeback').hidden = !emulator.supportsFileSync || !workspace.dirHandle;
  try {
    await emulator.start(workspace, program.path, opts);
  } catch (err) {
    console.error(err);
    status(`Fehler: ${err.message || err}`);
    $('loader-detail').textContent = `Fehler: ${err.message || err}`;
    log(String(err?.stack || err), true);
  }
}

$('btn-start').addEventListener('click', () => start());

/**
 * Message box (modal dialog) with a title, text and an optional list of files.
 * @param {string} title
 * @param {string} text
 * @param {string[]} [files]
 * @param {boolean} [error]
 */
function showDialog(title, text, files = [], error = false) {
  const dialog = $('msg-dialog');
  $('msg-title').textContent = title;
  $('msg-text').textContent = text;
  const max = 20;
  $('msg-files').replaceChildren(...files.slice(0, max).map((f) => Object.assign(document.createElement('li'), { textContent: f })),
    ...(files.length > max ? [Object.assign(document.createElement('li'), { className: 'more', textContent: `… und ${files.length - max} weitere` })] : []));
  $('msg-files').hidden = files.length === 0;
  dialog.classList.toggle('error', error);
  dialog.showModal();
  $('msg-ok').focus();
}
$('msg-ok').addEventListener('click', () => $('msg-dialog').close());

const NOTHING_CHANGED = 'Seit dem Start hat das Programm keine Dateien geändert oder neu angelegt. '
  + 'Spielstände entstehen meist erst, wenn du im Programm speicherst.';

$('btn-download').addEventListener('click', async () => {
  try {
    const files = (await emulator?.downloadChanges()) ?? [];
    message('');
    if (files.length) {
      showDialog('Geänderte Dateien gesichert',
        `${files.length === 1 ? 'Eine Datei wurde' : `${files.length} Dateien wurden`} als ZIP in deinen Downloads gespeichert:`, files);
    } else {
      showDialog('Nichts zu sichern', NOTHING_CHANGED);
    }
  } catch (err) {
    showDialog('Sichern fehlgeschlagen', String(err.message || err), [], true);
  }
});

$('btn-writeback').addEventListener('click', async () => {
  try {
    const files = await emulator.writeBack();
    message('');
    if (files.length) {
      showDialog('In Ordner zurückgeschrieben',
        `${files.length === 1 ? 'Eine Datei wurde' : `${files.length} Dateien wurden`} in den geöffneten Ordner „${workspace.name}“ geschrieben:`, files);
    } else {
      showDialog('Nichts zurückzuschreiben', NOTHING_CHANGED);
    }
  } catch (err) {
    showDialog('Zurückschreiben fehlgeschlagen', String(err.message || err), [], true);
  }
});

// Fullscreen: the whole emulator area (canvas or player) covers the screen.
$('btn-fullscreen').addEventListener('click', () => {
  const screen = $('screen');
  if (screen.requestFullscreen) screen.requestFullscreen().catch(() => emulator?.fullscreen());
  else emulator?.fullscreen();
});

$('btn-restart').addEventListener('click', () => {
  if (!confirm('Programm beenden? Nicht gesicherte Änderungen gehen verloren.')) return;
  if (emulator) emulator.running = false; // skip the beforeunload prompt
  location.reload();
});

window.addEventListener('beforeunload', (e) => {
  if (emulator?.running) e.preventDefault();
});

// ---------------------------------------------------------------------------
// Demo launcher: free programs/games fetched at build time (see demos/demos.json)

async function launchDemo(demo, button) {
  const label = button.textContent;
  button.disabled = true;
  try {
    const data = await fetchWithProgress(`demos/${demo.file}`, (loaded, total) => {
      button.textContent = total ? `Lade … ${Math.round((loaded / total) * 100)} %` : 'Lade …';
    });
    const file = new File([data], demo.file.split('/').pop());
    await openWorkspace(() => fromFileList([file]), { program: demo.start, system: demo.system, wine: demo.wine, args: demo.args, cycles: demo.cycles });
  } catch (err) {
    showError(`Demo konnte nicht geladen werden: ${err.message || err}`);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

let demoAnchor = null; // tree entry the detail popover belongs to

/** Shows description, credits and the start button of a demo next to its tree entry. */
function showDemoDetail(demo, anchor) {
  const start = el('button', { type: 'button', className: 'wx-btn wx-go wx-small', textContent: 'Starten' });
  start.addEventListener('click', () => launchDemo(demo, start));
  const close = el('button', { type: 'button', className: 'demo-close', title: 'Schließen', textContent: '×' });
  close.setAttribute('aria-label', 'Schließen');
  close.addEventListener('click', hideDemoDetail);
  const link = el('a', { href: demo.homepage, textContent: demo.author, rel: 'noopener' });
  $('demo-detail').replaceChildren(
    close,
    el('h3', { textContent: demo.title }),
    el('p', { className: 'demo-meta', textContent: `${demo.platform} · ${demo.emulator}` }),
    el('p', { textContent: demo.description }),
    el('p', { className: 'demo-meta' }, 'von ', link, ` · ${demo.license}`),
    start,
  );
  $('demo-tree').querySelectorAll('[aria-current]').forEach((b) => b.removeAttribute('aria-current'));
  anchor.setAttribute('aria-current', 'true');
  demoAnchor = anchor;
  $('demo-detail').hidden = false;
  placeDemoDetail();
  return start;
}

function hideDemoDetail() {
  $('demo-detail').hidden = true;
  demoAnchor?.removeAttribute('aria-current');
  demoAnchor = null;
}

/** Places the popover left of the selected entry (below it when the menu sits under the main column). */
function placeDemoDetail() {
  const pop = $('demo-detail');
  if (pop.hidden || !demoAnchor) return;
  const item = demoAnchor.getBoundingClientRect();
  const side = $('demos').getBoundingClientRect();
  const gap = 12;
  const narrow = side.left - 320 - gap < 8;
  pop.classList.toggle('below', narrow);
  pop.style.width = narrow ? `${side.width}px` : '';
  const { width, height } = pop.getBoundingClientRect();
  const maxTop = window.innerHeight - height - 8;
  const top = narrow ? Math.min(item.bottom + 6, maxTop) : Math.min(Math.max(item.top - 8, 8), maxTop);
  pop.style.left = `${narrow ? side.left : side.left - width - gap}px`;
  pop.style.top = `${Math.max(top, 8)}px`;
  // Arrow points at the middle of the entry.
  pop.style.setProperty('--arrow', `${Math.min(Math.max(item.top + item.height / 2 - top, 16), height - 16)}px`);
}

window.addEventListener('resize', placeDemoDetail);
window.addEventListener('scroll', placeDemoDetail, { passive: true });
$('demos').addEventListener('scroll', placeDemoDetail, { passive: true });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('demo-detail').hidden) {
    demoAnchor?.focus();
    hideDemoDetail();
  }
});
document.addEventListener('pointerdown', (e) => {
  if (!$('demo-detail').hidden && !e.target.closest('#demo-detail, .demo-item')) hideDemoDetail();
});

/** Builds the tree: one group per platform (in order of first appearance), demos below. */
function renderDemoTree(list) {
  const groups = new Map();
  for (const demo of list) {
    if (!groups.has(demo.platform)) groups.set(demo.platform, []);
    groups.get(demo.platform).push(demo);
  }
  $('demo-tree').replaceChildren(...[...groups].map(([platform, demos]) => {
    const items = demos.map((demo) => {
      const button = el('button', { type: 'button', className: 'demo-item', title: demo.description },
        el('span', { className: 'demo-name', textContent: demo.title }),
        el('span', { className: 'demo-file', textContent: demo.start }));
      button.addEventListener('click', () => {
        if (demoAnchor === button) hideDemoDetail();
        else showDemoDetail(demo, button);
      });
      button.addEventListener('dblclick', () => showDemoDetail(demo, button).click());
      return el('li', {}, button);
    });
    return el('details', { className: 'demo-group', open: true },
      el('summary', {}, platform, el('span', { className: 'demo-count', textContent: String(demos.length) })),
      el('ul', {}, ...items));
  }));
}

// Own operating system: any disk image boots as a complete PC (v86).
$('btn-own-os').addEventListener('click', () => $('input-own-os').click());
$('input-own-os').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) openWorkspace(() => fromFileList([file]), { program: file.name, system: 'pc' });
});

fetch('demos/demos.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((list) => {
    if (!list?.length) return;
    renderDemoTree(list);
    $('demos').hidden = !$('run').hidden;
  })
  .catch(() => {});

// ---------------------------------------------------------------------------
// Footer

$('btn-clear').addEventListener('click', async () => {
  if (emulator?.running) {
    alert('Bitte zuerst das laufende Programm beenden.');
    return;
  }
  if (!confirm('Virtuelle Umgebung zurücksetzen?\n\n'
    + 'Das betrifft nur Daten, die Windows-Programme hier im Browser abgelegt haben: '
    + 'Einstellungen, dort installierte Programme und Spielstände.\n\n'
    + 'Dateien auf deinem Computer bleiben unberührt. Beim nächsten Start wird die Umgebung neu eingerichtet.')) return;
  await clearPersistentStorage();
  alert('Die virtuelle Umgebung wurde zurückgesetzt. Beim nächsten Start eines Windows-Programms wird sie neu eingerichtet.');
});

fetch('jsdos/version.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((v) => {
    if (!v) return;
    $('jsdos-version').textContent = v.jsdos;
    $('jsdos-sources').replaceChildren(...v.sources.flatMap((src, i) => {
      const a = document.createElement('a');
      a.href = `jsdos/${src}`;
      a.textContent = src.replace(/^source\//, '').replace(/-source\.tar\.gz$/, '');
      return i ? [', ', a] : [a];
    }));
  })
  .catch(() => {});

fetch('emulatorjs/version.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((v) => {
    if (!v) return;
    $('ejs-version').textContent = v.version;
    $('ejs-source').href = `emulatorjs/source/EmulatorJS-${v.version}-source.tar.gz`;
  })
  .catch(() => {});

fetch('boxedwine/version.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((v) => {
    if (!v) return;
    $('bw-version').textContent = v.tag;
    $('bw-source').href = `boxedwine/source/Boxedwine-${v.tag}-source.tar.gz`;
  })
  .catch(() => {});

fetch('v86/version.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((v) => {
    if (!v) return;
    $('v86-version').textContent = v.v86;
    $('v86-sources').replaceChildren(...v.sources.flatMap((src, i) => {
      const a = document.createElement('a');
      a.href = `v86/${src}`;
      a.textContent = src.replace(/^source\//, '').replace(/-source\.tar\.gz$/, '');
      return i ? [', ', a] : [a];
    }));
  })
  .catch(() => {});
