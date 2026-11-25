// Problem reports: recognises crashes in the emulator output and builds a prefilled
// GitHub issue (issue form .github/ISSUE_TEMPLATE/bug_report.yml) from what is known
// about the running program. Nothing is sent by this page: it only opens GitHub with
// the text in the address, and the user checks and sends it there.

import { crc32, createZip } from './zip.js';

const NEW_ISSUE = 'https://github.com/Ralf1108/RunThemAll/issues/new';

/** GitHub accepts long addresses, but very long ones fail; the log is shortened to stay below this. */
const MAX_URL = 7500;

/** GitHub refuses attachments above this size. */
export const MAX_ATTACHMENT = 25 * 1048576;

/**
 * Output lines that mean the program or the emulator crashed (not just a warning).
 * Wine prints many harmless "err:"/"fixme:" lines, so only clear signs count.
 */
const CRASH_LINE = new RegExp([
  String.raw`Unhandled (page fault|exception|illegal instruction|privileged instruction|stack overflow)`,
  String.raw`wine: (could not load|cannot find|failed to)`,
  String.raw`Aborted\(`,
  String.raw`RuntimeError`,
  String.raw`memory access out of bounds`,
  String.raw`unreachable executed`,
  String.raw`Assertion failed`,
  String.raw`E_Exit`,
  String.raw`Exit to error`,
  String.raw`Kernel panic`,
].join('|'), 'i');

/** @param {string} line */
export function isCrashLine(line) {
  return CRASH_LINE.test(line);
}

/**
 * Whether an uncaught error of the page is a crash of the emulator. Browser
 * refusals (e.g. pointer lock outside a click) are DOMExceptions and do not count.
 * @param {unknown} error
 */
export function isCrashError(error) {
  if (!error || error instanceof DOMException) return false;
  if (typeof WebAssembly !== 'undefined' && error instanceof WebAssembly.RuntimeError) return true;
  return isCrashLine(String(/** @type {any} */ (error).message ?? error));
}

/** SHA-256 of some bytes as hex. */
export async function sha256(data) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @typedef {object} ReportInfo
 * @property {string} program        path of the started file
 * @property {string} platform       option of the "Platform" dropdown of the issue form
 * @property {string} what           e.g. "Keen Dreams (demo)" or "my own file GAME.EXE"
 * @property {string} emulator       running emulator and version
 * @property {string} source         where the files came from (demo, file, ZIP, folder) and how many
 * @property {string} [hash]         SHA-256 of the started file
 * @property {number} [size]         size of the started file
 * @property {object} options        start options
 * @property {string} [crash]        the line or error that was recognised as crash
 * @property {string[]} log          console lines, oldest first
 * @property {string} browser
 */

/**
 * The fields of the issue form, in the order of the form.
 * @param {ReportInfo} info
 * @param {number} logLines how many of the last console lines to include
 */
function fields(info, logLines) {
  const lines = info.log.slice(-logLines);
  const skipped = info.log.length - lines.length;
  const problem = [
    info.crash ? `RunThemAll recognised a crash:\n\n\`\`\`\n${info.crash}\n\`\`\`` : '<!-- What did you expect, and what happened instead? -->',
    '',
    `Last console lines${skipped ? ` (${skipped} earlier lines left out)` : ''}:`,
    '',
    '```',
    ...lines,
    '```',
  ].join('\n');
  const steps = [
    `1. ${info.source}`,
    `2. Started \`${info.program}\`${info.size !== undefined ? ` (${info.size} bytes)` : ''}`,
    info.hash ? `   SHA-256: \`${info.hash}\`` : null,
    `3. Emulator: ${info.emulator}`,
    `   Options: \`${JSON.stringify(info.options)}\``,
  ].filter((l) => l !== null).join('\n');
  return {
    title: `${info.crash ? 'Crash' : 'Problem'}: ${info.program}`,
    what: info.what,
    platform: info.platform,
    problem,
    steps,
    browser: info.browser,
  };
}

/** Address of the issue form with all fields filled in. */
function issueUrl(f) {
  const params = new URLSearchParams({ template: 'bug_report.yml', ...f });
  return `${NEW_ISSUE}?${params}`;
}

/**
 * Builds the report: the fields for the preview and the address that opens them on GitHub.
 * Uses as many log lines as fit into the address.
 * @param {ReportInfo} info
 */
export function buildReport(info) {
  let n = Math.min(info.log.length, 80);
  for (;;) {
    const f = fields(info, n);
    const url = issueUrl(f);
    if (url.length <= MAX_URL || n === 0) return { fields: f, url };
    n = Math.max(0, n - Math.max(1, Math.ceil(n / 5)));
  }
}

/** Plain text of the report fields, as the user sees it before sending. */
export function reportText(f) {
  return [
    `Title: ${f.title}`,
    '',
    `What did you try to run?\n${f.what}`,
    '',
    `Platform\n${f.platform}`,
    '',
    `What happened?\n${f.problem}`,
    '',
    `How can we see it ourselves?\n${f.steps}`,
    '',
    `Browser and system\n${f.browser}`,
  ].join('\n');
}

/** Compresses bytes with deflate (as in ZIP files). */
async function deflate(data) {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Packs files into a compressed ZIP (to attach it to the issue).
 * @param {{path:string, load:()=>Promise<Uint8Array>}[]} files
 * @returns {Promise<Blob>}
 */
export async function zipFiles(files) {
  const entries = [];
  for (const f of files) {
    const data = await f.load();
    if (typeof CompressionStream === 'function') {
      const compressed = await deflate(data);
      if (compressed.length < data.length) {
        entries.push({ name: f.path, raw: { method: 8, crc: crc32(data), size: data.length, compressed } });
        continue;
      }
    }
    entries.push({ name: f.path, data });
  }
  return createZip(entries);
}
