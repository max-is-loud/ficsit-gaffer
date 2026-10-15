// Disk access for save files: reads a .sav into an ArrayBuffer and reports its modification time.

import fs from 'node:fs';

/** Reads a `.sav` file into an ArrayBuffer (the shape the parser expects). */
export function readSaveFile(filePath: string): ArrayBuffer {
  const buffer = fs.readFileSync(filePath);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

/** Last-modified time in milliseconds, used to detect when a save changes. */
export function statMtimeMs(filePath: string): number {
  return fs.statSync(filePath).mtimeMs;
}
