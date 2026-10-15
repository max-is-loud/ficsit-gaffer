// The single boundary against @etothepii/satisfactory-file-parser: parses a save buffer or
// file into the local RawSave shape, keeping the library's console output off stdout.

import { Parser } from '@etothepii/satisfactory-file-parser';

import { readSaveFile } from './reader.js';
import type { RawSave } from './types.js';

/**
 * The sole boundary against the adopted save parser. Everything else in this
 * package depends on the local `RawSave` shape, not the library's types, so a
 * future swap (or our own parser) is contained here.
 */

/**
 * Parses an in-memory save buffer. The library writes progress and
 * "trailing data" notices to the console; we redirect `console.log` to stderr
 * for the duration so a stray stdout write can never corrupt the stdio MCP
 * frame (the library's own diagnostics already go to stderr, which is safe).
 */
export function parseSaveBuffer(name: string, buffer: ArrayBuffer): RawSave {
  const originalLog = console.log.bind(console);
  console.log = (...args: unknown[]): void => {
    console.error(...args);
  };
  try {
    return Parser.ParseSave(name, buffer) as unknown as RawSave;
  } finally {
    console.log = originalLog;
  }
}

/** Reads and parses a save file from disk. */
export function parseSaveFile(filePath: string, name: string): RawSave {
  return parseSaveBuffer(name, readSaveFile(filePath));
}
