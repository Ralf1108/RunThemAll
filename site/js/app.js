import { audioSuspended, isMuted, setMuted } from './audio.js';
import { fromDataTransfer, fromDirectoryHandle, fromFileList, fromStoredFiles, findPrograms, totalSize } from './workspace.js';
import { saveRestart, takeRestart } from './restart.js';
import { KEY_BY_ID, VIRTUAL_KEYS } from './keys.js';
import { fetchWithProgress } from './runner.js';
import { WindowsRunner, canUseThreads, clearPersistentStorage } from './emulator.js';
import { DosRunner } from './dos.js';
import { EmulatorJsRunner, findBiosInWorkspace } from './ejs.js';
import { V86Runner } from './v86.js';
import { KIND_LABELS } from './exe.js';
import { SYSTEMS, SYSTEM_BY_ID } from './systems.js';
import { platformStyle, SUPPORTED_GROUPS, supportedItems } from './platforms.js';
import { buildReport, fittingIssueUrl, isCrashError, isCrashLine, MAX_ATTACHMENT, PLATFORMS, sha256, zipFiles } from './report.js';

const $ = (id) => document.getElementById(id);
/** Creates an element with properties and children. */
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

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
/** The demo that was opened, or null for the user's own files. */
let currentDemo = null;
/** What is running, for problem reports: { program, opts, crash }. */
let runInfo = null;

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
    if (!ws || ws.files.length === 0) throw new Error('No files found.');
    const found = await findPrograms(ws);
    if (found.length === 0) throw new Error('No program or game found that can be started.');
    workspace = ws;
    currentDemo = autostart?.demo ?? null;
    programs = found;
    showChooser();
    if (autostart) {
      const radio = [...document.querySelectorAll('input[name="program"]')]
        .find((r) => r.value.toLowerCase() === autostart.program.toLowerCase());
      if (radio) radio.checked = true;
      updateSystemPanel();
      if (autostart.bios?.length) {
        chosenBios = autostart.bios;
        $('bios-chosen').textContent = chosenBios.map((f) => f.name).join(', ');
      }
      if (autostart.system) {
        $('opt-system').value = autostart.system;
        updateBiosInfo();
      }
      // Options of a demo apply only to this start (not saved as general settings).
      start(autostart.options ?? {});
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
  ? 'For opened folders, changed files (e.g. save games) can be written back into the folder.'
  : 'You can save changed files (e.g. save games) as a ZIP after playing.';

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
    `${workspace.name}: ${workspace.files.length} file(s), ${formatSize(totalSize(workspace))}`;

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
    kind.title = `Runs with ${EMULATOR_NAMES[p.emulator]}`;
    label.append(radio, name, kind, size);
    label.addEventListener('dblclick', () => start());
    radio.addEventListener('change', updateSystemPanel);
    li.append(label);
    return li;
  }));

  $('pick').hidden = true;
  $('choose').hidden = false;
  hideDemoDetail();
  $('demos').hidden = true; // the demos would only distract from choosing the program
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
  const group = Object.assign(document.createElement('optgroup'), { label: 'Other systems' });
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
    text = 'No BIOS needed.';
  } else if (have.length) {
    text = `BIOS: ${have.join(', ')}`;
  } else if (bios.required) {
    text = `Needs a BIOS file: ${bios.files.join(', ')}. Put it into the ZIP/folder or add it here.`;
    warn = true;
  } else {
    text = [bios.builtin ? `No BIOS needed (${bios.builtin}).` : 'No BIOS needed.',
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
  $('demos').hidden = carousel.childElementCount === 0;
});

const threadsAvailable = canUseThreads();
$('thread-info').textContent = threadsAvailable
  ? 'Multithreading is available, "Automatic" uses the faster version.'
  : 'Multithreading is not available here (page is not "cross-origin isolated"). The single-threaded version is used.';
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
  return readCurrentOptions();
}

/** The general settings from the options form, without saving them. */
function readCurrentOptions() {
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
  if (isCrashLine(line)) markCrash(line);
}

/**
 * The program or the emulator crashed: open the console so the error is visible
 * and turn the Report button red. Only the first crash counts.
 * @param {string} reason
 */
function markCrash(reason) {
  if (!runInfo || runInfo.crash) return;
  runInfo.crash = reason.split('\n').slice(0, 6).join('\n');
  setConsoleOpen(true);
  $('btn-console').classList.add('wx-toggle', 'state-off');
  const button = $('btn-report');
  button.classList.add('wx-toggle', 'state-off');
  button.querySelector('span').textContent = 'Report crash';
  button.title = 'The program crashed – report it on GitHub with the details collected so far';
  message('The program seems to have crashed. The console below shows the error; "Report crash" prepares a GitHub issue with the details.');
  // Keep the picture of the moment of the crash for the report.
  const info = runInfo;
  emulator?.screenshot().then((blob) => { info.crashShot = blob; }, () => {});
}

