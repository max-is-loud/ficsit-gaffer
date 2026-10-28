// Checks that every Satisfactory save in a directory parses completely, using the same
// parser library as packages/sf-save-data. A save cut off by a writer that has not finished
// fails here, even when no process holds it open and its modification time is old.
// backup-saves.sh runs this on the staged copy and makes no archive when it exits non-zero.
//
// Every .sav under the directory is checked, except the one server-settings file in the top
// folder (see SETTINGS_FILE). The same name in a subfolder is a save and is checked.
//
// Usage:  node validate-saves.mjs <directory>
// Exit:   0 every save parsed; 1 a save is incomplete or does not parse; 2 usage or setup error.

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const EXIT_OK = 0;
const EXIT_INVALID = 1;
const EXIT_SETUP = 2;

// Parser notices that mean "this save is damaged". Other notices (for example a property
// type that a newer game added) are reported but do not fail the check.
const FATAL_NOTICE = /corrupt|checksum|could not be read|trailing data/i;

// The server settings file (SaveGames/ServerSettings.7777.sav) holds server options, not a
// world, so the parser cannot read it. Match the path relative to the SaveGames root, so only
// the file in the top folder is skipped. "server/ServerSettings.partial.sav" is validated.
const SETTINGS_FILE = /^ServerSettings\.[0-9]+\.sav$/;

function usageError(message) {
  process.stderr.write(`validate-saves: ${message}\n`);
  process.exit(EXIT_SETUP);
}

function parseArguments(argv) {
  if (argv.length !== 1) {
    usageError('usage: validate-saves.mjs <directory>');
  }
  return { directory: argv[0] };
}

async function findSaveFiles(directory) {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sav'))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort();
}

// The library prints progress and warnings to the console. Capture them for the verdict,
// and keep them off stdout.
function withCapturedConsole(action) {
  const notices = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const capture = (...parts) => notices.push(parts.map(String).join(' '));
  Object.assign(console, { log: capture, warn: capture, error: capture });
  try {
    return { result: action(), notices };
  } finally {
    Object.assign(console, original);
  }
}

/** Returns { ok, reason, notes } for one save. Never throws for a damaged save. */
async function checkSave(Parser, filePath) {
  const bytes = await readFile(filePath);
  if (bytes.byteLength === 0) {
    return { ok: false, reason: 'file is empty', notes: [] };
  }
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let captured;
  try {
    // throwErrors makes the library throw on an object it cannot read in full, where its
    // default would fill the rest with raw bytes and carry on.
    captured = withCapturedConsole(() =>
      Parser.ParseSave(path.basename(filePath), arrayBuffer, { throwErrors: true }),
    );
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error), notes: [] };
  }
  const fatal = captured.notices.find((notice) => FATAL_NOTICE.test(notice));
  if (fatal !== undefined) {
    return { ok: false, reason: `parser notice: ${fatal}`, notes: [] };
  }
  const save = captured.result;
  if (!save?.header || !save?.levels) {
    return { ok: false, reason: 'parser returned no header or levels', notes: [] };
  }
  return { ok: true, reason: '', notes: captured.notices };
}

async function loadParser() {
  try {
    return (await import('@etothepii/satisfactory-file-parser')).Parser;
  } catch (error) {
    return usageError(
      `cannot load @etothepii/satisfactory-file-parser (${error.message}). Run npm ci in the install directory.`,
    );
  }
}

async function main() {
  const { directory } = parseArguments(process.argv.slice(2));
  const Parser = await loadParser();
  const files = (await findSaveFiles(directory)).filter(
    (file) => !SETTINGS_FILE.test(path.relative(directory, file)),
  );
  if (files.length === 0) {
    process.stderr.write(`validate-saves: no save to check in ${directory}\n`);
    process.exit(EXIT_INVALID);
  }
  let invalidCount = 0;
  for (const file of files) {
    const verdict = await checkSave(Parser, file);
    const label = path.relative(directory, file);
    for (const note of verdict.notes) {
      process.stderr.write(`validate-saves: note: ${label}: ${note}\n`);
    }
    if (verdict.ok) {
      process.stdout.write(`ok   ${label}\n`);
    } else {
      invalidCount++;
      process.stderr.write(`FAIL ${label}: ${verdict.reason}\n`);
    }
  }
  process.exit(invalidCount === 0 ? EXIT_OK : EXIT_INVALID);
}

await main();
