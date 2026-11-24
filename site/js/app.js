import { fromDataTransfer, fromDirectoryHandle, fromFileList, findPrograms, totalSize } from './workspace.js';
import { WindowsRunner, canUseThreads, clearPersistentStorage } from './emulator.js';
import { DosRunner } from './dos.js';
import { KIND_LABELS } from './exe.js';

const $ = (id) => document.getElementById(id);

const MAX_LOG_LINES = 2000;
const hasDirectoryPicker = typeof window.showDirectoryPicker === 'function';

/** @type {import('./workspace.js').Workspace|null} */
let workspace = null;
/** @type {import('./workspace.js').Program[]} */
let programs = [];
/** @type {import('./runner.js').Runner|null} */
let emulator = null;

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

async function openWorkspace(loader) {
  showError('');
  try {
    const ws = await loader();
    if (!ws || ws.files.length === 0) throw new Error('Keine Dateien gefunden.');
    const found = await findPrograms(ws);
    if (found.length === 0) throw new Error('Keine ausführbare Datei (.exe, .com oder .bat) gefunden.');
    workspace = ws;
    programs = found;
    showChooser();
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
    kind.textContent = p.kind === 'bat' || p.kind === 'unknown'
      ? `${KIND_LABELS[p.kind]} (${p.emulator === 'dos' ? 'DOS' : 'Windows'})`
      : KIND_LABELS[p.kind];
    kind.title = p.emulator === 'dos' ? 'Läuft mit DOSBox' : 'Läuft mit Boxedwine';
    label.append(radio, name, kind, size);
    label.addEventListener('dblclick', () => start());
    li.append(label);
    return li;
  }));

  $('pick').hidden = true;
  $('choose').hidden = false;
  $('btn-start').focus();
}

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
const OPTION_IDS = ['opt-wine', 'opt-threads', 'opt-resolution', 'opt-bpp', 'opt-sound', 'opt-persistent', 'opt-cycles'];
try {
  const saved = JSON.parse(localStorage.getItem('webexe-options') || '{}');
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
  localStorage.setItem('webexe-options', JSON.stringify(saved));
  return {
    wine: $('opt-wine').value,
    threads: $('opt-threads').value,
    resolution: $('opt-resolution').value,
    bpp: Number($('opt-bpp').value),
    sound: $('opt-sound').checked,
    persistent: $('opt-persistent').checked,
    cycles: $('opt-cycles').value,
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

async function start() {
  const selected = document.querySelector('input[name="program"]:checked');
  const program = programs.find((p) => p.path === selected?.value);
  if (!workspace || !program) return;
  const opts = readOptions();

  $('choose').hidden = true;
  $('run').hidden = false;
  $('run-title').textContent = `${program.path} (${program.emulator === 'dos' ? 'DOSBox' : 'Boxedwine'})`;
  $('btn-writeback').hidden = !workspace.dirHandle;

  const ui = { canvas: $('canvas'), dosContainer: $('dos-container'), status, log };
  emulator = program.emulator === 'dos' ? new DosRunner(ui) : new WindowsRunner(ui);
  try {
    await emulator.start(workspace, program.path, opts);
  } catch (err) {
    console.error(err);
    status(`Fehler: ${err.message || err}`);
    log(String(err?.stack || err), true);
  }
}

$('btn-start').addEventListener('click', start);

$('btn-download').addEventListener('click', async () => {
  try {
    const n = (await emulator?.downloadChanges()) ?? 0;
    message(n ? `${n} geänderte Datei(en) als ZIP gesichert.` : 'Keine geänderten Dateien gefunden.');
  } catch (err) {
    message(`Sichern fehlgeschlagen: ${err.message || err}`);
  }
});

$('btn-writeback').addEventListener('click', async () => {
  try {
    const n = await emulator.writeBack();
    message(n ? `${n} Datei(en) in den Ordner zurückgeschrieben.` : 'Keine geänderten Dateien gefunden.');
  } catch (err) {
    message(`Zurückschreiben fehlgeschlagen: ${err.message || err}`);
  }
});

$('btn-fullscreen').addEventListener('click', () => emulator?.fullscreen());

$('btn-restart').addEventListener('click', () => {
  if (!confirm('Programm beenden? Nicht gesicherte Änderungen gehen verloren.')) return;
  if (emulator) emulator.running = false; // skip the beforeunload prompt
  location.reload();
});

window.addEventListener('beforeunload', (e) => {
  if (emulator?.running) e.preventDefault();
});

// ---------------------------------------------------------------------------
// Footer

$('btn-clear').addEventListener('click', async () => {
  if (emulator?.running) {
    alert('Bitte zuerst das laufende Programm beenden.');
    return;
  }
  if (!confirm('Gespeichertes Laufwerk C: (Wine-Einstellungen und installierte Programme) löschen?')) return;
  await clearPersistentStorage();
  alert('Gespeichertes Laufwerk C: wurde gelöscht.');
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

fetch('boxedwine/version.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((v) => {
    if (!v) return;
    $('bw-version').textContent = v.tag;
    $('bw-source').href = `boxedwine/source/Boxedwine-${v.tag}-source.tar.gz`;
  })
  .catch(() => {});