// Errors the page did not catch (e.g. inside the emulator) go into the console; real crashes are marked.
function onPageError(error) {
  if (!runInfo) return;
  const text = String(error?.stack || error?.message || error);
  if (isCrashError(error)) {
    log(text, true);
    markCrash(text);
  } else if (!(error instanceof DOMException)) {
    log(text, true);
  }
}
window.addEventListener('error', (e) => onPageError(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => onPageError(e.reason));

/**
 * Status of the emulator while it loads: shown in the loading screen (its steps show
 * the progress). Once it runs, the Play/Pause button shows the state.
 */
function status(text) {
  if (!$('loader').hidden && text) $('loader-detail').textContent = text;
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
const mb = (n) => (n / 1048576).toFixed(1);
function setProgress(loaded, total) {
  const bar = $('loader-progress');
  bar.hidden = false;
  if (total > 0) {
    bar.value = Math.min(1, loaded / total);
    $('loader-detail').textContent = `${mb(loaded)} of ${mb(total)} MB`;
  } else {
    bar.removeAttribute('value');
    $('loader-detail').textContent = `${mb(loaded)} MB`;
  }
}
function hideLoader() {
  loaderSteps.forEach((li) => { li.classList.remove('active'); li.classList.add('done'); });
  $('loader').hidden = true;
  $('btn-pause').disabled = false; // the emulator is ready now
  // The browser may hold back the sound until the next click or key press (see audio.js).
  setTimeout(() => {
    if (isMuted() || !audioSuspended()) return;
    message('No sound? Click into the picture or press a key once, then the browser allows sound.');
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
  $('platforms').hidden = true; // the emulator gets the full width
  $('emulators').hidden = true;
  $('run').hidden = false;
  window.scrollTo({ top: 0 }); // the demos may have been scrolled into view
  const what = program.kind === 'game' ? SYSTEM_BY_ID.get(opts.system).label : EMULATOR_NAMES[program.emulator];
  $('run-title').textContent = `${program.path} (${what})`;

  const ui = {
    screen: $('screen'), canvas: $('canvas'), dosContainer: $('dos-container'), ejsContainer: $('ejs-container'), v86Container: $('v86-container'), status, log,
    steps: setSteps, step: setStep, progress: setProgress, ready: hideLoader,
    emulatorInfo: (text) => { $('run-emulator').textContent = text; },
    hint: message,
  };
  $('loader').hidden = false;
  if (program.kind === 'win16' && opts.wine === 'wine11') {
    // The Wine 11 file system of the web release has no 16-bit Windows support.
    opts.wine = 'wine6';
    log('16-bit program: Wine 11 has no Win16 support here, using Wine 6.', false);
  }
  const Runner = opts.system && SYSTEM_BY_ID.get(opts.system).emulator === 'v86'
    ? V86Runner
    : { dos: DosRunner, windows: WindowsRunner, emulatorjs: EmulatorJsRunner }[program.emulator];
  emulator = new Runner(ui);
  runInfo = { program, opts, crash: null };
  $('btn-changes').hidden = !emulator.supportsFileSync;
  $('btn-pause').hidden = !emulator.supportsPause;
  setPaused(false);
  setSound(opts.sound);
  try {
    await emulator.start(workspace, program.path, opts);
  } catch (err) {
    console.error(err);
    status(`Error: ${err.message || err}`);
    $('loader-detail').textContent = `Error: ${err.message || err}`;
    log(String(err?.stack || err), true);
    markCrash(`Could not start: ${err.message || err}`);
  }
}

$('btn-start').addEventListener('click', () => start());

/**
 * Message box (modal dialog) with a title, text, an optional list of files and buttons.
 * Without actions it has a single OK button. An action's handler runs after the dialog closed.
 * @param {string} title
 * @param {string} text
 * @param {string[]} [files]
 * @param {boolean} [error]
 * @param {{label:string, primary?:boolean, run?:()=>void}[]} [actions]
 * @param {Node|null} [body] extra content below the text (makes the dialog wider)
 */
function showDialog(title, text, files = [], error = false, actions = [{ label: 'OK', primary: true }], body = null) {
  const dialog = $('msg-dialog');
  $('msg-title').textContent = title;
  $('msg-text').textContent = text;
  const max = 20;
  $('msg-files').replaceChildren(...files.slice(0, max).map((f) => Object.assign(document.createElement('li'), { textContent: f })),
    ...(files.length > max ? [Object.assign(document.createElement('li'), { className: 'more', textContent: `… and ${files.length - max} more` })] : []));
  $('msg-files').hidden = files.length === 0;
  dialog.classList.toggle('error', error);
  dialog.classList.toggle('wide', Boolean(body));
  $('msg-body').replaceChildren(...(body ? [body] : []));
  const buttons = actions.map((a) => {
    const b = el('button', { type: 'button', className: a.primary ? 'wx-btn wx-primary wx-small' : 'wx-btn wx-small', textContent: a.label });
    b.addEventListener('click', () => { dialog.close(); a.run?.(); });
    return b;
  });
  $('msg-actions').replaceChildren(...buttons);
  dialog.showModal();
  (buttons.find((b) => b.classList.contains('wx-primary')) ?? buttons[0]).focus();
}

const NOTHING_CHANGED = 'The program has not changed or created any files since it started. '
  + 'Save games usually only appear after you save in the program.';

// Changed files: first an overview, then download as ZIP or write back into the opened folder.
const fileCount = (n) => (n === 1 ? 'One file was' : `${n} files were`);
$('btn-changes').addEventListener('click', async () => {
  let files;
  try {
    files = (await emulator?.changedFiles()) ?? [];
  } catch (err) {
    showDialog('Reading the files failed', String(err.message || err), [], true);
    return;
  }
  message('');
  if (!files.length) {
    showDialog('Save – nothing changed', NOTHING_CHANGED);
    return;
  }
  const paths = files.map((f) => f.path);
  const download = async () => {
    try {
      await emulator.downloadChanges(files);
      showDialog('Downloaded', `${fileCount(files.length)} saved as a ZIP to your downloads.`);
    } catch (err) {
      showDialog('Download failed', String(err.message || err), [], true);
    }
  };
  const apply = async () => {
    try {
      await emulator.writeBack(files);
      showDialog('Changes applied', `${fileCount(files.length)} written to the opened folder "${workspace.name}".`);
    } catch (err) {
      showDialog('Applying failed', String(err.message || err), [], true);
    }
  };
  const canApply = Boolean(workspace?.dirHandle);
  const them = files.length === 1 ? 'it' : 'them';
  showDialog('Save – changed files',
    `${fileCount(files.length)} changed or created since the program started.`
      + (canApply ? ` Apply ${them} to the opened folder "${workspace.name}" or download them as a ZIP.`
        : ` Download ${them} as a ZIP to keep ${them}.`),
    paths, false, [
      { label: 'Cancel' },
      { label: 'Download as ZIP', primary: !canApply, run: download },
      ...(canApply ? [{ label: 'Apply to folder', primary: true, run: apply }] : []),
    ]);
});

// Sound on/off for every emulator (master gain in audio.js).
const SPEAKER_ON = '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>';
const SPEAKER_OFF = '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="m16 9 6 6M22 9l-6 6"/>';
function setSound(on) {
  setMuted(!on);
  const button = $('btn-sound');
  button.setAttribute('aria-pressed', String(on));
  button.classList.toggle('state-on', on);
  button.classList.toggle('state-off', !on);
  button.title = on ? 'Sound is on – click to switch it off' : 'Sound is off – click to switch it on';
  button.querySelector('svg').innerHTML = on ? SPEAKER_ON : SPEAKER_OFF;
  button.querySelector('span').textContent = on ? 'Sound on' : 'Sound off';
}
$('btn-sound').addEventListener('click', () => setSound(isMuted()));

// Pause/resume the emulation (each emulator has its own way, see the runners).
let paused = false;
function setPaused(value) {
  paused = value;
  const button = $('btn-pause');
  button.setAttribute('aria-pressed', String(paused));
  button.classList.toggle('state-on', !paused);
  button.classList.toggle('state-off', paused);
  button.title = paused ? 'Paused – click to continue' : 'Running – click to pause';
  button.querySelector('svg').innerHTML = paused ? '<path d="M9 5v14M15 5v14"/>' : '<path d="M7 5v14l12-7z"/>';
  button.querySelector('span').textContent = paused ? 'Pause' : 'Play';
}
$('btn-pause').addEventListener('click', () => {
  if (!emulator) return;
  setPaused(!paused);
  emulator.setPaused(paused);
  status(paused ? 'Paused' : 'Running');
});

// Some emulators (js-dos) pause by themselves while the tab is hidden and continue when it is
// shown again, also after the user paused. Keep the user's pause: set it again after their handlers.
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !paused || !emulator) return;
  for (const delay of [0, 200, 800]) setTimeout(() => { if (paused) emulator?.setPaused(true); }, delay);
});

// Console: messages of the emulator below the picture; orange while closed, green while open.
function setConsoleOpen(open) {
  const button = $('btn-console');
  if ($('console').hidden !== open) return;
  $('console').hidden = !open;
  button.setAttribute('aria-expanded', String(open));
  button.title = open ? 'Hide the messages of the emulator' : 'Show the messages of the emulator';
  if (open) {
    consoleOut.scrollTop = consoleOut.scrollHeight;
    requestAnimationFrame(() => $('console').scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }
}
$('btn-console').addEventListener('click', () => setConsoleOpen($('console').hidden));

// Options while running: change the settings of this emulator and restart the program with them.
/** Which emulator runs the program: windows, dos, v86 or emulatorjs. */
function runningKind(program, opts) {
  if (program.kind === 'game') return SYSTEM_BY_ID.get(opts.system)?.emulator === 'v86' ? 'v86' : 'emulatorjs';
  return program.emulator;
}

/** Restarts the running program with other options: keeps the files for one reload, then reloads. */
async function restartWith(options) {
  const { program, opts } = runInfo;
  const { biosFiles, ...rest } = { ...opts, ...options };
  try {
    if (currentDemo) {
      for (const [key, value] of Object.entries(options)) storeDemoOption(currentDemo, key, value);
      await saveRestart({ demoId: currentDemo.id, program: program.path, options: {} });
    } else {
      const files = [];
      for (const f of workspace.files) files.push({ path: f.path, blob: new Blob([await f.load()]) });
      await saveRestart({ program: program.path, system: opts.system, options: rest, name: workspace.name,
        files, dirHandle: workspace.dirHandle, bios: biosFiles ?? [] });
    }
  } catch (err) {
    showDialog('Restart failed', `The files could not be kept for the restart: ${err.message || err}`, [], true);
    return;
  }
  if (emulator) emulator.running = false; // skip the beforeunload prompt
  location.reload();
}

$('btn-options').addEventListener('click', () => {
  if (!runInfo) return;
  const { program, opts } = runInfo;
  const kind = runningKind(program, opts);
  const inputs = {};
  const rows = (DEMO_OPTION_FIELDS[kind] ?? []).map(([key, label, sourceId]) => {
    let input;
    if (sourceId) {
      input = $(sourceId).cloneNode(true);
      input.removeAttribute('id');
      input.value = String(opts[key] ?? '');
    } else {
      input = el('input', { type: 'text', value: opts[key] ?? '', placeholder: 'e.g. s for Sound Blaster', spellcheck: false });
    }
    inputs[key] = input;
    return el('label', {}, label, input);
  });
  if (kind === 'windows') {
    const keep = el('input', { type: 'checkbox', checked: opts.persistent });
    inputs.persistent = keep;
    rows.push(el('label', { className: 'check' }, keep, ' Keep the virtual environment in the browser'));
  }
  const body = rows.length
    ? el('div', { className: 'demo-options run-options' }, ...rows)
    : el('p', { className: 'hint', textContent: 'This emulator has no settings here. Restart starts the game again from the beginning.' });
  const canSave = !$('btn-changes').hidden;
  showDialog('Options',
    `Restart starts ${program.path} again with these settings, without opening it again.`
      + (canSave ? ' Changed files that are not saved are lost.' : ''),
    [], false, [
      { label: 'Cancel' },
      ...(canSave ? [{ label: 'Save first …', run: () => $('btn-changes').click() }] : []),
      { label: 'Restart', primary: true, run: () => {
        const chosen = Object.fromEntries(Object.entries(inputs).map(([key, input]) => {
          if (input.type === 'checkbox') return [key, input.checked];
          const value = input.value.trim();
          return [key, ['bpp', 'memory'].includes(key) ? Number(value) : value];
        }));
        restartWith(chosen);
      } },
    ], body);
});

// Report: a prefilled GitHub issue with what is known about the running program.
/** Option of the "Platform" dropdown of the issue form for the running program. */
function reportPlatform(program, opts) {
  if (program.kind !== 'game') {
    if (program.emulator === 'windows') return program.kind === 'win16' ? 'Windows 3.x' : 'Windows 95 – XP';
    return 'DOS';
  }
  if (opts.system === 'pc') return 'Operating system (CD, floppy or hard disk image)';
  const group = SUPPORTED_GROUPS.find((g) => g.ids?.includes(opts.system))?.title;
  return { 'Home computers': 'Home computer', Consoles: 'Console or handheld', Handhelds: 'Console or handheld', Arcade: 'Arcade' }[group] ?? 'Not sure';
}

/** Where the files came from, in one sentence. */
function reportSource() {
  if (currentDemo) return `Started the demo "${currentDemo.title}" on ${location.origin}${location.pathname}`;
  const n = workspace.files.length;
  const kind = workspace.dirHandle ? 'a folder' : /\.zip$/i.test(workspace.name) ? 'a ZIP file' : n === 1 ? 'a file' : 'files';
  return `Opened ${kind} (${n} file${n === 1 ? '' : 's'}, ${formatSize(totalSize(workspace))}) on ${location.origin}${location.pathname}`;
}

$('btn-report').addEventListener('click', async () => {
  if (!runInfo || !workspace) return;
  const { program, opts, crash } = runInfo;
  let hash;
  if (!program.remote) {
    try { hash = await sha256(await program.load()); } catch { /* e.g. image loaded in parts */ }
  }
  const { biosFiles, ...options } = opts;
  if (biosFiles?.length) options.bios = biosFiles.map((f) => f.name ?? f.path);
  const report = buildReport({
    program: program.path,
    platform: reportPlatform(program, opts),
    what: currentDemo ? `${currentDemo.title} (demo)` : `My own file ${program.path}`,
    emulator: $('run-emulator').textContent || EMULATOR_NAMES[program.emulator],
    source: reportSource(),
    hash,
    size: program.size,
    options,
    crash: crash ?? undefined,
    log: [...consoleOut.children].map((d) => d.textContent),
    browser: navigator.userAgent,
  });

  // Screenshot: the one taken at the crash, otherwise the picture right now.
  let shot = runInfo.crashShot ?? null;
  if (!shot) {
    try { shot = await emulator?.screenshot(); } catch { shot = null; }
  }

  // The fields of the issue form, editable before GitHub opens.
  const f = report.fields;
  const field = (label, input) => el('label', { className: 'report-field' }, el('span', { textContent: label }), input);
  const inputs = {
    title: el('input', { type: 'text', value: f.title }),
    what: el('input', { type: 'text', value: f.what }),
    platform: el('select', {}, ...PLATFORMS.map((p) => el('option', { value: p, textContent: p, selected: p === f.platform }))),
    problem: el('textarea', { rows: 10, value: f.problem }),
    steps: el('textarea', { rows: 5, value: f.steps }),
    browser: el('input', { type: 'text', value: f.browser }),
  };
  const checkbox = (text, checked, disabled) => {
    const box = el('input', { type: 'checkbox', checked, disabled });
    const label = el('label', { className: 'report-attach' }, box, el('span', { textContent: text }));
    label.hidden = disabled;
    return box;
  };
  const shotUrl = shot ? URL.createObjectURL(shot) : null;
  const attachShot = checkbox('Also download this screenshot to attach it to the issue.', Boolean(shot), !shot);
  const attach = checkbox(`Also download the program as a ZIP (${workspace.files.length} file${workspace.files.length === 1 ? '' : 's'}, ${formatSize(totalSize(workspace))} before packing) to attach it to the issue. Only for programs you are allowed to share.`,
    false, Boolean(currentDemo) || program.remote !== undefined); // demos are known, nothing to attach
  const body = el('div', { className: 'report-form' },
    field('Title', inputs.title),
    field('What did you try to run?', inputs.what),
    field('Platform', inputs.platform),
    field('What happened? Please add what you did and what went wrong.', inputs.problem),
    field('How can we see it ourselves?', inputs.steps),
    field('Browser and system', inputs.browser),
    ...(shotUrl ? [el('img', { className: 'report-shot', src: shotUrl, alt: 'Screenshot of the emulator' })] : []),
    attachShot.parentElement,
    attach.parentElement,
    el('p', { className: 'report-note', textContent: 'GitHub opens in a new tab with this filled in. Check it there and send it; you need a GitHub account.'
      + (shot || !attach.disabled ? ' Downloaded files are attached by dragging them into the "What happened?" field on GitHub (up to 25 MB).' : '') }));

  const download = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  };
  const baseName = (workspace.name || 'program').replace(/[^\w.-]+/g, '_');

  showDialog(crash ? 'Report the crash on GitHub' : 'Report a problem on GitHub',
    'You can change everything below before it goes to GitHub.', [], false, [
      { label: 'Cancel', run: () => shotUrl && URL.revokeObjectURL(shotUrl) },
      { label: 'Open GitHub issue', primary: true, run: async () => {
        const edited = Object.fromEntries(Object.entries(inputs).map(([k, input]) => [k, input.value]));
        window.open(fittingIssueUrl(edited), '_blank', 'noopener');
        if (shotUrl) URL.revokeObjectURL(shotUrl);
        if (attachShot.checked && shot) download(shot, `${baseName}-screenshot.png`);
        if (!attach.checked) return;
        try {
          const blob = await zipFiles(workspace.files);
          if (blob.size > MAX_ATTACHMENT) {
            showDialog('ZIP too large for GitHub', `The packed program has ${formatSize(blob.size)}; GitHub accepts up to 25 MB. Please describe where it can be downloaded instead.`, [], true);
            return;
          }
          download(blob, `${baseName}-report.zip`);
        } catch (err) {
          showDialog('Packing failed', String(err.message || err), [], true);
        }
      } },
    ], body);
});

// Fullscreen: the whole emulator area (canvas or player) covers the screen. In Chrome and Edge
// the Esc key is then given to the program (Keyboard Lock); holding Esc leaves fullscreen.
$('btn-fullscreen').addEventListener('click', async () => {
  const screen = $('screen');
  if (!screen.requestFullscreen) {
    emulator?.fullscreen();
    return;
  }
  try {
    await screen.requestFullscreen();
    await navigator.keyboard?.lock?.(['Escape']);
  } catch {
    emulator?.fullscreen();
  }
});
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) navigator.keyboard?.unlock?.();
});

