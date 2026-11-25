// Runs DOS programs with js-dos (DOSBox compiled to WebAssembly).
// js-dos is loaded unmodified from ./jsdos/. The user's files become drive C:.

import { Runner, loadScript, loadStylesheet, prefetch, splitPath } from './runner.js';

/**
 * @typedef {object} DosOptions
 * @property {string} cycles "auto", "max" or a fixed number of cycles
 * @property {boolean} sound
 * @property {string} [args] command line arguments for the program (e.g. sound card choice of a demo)
 */

// Characters allowed in DOS 8.3 file names (besides letters and digits).
const DOS_CHARS = "_$~!#%&'(){}@^`-";
const DOS_NAME = new RegExp(`^[A-Z0-9${DOS_CHARS.replace(/[-\]\\^]/g, '\\$&')}]+$`, 'i');
const DOS_CLEAN = new RegExp(`[^A-Z0-9${DOS_CHARS.replace(/[-\]\\^]/g, '\\$&')}]`, 'g');

export function isShortName(name) {
  const parts = name.split('.');
  if (parts.length > 2) return false;
  const [base, ext = ''] = parts;
  return base.length >= 1 && base.length <= 8 && ext.length <= 3
    && DOS_NAME.test(base) && (ext === '' || DOS_NAME.test(ext));
}

/** Returns an 8.3 name for `name` that is not yet in `taken` (upper-case set). */
export function shortName(name, taken) {
  if (isShortName(name) && !taken.has(name.toUpperCase())) return name;
  const dot = name.lastIndexOf('.');
  const clean = (s) => s.toUpperCase().replace(DOS_CLEAN, '');
  const base = clean(dot > 0 ? name.slice(0, dot) : name) || 'DATEI';
  const ext = clean(dot > 0 ? name.slice(dot + 1) : '').slice(0, 3);
  for (let n = 1; ; n++) {
    const suffix = `~${n}`;
    const candidate = base.slice(0, 8 - suffix.length) + suffix + (ext ? `.${ext}` : '');
    if (!taken.has(candidate.toUpperCase())) return candidate;
  }
}

/**
 * Maps workspace paths to DOS-compatible 8.3 paths (only where needed).
 * @param {string[]} paths
 * @returns {{ toDos: Map<string,string>, fromDos: Map<string,string> }}
 */
export function mapToDosPaths(paths) {
  const dirMap = new Map([['', '']]); // original dir -> dos dir
  const taken = new Map(); // dos dir -> Set of upper-case names in it
  const toDos = new Map();
  const fromDos = new Map();

  const takenIn = (dosDir) => {
    if (!taken.has(dosDir)) taken.set(dosDir, new Set());
    return taken.get(dosDir);
  };
  const mapDir = (dir) => {
    if (dirMap.has(dir)) return dirMap.get(dir);
    const [parent, name] = splitPath(dir);
    const dosParent = mapDir(parent);
    const used = takenIn(dosParent);
    const dosName = shortName(name, used);
    used.add(dosName.toUpperCase());
    const dosDir = dosParent ? `${dosParent}/${dosName}` : dosName;
    dirMap.set(dir, dosDir);
    fromDos.set(dosDir.toUpperCase(), dir);
    return dosDir;
  };

  // Short names first, so they keep their name and long names get the ~N variants.
  const sorted = [...paths].sort((a, b) =>
    Number(!isShortName(splitPath(a)[1])) - Number(!isShortName(splitPath(b)[1])) || a.localeCompare(b));
  for (const path of sorted) {
    const [dir, name] = splitPath(path);
    const dosDir = mapDir(dir);
    const used = takenIn(dosDir);
    const dosName = shortName(name, used);
    used.add(dosName.toUpperCase());
    const dosPath = dosDir ? `${dosDir}/${dosName}` : dosName;
    toDos.set(path, dosPath);
    fromDos.set(dosPath.toUpperCase(), path);
  }
  return { toDos, fromDos };
}

function buildDosboxConf(dosProgram, opts) {
  const [dir, name] = splitPath(dosProgram);
  const lines = [
    '[sdl]',
    'autolock=true',
    '',
    '[cpu]',
    'core=auto',
    'cputype=auto',
    `cycles=${opts.cycles || 'auto'}`,
    '',
    '[mixer]',
    `nosound=${opts.sound ? 'false' : 'true'}`,
    '',
    '[autoexec]',
    '@echo off',
    'mount c .',
    'c:',
  ];
  if (dir) lines.push(`cd \\${dir.replace(/\//g, '\\')}`);
  lines.push(opts.args ? `${name} ${opts.args}` : name);
  return lines.join('\n') + '\n';
}

