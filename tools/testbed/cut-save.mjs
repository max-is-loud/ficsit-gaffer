// Test helper: writes a truncated copy of a real save, cut either inside a compressed chunk
// ("mid") or exactly between two chunks ("boundary"), and prints the cut offset. The tests
// use the copies to prove that validate-saves.mjs rejects a save that a writer has not
// finished. It walks the chunk headers by hand so that it does not depend on the parser.
//
// Usage:  node cut-save.mjs <save> mid|boundary <output-file>

import { readFileSync, writeFileSync } from 'node:fs';

const PACKAGE_FILE_TAG = 0x9e2a83c1;
const CHUNK_HEADER_V2 = 0x22222222;
const CHUNK_HEADER_SIZE = 49;
const COMPRESSED_SIZE_OFFSET = 33;

function findFirstChunk(bytes) {
  for (let offset = 0; offset + 8 <= bytes.length; offset++) {
    if (
      bytes.readUInt32LE(offset) === PACKAGE_FILE_TAG &&
      bytes.readUInt32LE(offset + 4) === CHUNK_HEADER_V2
    ) {
      return offset;
    }
  }
  throw new Error('no chunk header found: not a version-2 save');
}

function listChunkOffsets(bytes) {
  const offsets = [];
  let offset = findFirstChunk(bytes);
  while (offset < bytes.length) {
    offsets.push(offset);
    offset += CHUNK_HEADER_SIZE + bytes.readInt32LE(offset + COMPRESSED_SIZE_OFFSET);
  }
  if (offset !== bytes.length) {
    throw new Error('chunks do not end at the end of the file');
  }
  return offsets;
}

function main() {
  const [savePath, mode, outputPath] = process.argv.slice(2);
  if (!savePath || !['mid', 'boundary'].includes(mode) || !outputPath) {
    process.stderr.write('usage: cut-save.mjs <save> mid|boundary <output-file>\n');
    process.exit(2);
  }
  const bytes = readFileSync(savePath);
  const offsets = listChunkOffsets(bytes);
  const boundary = offsets[Math.floor(offsets.length / 2)];
  const cutAt = mode === 'boundary' ? boundary : boundary + CHUNK_HEADER_SIZE + 10;
  writeFileSync(outputPath, bytes.subarray(0, cutAt));
  process.stdout.write(`${cutAt}\n`);
}

main();