// Virtual keyboard: keys the browser keeps for itself (Esc releases the mouse) or that are
// hard to type. Ctrl, Alt and Shift stay pressed for the next key.
{
  const panel = $('keys-panel');
  const held = new Set();
  const button = (label, title, onPress, extra = '') => {
    const b = el('button', { type: 'button', className: `key ${extra}`.trim(), textContent: label, title });
    b.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the focus in the emulator
    b.addEventListener('click', onPress);
    return b;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function press(keys) {
    if (!emulator) return;
    for (const key of keys) emulator.sendKey(key, true);
    await sleep(80);
    for (const key of [...keys].reverse()) emulator.sendKey(key, false);
  }
  async function pressWithHeld(key) {
    const mods = [...held].map((id) => KEY_BY_ID.get(id));
    held.clear();
    panel.querySelectorAll('[aria-pressed="true"]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    await press([...mods, key]);
  }
  const groups = [
    ['Escape', 'Tab', 'Enter', 'Backspace', 'Space'],
    VIRTUAL_KEYS.filter((key) => /^F\d+$/.test(key.id)).map((key) => key.id),
    ['Insert', 'Delete', 'Home', 'End', 'PageUp', 'PageDown'],
    ['ArrowLeft', 'ArrowUp', 'ArrowDown', 'ArrowRight'],
  ];
  const parts = [];
  for (const group of groups) {
    for (const id of group) {
      const key = KEY_BY_ID.get(id);
      parts.push(button(key.label, `Send ${key.id}`, () => pressWithHeld(key), ['Escape', 'Enter', 'Space', 'Backspace'].includes(id) ? 'wide' : ''));
    }
    parts.push(el('span', { className: 'sep' }));
  }
  for (const key of VIRTUAL_KEYS.filter((k) => k.modifier)) {
    const b = button(key.label, `Hold ${key.label} for the next key`, () => {
      const on = !held.has(key.id);
      if (on) held.add(key.id); else held.delete(key.id);
      b.setAttribute('aria-pressed', String(on));
    }, 'wide');
    b.setAttribute('aria-pressed', 'false');
    parts.push(b);
  }
  parts.push(button('Ctrl+Alt+Del', 'Send Ctrl+Alt+Del', () => press(['Control', 'Alt', 'Delete'].map((id) => KEY_BY_ID.get(id))), 'wide'));
  parts.push(el('p', { className: 'hint', textContent: 'Ctrl, Alt and Shift stay pressed for the next key. '
    + 'In fullscreen (Chrome, Edge) the real Esc key goes to the program; hold Esc to leave fullscreen.' }));
  panel.append(...parts);

  $('btn-keys').addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    $('btn-keys').setAttribute('aria-expanded', String(!panel.hidden));
  });
}