export class DosRunner extends Runner {
  constructor(ui) {
    super(ui);
    this.props = null;
    this.ci = null;
    this.fromDos = new Map();
  }

  /**
   * @param {import('./workspace.js').Workspace} workspace
   * @param {string} program relative path of the program inside the workspace
   * @param {DosOptions} opts
   */
  async start(workspace, program, opts) {
    if (this.running) throw new Error('Der Emulator läuft bereits. Bitte Seite neu laden.');
    this.running = true;
    this.workspace = workspace;
    const { status, log, dosContainer } = this.ui;
    dosContainer.hidden = false;

    const version = await fetch('jsdos/version.json').then((r) => r.json()).then((v) => v.jsdos).catch(() => '');
    this.ui.emulatorInfo(`js-dos ${version} · DOSBox`.replace('  ', ' '));
    this.ui.steps(['Emulator herunterladen (js-dos, DOSBox)', 'Programmdateien einlesen', 'DOSBox starten']);
    this.ui.step(0);
    const base = new URL('jsdos/', document.baseURI).href;
    await prefetch(['js-dos.js', 'js-dos.css', 'emulators/emulators.js', 'emulators/wdosbox.js',
      'emulators/wdosbox.wasm', 'emulators/wlibzip.js', 'emulators/wlibzip.wasm'].map((f) => base + f), this.ui);
    await Promise.all([loadStylesheet('jsdos/js-dos.css'), loadScript('jsdos/js-dos.js')]);

    this.ui.step(1);
    const files = await Promise.all(
      workspace.files.map(async (f) => ({ path: f.path, data: await f.load() })),
    );
    const { toDos, fromDos } = mapToDosPaths(files.map((f) => f.path));
    this.fromDos = fromDos;
    for (const [orig, dos] of toDos) if (orig !== dos) log(`Kurzname: ${orig} → ${dos}`, false);

    const initFs = files.map((f) => {
      this.remember(f.path, f.data);
      return { path: toDos.get(f.path), contents: f.data };
    });
    const dosboxConf = buildDosboxConf(toDos.get(program), opts);
    log(`js-dos: DOSBox, Zyklen ${opts.cycles}\n${dosboxConf}`, false);

    this.ui.step(2);
    status('Starte DOSBox …');
    this.props = window.Dos(dosContainer, {
      dosboxConf,
      initFs,
      pathPrefix: new URL('jsdos/emulators/', document.baseURI).href,
      backend: 'dosbox',
      backendLocked: true,
      autoStart: true,
      kiosk: true,
      lang: 'en',
      theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      volume: opts.sound ? 1 : 0,
      fsChanges: { local: false }, // do not store anything in the browser
      onEvent: (event, arg) => {
        log(`js-dos: ${event}`, false);
        if (event === 'ci-ready') {
          this.ci = arg;
          status('Läuft');
          this.ui.ready();
        }
      },
    });
  }

  async readAllFiles() {
    const ci = this.ci;
    if (!ci) return [];
    const tree = await ci.fsTree();
    const files = [];
    const walk = async (node, prefix) => {
      for (const child of node.nodes || []) {
        const path = prefix + child.name;
        if (child.nodes) {
          if (prefix === '' && child.name === '.jsdos') continue; // js-dos configuration
          await walk(child, `${path}/`);
        } else {
          files.push({ path, data: await ci.fsReadFile(path) });
        }
      }
    };
    await walk(tree, '');
    return files.map((f) => ({ path: this.toWorkspacePath(f.path), data: f.data }));
  }

  /** Translates a DOS path back to the original (long) workspace path. */
  toWorkspacePath(dosPath) {
    const known = this.fromDos.get(dosPath.toUpperCase());
    if (known) return known;
    const [dir, name] = splitPath(dosPath);
    const origDir = dir ? this.fromDos.get(dir.toUpperCase()) ?? this.toWorkspacePath(dir) : '';
    return origDir ? `${origDir}/${name}` : name;
  }

  fullscreen() {
    this.props?.setFullScreen(true);
  }
}
