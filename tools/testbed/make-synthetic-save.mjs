// Test helper: writes a tiny but valid Satisfactory save with the pinned parser library, so
// the tests can run in a clean clone without a real save. The body is split into several
// small chunks, so a prefix of the file can end exactly between two chunks.
// It prints the length of the save, and the offsets of three cut points on stdout:
//   length=<n>  header_end=<n> (before the first chunk)  boundary=<n> (between chunks 1 and 2)
//   mid=<n> (inside the first chunk)
//
// Usage:  node make-synthetic-save.mjs <output-file>

import { writeFileSync } from 'node:fs';
import { Parser } from '@etothepii/satisfactory-file-parser';

const LEVEL_NAME = 'Persistent_Level';
const CHUNK_HEADER_SIZE = 49;
const SMALL_CHUNK_BYTES = 16;

function buildSave() {
  return {
    name: 'synthetic',
    header: {
      saveHeaderType: 14,
      saveVersion: 46,
      saveName: 'synthetic',
      buildVersion: 1,
      mapName: LEVEL_NAME,
      mapOptions: '',
      sessionName: 'synthetic',
      playDurationSeconds: 0,
      saveDateTime: '1700000000000',
      sessionVisibility: 0,
      fEditorObjectVersion: 0,
      rawModMetadataString: '{}',
      modMetadata: {},
      isModdedSave: 0,
      saveIdentifier: 'synthetic',
      partitionEnabledFlag: false,
      consistencyHashBytes: { isValid: false },
      creativeModeEnabled: false,
    },
    saveBodyValidation: { grids: {} },
    levels: {
      [LEVEL_NAME]: {
        name: LEVEL_NAME,
        objects: [],
        collectables: [],
        writesDestroyedActorsInTOCBlob: false,
      },
    },
    compressionInfo: {
      chunkHeaderVersion: 0x22222222,
      packageFileTag: 0x9e2a83c1,
      maxUncompressedChunkContentSize: SMALL_CHUNK_BYTES,
      compressionAlgorithm: 3,
    },
    unresolvedWorldSaveData: [],
  };
}

function main() {
  const outputPath = process.argv[2];
  if (!outputPath) {
    process.stderr.write('usage: make-synthetic-save.mjs <output-file>\n');
    process.exit(2);
  }
  const parts = [];
  Parser.WriteSave(
    buildSave(),
    (header) => parts.push(Buffer.from(header)),
    (chunk) => parts.push(Buffer.from(chunk)),
  );
  if (parts.length < 4) {
    throw new Error('expected a header and at least three chunks');
  }
  const bytes = Buffer.concat(parts);
  writeFileSync(outputPath, bytes);
  const headerEnd = parts[0].length;
  const boundary = headerEnd + parts[1].length;
  const mid = headerEnd + CHUNK_HEADER_SIZE + 4;
  process.stdout.write(
    `length=${bytes.length} header_end=${headerEnd} boundary=${boundary} mid=${mid}\n`,
  );
}

main();