$('btn-restart').addEventListener('click', () => {
  const quit = () => {
    if (emulator) emulator.running = false; // skip the beforeunload prompt
    location.reload();
  };
  const canSave = !$('btn-changes').hidden;
  showDialog('Quit the program?',
    canSave ? 'Files the program changed are lost unless you save them first.' : 'The program is stopped and you go back to the start page.',
    [], false, [
      { label: 'Cancel' },
      ...(canSave ? [{ label: 'Save first …', run: () => $('btn-changes').click() }] : []),
      { label: 'Quit', primary: true, run: quit },
    ]);
});

// While a program runs, keys that games use must not scroll the page
// (arrow keys, space, page up/down, home/end). The emulators still get them.
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Spacebar', 'PageUp', 'PageDown', 'Home', 'End']);
window.addEventListener('keydown', (e) => {
  if (!emulator?.running || $('run').hidden || !SCROLL_KEYS.has(e.key)) return;
  const t = e.target;
  if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  e.preventDefault();
}, { capture: true });

window.addEventListener('beforeunload', (e) => {
  if (emulator?.running) e.preventDefault();
});

// ---------------------------------------------------------------------------
// Demo launcher: free programs/games fetched at build time (see demos/demos.json)

async function launchDemo(demo, button = el('button')) {
  const label = button.textContent;
  button.disabled = true;
  try {
    if (demo.image) {
      // Large disk image in parts: v86 downloads only the parts the system reads.
      const name = demo.file.split('/').pop();
      const remote = { url: new URL(`demos/${demo.file}.zst`, document.baseURI).href, ...demo.image };
      const ws = { name, files: [{ path: name, size: demo.image.size, remote,
        read: async () => new Uint8Array(0), load: async () => { throw new Error('The image is loaded in parts.'); } }] };
      await openWorkspace(async () => ws, { demo, program: demo.start, system: demo.system, options: demoOptions(demo) });
      return;
    }
    const data = await fetchWithProgress(`demos/${demo.file}`, (loaded, total) => {
      button.textContent = total ? `Loading … ${Math.round((loaded / total) * 100)} %` : 'Loading …';
    });
    const file = new File([data], demo.file.split('/').pop());
    await openWorkspace(() => fromFileList([file]), { demo, program: demo.start, system: demo.system, options: demoOptions(demo) });
  } catch (err) {
    showError(`Could not load the demo: ${err.message || err}`);
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}


let demoAnchor = null; // tree entry the detail popover belongs to

// ---------------------------------------------------------------------------
// Options per demo: shown in the info popover, remembered per demo.

const DEMO_OPTIONS_KEY = 'runthemall-demo-options';

/** Which emulator runs a demo. */
function demoEmulator(demo) {
  if (demo.system) return SYSTEM_BY_ID.get(demo.system)?.emulator === 'v86' ? 'v86' : 'emulatorjs';
  return /windows/i.test(demo.platform) ? 'windows' : 'dos';
}

/**
 * Option fields per emulator: [option key, label, id of the general setting it copies its choices from].
 * Start parameters (args) are a text field.
 */
const DEMO_OPTION_FIELDS = {
  windows: [['wine', 'Wine version', 'opt-wine'], ['threads', 'Threads', 'opt-threads'],
    ['resolution', 'Resolution', 'opt-resolution'], ['bpp', 'Colour depth', 'opt-bpp']],
  dos: [['cycles', 'CPU speed', 'opt-cycles'], ['args', 'Start parameters', null]],
  v86: [['memory', 'Memory', 'opt-memory']],
  emulatorjs: [],
};

function savedDemoOptions() {
  try { return JSON.parse(localStorage.getItem(DEMO_OPTIONS_KEY) || '{}'); } catch { return {}; }
}

/** Options for starting a demo: general settings < what the demo needs < what the user chose for it. */
function demoOptions(demo) {
  const own = savedDemoOptions()[demo.id] ?? {};
  const fromDemo = Object.fromEntries(['wine', 'args', 'cycles', 'memory'].filter((k) => demo[k]).map((k) => [k, demo[k]]));
  const merged = { ...fromDemo, ...own };
  if ('bpp' in merged) merged.bpp = Number(merged.bpp);
  if ('memory' in merged) merged.memory = Number(merged.memory);
  return merged;
}

function storeDemoOption(demo, key, value) {
  const all = savedDemoOptions();
  all[demo.id] = { ...all[demo.id], [key]: value };
  localStorage.setItem(DEMO_OPTIONS_KEY, JSON.stringify(all));
}

/** Builds the option form of a demo inside the popover. */
function demoOptionsForm(demo) {
  const current = { ...readCurrentOptions(), ...demoOptions(demo) };
  const fields = [...DEMO_OPTION_FIELDS[demoEmulator(demo)]];
  const rows = fields.map(([key, label, sourceId]) => {
    let input;
    if (sourceId) {
      input = $(sourceId).cloneNode(true);
      input.removeAttribute('id');
      input.value = String(current[key]);
      input.querySelectorAll('option').forEach((o) => { o.selected = o.value === String(current[key]); });
    } else {
      input = el('input', { type: 'text', value: current[key] ?? '', placeholder: 'e.g. s for Sound Blaster', spellcheck: false });
    }
    input.addEventListener('change', () => storeDemoOption(demo, key, input.value.trim()));
    return el('label', {}, label, input);
  });
  const sound = el('input', { type: 'checkbox', checked: current.sound });
  sound.addEventListener('change', () => storeDemoOption(demo, 'sound', sound.checked));
  rows.push(el('label', { className: 'check' }, sound, ' Sound'));
  const reset = el('button', { type: 'button', className: 'linklike', textContent: 'Reset to defaults' });
  reset.addEventListener('click', () => {
    const all = savedDemoOptions();
    delete all[demo.id];
    localStorage.setItem(DEMO_OPTIONS_KEY, JSON.stringify(all));
    showDemoDetail(demo, demoAnchor, true);
  });
  return el('div', { className: 'demo-options' }, ...rows,
    el('p', { className: 'hint' }, 'Only for this demo, remembered in your browser. ', reset));
}

/** Shows description, credits and the start button of a demo below the carousel. */
function showDemoDetail(demo, anchor, optionsOpen = false) {
  const start = el('button', { type: 'button', className: 'wx-btn wx-go wx-small', textContent: 'Start' });
  start.addEventListener('click', () => launchDemo(demo, start));
  const optionsButton = el('button', { type: 'button', className: 'wx-btn wx-small', textContent: 'Options' });
  optionsButton.setAttribute('aria-expanded', String(optionsOpen));
  const form = demoOptionsForm(demo);
  form.hidden = !optionsOpen;
  optionsButton.addEventListener('click', () => {
    form.hidden = !form.hidden;
    optionsButton.setAttribute('aria-expanded', String(!form.hidden));
    placeDemoDetail();
    revealDemoDetail();
  });
  const close = el('button', { type: 'button', className: 'demo-close', title: 'Close', textContent: '×' });
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', hideDemoDetail);
  const link = el('a', { href: demo.homepage, textContent: demo.author, rel: 'noopener' });
  $('demo-detail').replaceChildren(
    close,
    el('div', { className: 'demo-info' },
      el('h3', { textContent: demo.title }),
      el('p', { className: 'demo-meta', textContent: `${demo.platform} · ${demo.emulator} · ${demo.start}` }),
      el('p', { textContent: demo.description }),
      el('p', { className: 'demo-meta' }, 'by ', link, ` · ${demo.license}`)),
    el('div', { className: 'demo-actions' }, start, optionsButton),
    form,
  );
  $('demo-detail').style.setProperty('--tile', platformStyle(demo.platform).color);
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

/** Scrolls the carousel sideways (not the page) so that a tile is fully visible. */
function showTile(tile) {
  const c = carousel.getBoundingClientRect();
  const t = tile.getBoundingClientRect();
  if (t.left < c.left) carousel.scrollBy({ left: t.left - c.left - 4, behavior: 'smooth' });
  else if (t.right > c.right) carousel.scrollBy({ left: t.right - c.right + 4, behavior: 'smooth' });
}

/** Scrolls the page just enough to show the whole demo info with its Start button. */
function revealDemoDetail() {
  requestAnimationFrame(() => $('demo-detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
}

/** Points the arrows of the demo list at its category tile and of the info panel at the selected demo. */
function placeDemoDetail() {
  const point = (panel, target) => {
    if (panel.hidden || !target) return;
    const t = target.getBoundingClientRect();
    const p = panel.getBoundingClientRect();
    panel.style.setProperty('--arrow', `${Math.min(Math.max(t.left + t.width / 2 - p.left, 24), p.width - 24)}px`);
  };
  point($('demo-list'), carousel.querySelector('.demo-tile[aria-expanded="true"]'));
  point($('demo-detail'), demoAnchor);
}

// Carousel: arrow buttons scroll by about one view, fading edges show there is more.
const carousel = $('demo-tree');
function updateCarousel() {
  const max = carousel.scrollWidth - carousel.clientWidth;
  const atStart = carousel.scrollLeft <= 2;
  const atEnd = carousel.scrollLeft >= max - 2;
  $('demo-prev').disabled = atStart;
  $('demo-next').disabled = atEnd;
  $('demo-prev').parentElement.hidden = max <= 2;
  // Own scroll bar: thumb size = visible part, position = scroll position.
  const bar = $('demo-bar');
  bar.hidden = max <= 2;
  if (!bar.hidden) {
    const thumb = bar.firstElementChild;
    const width = Math.max(40, bar.clientWidth * (carousel.clientWidth / carousel.scrollWidth));
    thumb.style.width = `${width}px`;
    thumb.style.left = `${(bar.clientWidth - width) * (carousel.scrollLeft / max)}px`;
  }
  carousel.parentElement.classList.toggle('more-left', !atStart);
  carousel.parentElement.classList.toggle('more-right', !atEnd);
  placeDemoDetail();
}
const scrollCarousel = (dir) => {
  const tile = carousel.querySelector('.demo-tile');
  const step = tile ? tile.offsetWidth + parseFloat(getComputedStyle(carousel).columnGap || '0') : 260;
  const tiles = Math.max(1, Math.floor(carousel.clientWidth / step));
  carousel.scrollBy({ left: dir * tiles * step, behavior: 'smooth' });
};
$('demo-prev').addEventListener('click', () => scrollCarousel(-1));

/** Ends a drag: snapping is switched on again and the carousel glides to the nearest tile. */
function snapCarousel() {
  const left = carousel.scrollLeft;
  carousel.classList.remove('dragging');
  carousel.scrollLeft = left;
  const gap = parseFloat(getComputedStyle(carousel).columnGap) || 0;
  const step = (carousel.querySelector('.demo-tile')?.offsetWidth ?? 250) + gap;
  carousel.scrollTo({ left: Math.round(left / step) * step, behavior: 'smooth' });
}

// Own scroll bar: drag the thumb, or click the track to jump there.
{
  const bar = $('demo-bar');
  const thumb = bar.firstElementChild;
  let drag = null; // { x, left }
  const ratio = () => (carousel.scrollWidth - carousel.clientWidth) / Math.max(1, bar.clientWidth - thumb.offsetWidth);
  bar.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    if (e.target !== thumb) {
      // Jump so that the thumb is centred under the pointer.
      const x = e.clientX - bar.getBoundingClientRect().left - thumb.offsetWidth / 2;
      carousel.scrollLeft = x * ratio();
    }
    drag = { x: e.clientX, left: carousel.scrollLeft };
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('dragging');
    carousel.classList.add('dragging');
  });
  bar.addEventListener('pointermove', (e) => {
    if (drag) carousel.scrollLeft = drag.left + (e.clientX - drag.x) * ratio();
  });
  const end = () => {
    if (!drag) return;
    drag = null;
    bar.classList.remove('dragging');
    snapCarousel();
  };
  bar.addEventListener('pointerup', end);
  bar.addEventListener('pointercancel', end);
}

// Drag the carousel sideways with the mouse (touch and trackpads scroll natively).
{
  let drag = null; // { x, left, moved }
  carousel.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, left: carousel.scrollLeft, moved: false };
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 5) return; // a small wobble is still a click
    if (!drag.moved) {
      drag.moved = true;
      carousel.classList.add('dragging');
    }
    carousel.scrollLeft = drag.left - dx;
  });
  window.addEventListener('pointerup', () => {
    if (!drag) return;
    if (drag.moved) {
      snapCarousel();
      // The click right after releasing belongs to the drag, not to a demo.
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', swallow, { capture: true });
      setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    }
    drag = null;
  });
  carousel.addEventListener('dragstart', (e) => e.preventDefault()); // no ghost images of the logos
}
$('demo-next').addEventListener('click', () => scrollCarousel(1));
carousel.addEventListener('scroll', updateCarousel, { passive: true });
new ResizeObserver(updateCarousel).observe(carousel);
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('demo-detail').hidden) {
    demoAnchor?.focus();
    hideDemoDetail();
  } else if (!$('demo-list').hidden) {
    const tile = carousel.querySelector('.demo-tile[aria-expanded="true"]');
    tile?.focus();
    tile?.click();
  }
});

