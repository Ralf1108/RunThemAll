import { audioSuspended } from './audio.js';
import { fromDataTransfer, fromDirectoryHandle, fromFileList, findPrograms, totalSize } from './workspace.js';
import { fetchWithProgress } from './runner.js';
import { WindowsRunner, canUseThreads, clearPersistentStorage } from './emulator.js';
import { DosRunner } from './dos.js';
import { EmulatorJsRunner, findBiosInWorkspace } from './ejs.js';
import { V86Runner } from './v86.js';
import { KIND_LABELS } from './exe.js';
import { SYSTEMS, SYSTEM_BY_ID } from './systems.js';
import { platformStyle } from './platforms.js';

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
    if (!ws || ws.files.length === 0) throw new Error('No files found.');
    const found = await findPrograms(ws);
    if (found.length === 0) throw new Error('No program or game found that can be started.');
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
  // The browser may hold back the sound until the next click or key press (see audio.js).
  setTimeout(() => {
    if (!$('opt-sound').checked || !audioSuspended()) return;
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
  $('run').hidden = false;
  window.scrollTo({ top: 0 }); // the demos may have been scrolled into view
  const what = program.kind === 'game' ? SYSTEM_BY_ID.get(opts.system).label : EMULATOR_NAMES[program.emulator];
  $('run-title').textContent = `${program.path} (${what})`;

  const ui = {
    screen: $('screen'), canvas: $('canvas'), dosContainer: $('dos-container'), ejsContainer: $('ejs-container'), v86Container: $('v86-container'), status, log,
    steps: setSteps, step: setStep, progress: setProgress, ready: hideLoader,
    emulatorInfo: (text) => { $('run-emulator').textContent = text; },
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
  $('btn-download').hidden = !emulator.supportsFileSync;
  $('btn-writeback').hidden = !emulator.supportsFileSync || !workspace.dirHandle;
  try {
    await emulator.start(workspace, program.path, opts);
  } catch (err) {
    console.error(err);
    status(`Error: ${err.message || err}`);
    $('loader-detail').textContent = `Error: ${err.message || err}`;
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
    ...(files.length > max ? [Object.assign(document.createElement('li'), { className: 'more', textContent: `… and ${files.length - max} more` })] : []));
  $('msg-files').hidden = files.length === 0;
  dialog.classList.toggle('error', error);
  dialog.showModal();
  $('msg-ok').focus();
}
$('msg-ok').addEventListener('click', () => $('msg-dialog').close());

const NOTHING_CHANGED = 'The program has not changed or created any files since it started. '
  + 'Save games usually only appear after you save in the program.';

$('btn-download').addEventListener('click', async () => {
  try {
    const files = (await emulator?.downloadChanges()) ?? [];
    message('');
    if (files.length) {
      showDialog('Changed files saved',
        `${files.length === 1 ? 'One file was' : `${files.length} files were`} saved as a ZIP to your downloads:`, files);
    } else {
      showDialog('Nothing to save', NOTHING_CHANGED);
    }
  } catch (err) {
    showDialog('Saving failed', String(err.message || err), [], true);
  }
});

$('btn-writeback').addEventListener('click', async () => {
  try {
    const files = await emulator.writeBack();
    message('');
    if (files.length) {
      showDialog('Written back to folder',
        `${files.length === 1 ? 'One file was' : `${files.length} files were`} written to the opened folder "${workspace.name}":`, files);
    } else {
      showDialog('Nothing to write back', NOTHING_CHANGED);
    }
  } catch (err) {
    showDialog('Writing back failed', String(err.message || err), [], true);
  }
});

// Fullscreen: the whole emulator area (canvas or player) covers the screen.
$('btn-fullscreen').addEventListener('click', () => {
  const screen = $('screen');
  if (screen.requestFullscreen) screen.requestFullscreen().catch(() => emulator?.fullscreen());
  else emulator?.fullscreen();
});

$('btn-restart').addEventListener('click', () => {
  if (!confirm('Quit the program? Unsaved changes will be lost.')) return;
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
    if (demo.image) {
      // Large disk image in parts: v86 downloads only the parts the system reads.
      const name = demo.file.split('/').pop();
      const remote = { url: new URL(`demos/${demo.file}.zst`, document.baseURI).href, ...demo.image };
      const ws = { name, files: [{ path: name, size: demo.image.size, remote,
        read: async () => new Uint8Array(0), load: async () => { throw new Error('The image is loaded in parts.'); } }] };
      await openWorkspace(async () => ws, { program: demo.start, system: demo.system, options: demoOptions(demo) });
      return;
    }
    const data = await fetchWithProgress(`demos/${demo.file}`, (loaded, total) => {
      button.textContent = total ? `Loading … ${Math.round((loaded / total) * 100)} %` : 'Loading …';
    });
    const file = new File([data], demo.file.split('/').pop());
    await openWorkspace(() => fromFileList([file]), { program: demo.start, system: demo.system, options: demoOptions(demo) });
  } catch (err) {
    showError(`Could not load the demo: ${err.message || err}`);
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

/** Points the arrow of the info panel at the tile of the selected demo. */
function placeDemoDetail() {
  const pop = $('demo-detail');
  if (pop.hidden || !demoAnchor) return;
  const tile = demoAnchor.closest('.demo-tile').getBoundingClientRect();
  const panel = pop.getBoundingClientRect();
  const x = Math.min(Math.max(tile.left + tile.width / 2 - panel.left, 24), panel.width - 24);
  pop.style.setProperty('--arrow', `${x}px`);
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
$('demo-next').addEventListener('click', () => scrollCarousel(1));
carousel.addEventListener('scroll', updateCarousel, { passive: true });
new ResizeObserver(updateCarousel).observe(carousel);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('demo-detail').hidden) {
    demoAnchor?.focus();
    hideDemoDetail();
  }
});

/** Builds the carousel: one tile per platform (in order of first appearance), its demos inside. */
function renderDemoTree(list) {
  const groups = new Map();
  for (const demo of list) {
    if (!groups.has(demo.platform)) groups.set(demo.platform, []);
    groups.get(demo.platform).push(demo);
  }
  carousel.replaceChildren(...[...groups].map(([platform, demos]) => {
    const { logo, icon, color } = platformStyle(platform);
    const items = demos.map((demo) => {
      const button = el('button', { type: 'button', className: 'demo-item', title: demo.description },
        el('span', { className: 'demo-name', textContent: demo.title }),
        el('span', { className: 'demo-file', textContent: demo.start }));
      button.addEventListener('click', () => {
        if (demoAnchor === button) hideDemoDetail();
        else {
          showDemoDetail(demo, button);
          button.closest('.demo-tile').scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
        }
      });
      button.addEventListener('dblclick', () => showDemoDetail(demo, button).click());
      return el('li', {}, button);
    });
    const iconBox = el('span', { className: logo ? 'tile-icon logo' : 'tile-icon' });
    if (logo) iconBox.append(el('img', { src: logo, alt: '', width: 38, height: 38, decoding: 'async' }));
    else iconBox.innerHTML = icon; // own static SVG markup from platforms.js
    const tile = el('article', { className: 'demo-tile' },
      el('header', { className: 'tile-head' }, iconBox,
        el('div', {},
          el('h3', { textContent: platform }),
          el('span', { className: 'tile-count', textContent: demos.length === 1 ? '1 Demo' : `${demos.length} Demos` }))),
      el('ul', {}, ...items));
    tile.setAttribute('role', 'listitem');
    tile.style.setProperty('--tile', color);
    return tile;
  }));
  updateCarousel();
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
    alert('Please quit the running program first.');
    return;
  }
  if (!confirm('Reset the virtual environment?\n\n'
    + 'This only affects data that Windows programs stored here in the browser: '
    + 'settings, programs installed there and save games.\n\n'
    + 'Files on your computer are not touched. The environment is set up again on the next start.')) return;
  await clearPersistentStorage();
  alert('The virtual environment was reset. It is set up again when you next start a Windows program.');
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