/** Opens the list of demos of one category below the carousel (or closes it when it is already open). */
function openCategory(tile, platform, demos) {
  const list = $('demo-list');
  const wasOpen = tile.getAttribute('aria-expanded') === 'true';
  carousel.querySelectorAll('.demo-tile[aria-expanded="true"]').forEach((t) => t.setAttribute('aria-expanded', 'false'));
  hideDemoDetail();
  if (wasOpen) {
    list.hidden = true;
    return;
  }
  tile.setAttribute('aria-expanded', 'true');
  const items = demos.map((demo) => {
    const button = el('button', { type: 'button', className: 'demo-item', title: demo.description },
      el('span', { className: 'demo-name', textContent: demo.title }),
      el('span', { className: 'demo-file', textContent: demo.start }));
    button.addEventListener('click', () => {
      if (demoAnchor === button) hideDemoDetail();
      else {
        showDemoDetail(demo, button);
        revealDemoDetail();
      }
    });
    button.addEventListener('dblclick', () => showDemoDetail(demo, button).click());
    return el('li', {}, button);
  });
  list.replaceChildren(
    el('h3', { textContent: `${platform} – ${demos.length === 1 ? '1 demo' : `${demos.length} demos`}` }),
    el('ul', {}, ...items));
  list.style.setProperty('--tile', platformStyle(platform).color);
  list.hidden = false;
  showTile(tile);
  placeDemoDetail();
  requestAnimationFrame(() => list.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
}

/** Builds the carousel: one tile per platform (in order of first appearance); a click opens its demos. */
function renderDemoTree(list) {
  const groups = new Map();
  for (const demo of list) {
    if (!groups.has(demo.platform)) groups.set(demo.platform, []);
    groups.get(demo.platform).push(demo);
  }
  $('demo-list').hidden = true;
  hideDemoDetail();
  carousel.replaceChildren(...[...groups].map(([platform, demos]) => {
    const { logo, icon, color } = platformStyle(platform);
    const iconBox = el('span', { className: logo ? 'tile-icon logo' : 'tile-icon' });
    if (logo) iconBox.append(el('img', { src: logo, alt: '', width: 56, height: 56, decoding: 'async' }));
    else iconBox.innerHTML = icon; // own static SVG markup from platforms.js
    const tile = el('button', { type: 'button', className: 'demo-tile', title: `Show the ${platform} demos` },
      iconBox,
      el('span', { className: 'tile-name', textContent: platform }),
      el('span', { className: 'tile-count', textContent: demos.length === 1 ? '1 demo' : `${demos.length} demos` }));
    tile.setAttribute('role', 'listitem');
    tile.setAttribute('aria-expanded', 'false');
    tile.setAttribute('aria-controls', 'demo-list');
    tile.style.setProperty('--tile', color);
    tile.addEventListener('click', () => openCategory(tile, platform, demos));
    return tile;
  }));
  updateCarousel();
}

/** Sidebar: all supported platforms, grouped, with logo or icon. */
function renderPlatforms() {
  $('platform-list').replaceChildren(...SUPPORTED_GROUPS.map((group) => el('section', { className: 'platform-group' },
    el('h3', { textContent: group.title }),
    el('ul', {}, ...supportedItems(group, SYSTEM_BY_ID).map((item) => {
      const icon = el('span', { className: item.logo ? 'platform-icon logo' : 'platform-icon' });
      if (item.logo) icon.append(el('img', { src: item.logo, alt: '', width: 22, height: 22, decoding: 'async' }));
      else icon.innerHTML = item.icon; // own static SVG markup from platforms.js
      const li = el('li', { title: item.tooltip }, icon, el('span', { className: 'platform-name', textContent: item.label }));
      // Hovering a platform highlights its emulator in the right sidebar.
      const card = () => document.querySelector(`.emu-card[data-emulator="${item.emulator}"]`);
      li.addEventListener('mouseenter', () => card()?.classList.add('highlight'));
      li.addEventListener('mouseleave', () => card()?.classList.remove('highlight'));
      if (item.bios) li.append(el('span', { className: 'bios-tag', textContent: 'BIOS', title: 'Needs an original BIOS file' }));
      return li;
    })))));
}
renderPlatforms();

// Own operating system: any disk image boots as a complete PC (v86).
$('btn-own-os').addEventListener('click', () => $('input-own-os').click());
$('input-own-os').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) openWorkspace(() => fromFileList([file]), { program: file.name, system: 'pc' });
});

const demoList = fetch('demos/demos.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((list) => {
    if (!list?.length) return [];
    renderDemoTree(list);
    $('demos').hidden = !$('run').hidden || !$('choose').hidden;
    return list;
  })
  .catch(() => []);

// After "Options → Restart": start the same program again with the new settings.
takeRestart().then(async (plan) => {
  if (!plan) return;
  if (plan.demoId) {
    const demo = (await demoList).find((d) => d.id === plan.demoId);
    if (demo) launchDemo(demo);
    return;
  }
  const autostart = { program: plan.program, system: plan.system, options: plan.options, bios: plan.bios };
  let handle = plan.dirHandle;
  if (handle && (await handle.queryPermission?.({ mode: 'readwrite' })) !== 'granted') handle = null;
  openWorkspace(async () => (handle ? fromDirectoryHandle(handle) : fromStoredFiles(plan.name, plan.files)), autostart);
});

// ---------------------------------------------------------------------------
// Footer

$('btn-clear').addEventListener('click', async () => {
  if (emulator?.running) {
    showDialog('Program still running', 'Please quit the running program first.');
    return;
  }
  showDialog('Reset the virtual environment?',
    'This only affects data that Windows programs stored here in the browser: settings, programs installed '
      + 'there and save games. Files on your computer are not touched. The environment is set up again on the next start.',
    [], false, [
      { label: 'Cancel' },
      { label: 'Reset', primary: true, run: async () => {
        await clearPersistentStorage();
        showDialog('Reset done', 'The virtual environment was reset. It is set up again when you next start a Windows program.');
      } },
    ]);
});

/** Writes an emulator version into the right sidebar. */
function showVersion(id, version) {
  for (const node of document.querySelectorAll(`[data-version="${id}"]`)) node.textContent = version;
}

fetch('jsdos/version.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((v) => {
    if (!v) return;
    $('jsdos-version').textContent = v.jsdos;
    showVersion('jsdos', v.jsdos);
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
    showVersion('emulatorjs', v.version);
    $('ejs-source').href = `emulatorjs/source/EmulatorJS-${v.version}-source.tar.gz`;
  })
  .catch(() => {});

fetch('boxedwine/version.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((v) => {
    if (!v) return;
    $('bw-version').textContent = v.tag;
    showVersion('boxedwine', v.tag);
    $('bw-source').href = `boxedwine/source/Boxedwine-${v.tag}-source.tar.gz`;
  })
  .catch(() => {});

fetch('v86/version.json')
  .then((r) => (r.ok ? r.json() : null))
  .then((v) => {
    if (!v) return;
    $('v86-version').textContent = v.v86;
    showVersion('v86', v.v86);
    $('v86-sources').replaceChildren(...v.sources.flatMap((src, i) => {
      const a = document.createElement('a');
      a.href = `v86/${src}`;
      a.textContent = src.replace(/^source\//, '').replace(/-source\.tar\.gz$/, '');
      return i ? [', ', a] : [a];
    }));
  })
  .catch(() => {});
