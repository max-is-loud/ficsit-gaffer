#!/usr/bin/env node
// Validates bundled game-data pull requests.
//
// A bundled channel is a SINGLE merged file under
// packages/sf-game-data/data/<channel>/:
//
//   sf-game-data.json    the extracted collectible/resource-node dataset, plus the
//                        `gameData` (items/recipes/etc.) the offline extractor
//                        parses from the game's en-US.json, plus the channel's
//                        gameVersion + build at the top level.
//
// (The raw en-US.json and the old meta.json sidecar are no longer committed — the
// extractor reads en-US.json from the game install and stamps gameVersion/build
// into the dataset; see docs/sf-game-data-extractor.md.) A data PR must:
//   - touch only files under a SINGLE channel directory (one channel per PR);
//   - ship a well-formed sf-game-data.json with a non-empty gameVersion (string)
//     and a positive-integer build that does not regress below the channel's
//     current build (a same-build re-extraction is allowed);
//   - keep collectibles[]/resourceNodes[] counts equal to the actual array lengths,
//     with collectible counts equal to the known fixed world totals;
//   - carry a non-empty `gameData` (items/resources/recipes/buildings/schematics).
//
// On PRs that touch no bundled game data, this is a no-op (exit 0), so it is
// safe to require as a status check on every pull request.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = 'packages/sf-game-data/data';
const CHANNELS = ['stable', 'experimental'];
const BUNDLE_FILES = ['sf-game-data.json'];
// Shared, build-independent hand-traced biome regions (#239) — NOT a channel dataset.
const BIOMES_FILE = 'biomes.json';

/** Fixed public world totals — the completeness oracle for a regenerated dataset. */
const KNOWN_COLLECTIBLE_TOTALS = {
  mercerSphere: 298,
  somersloop: 106,
  powerSlugBlue: 596,
  powerSlugYellow: 389,
  powerSlugPurple: 257,
  hardDrive: 118,
  helmet: 1,
  mtape: 3,
  crashSitePart: 703,
};

const baseSha = process.env.BASE_SHA;
const headSha = process.env.HEAD_SHA ?? 'HEAD';

const errors = [];
const fail = (message) => errors.push(message);

function git(command) {
  // Capture stderr (pipe) so expected failures — e.g. `git show` for a channel
  // that doesn't exist on the base branch — don't leak `fatal:` noise to logs.
  return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Validates the shared biome-regions file (#239): a non-empty biomes[] with named,
 *  polygon-bearing entries and exactly the four pioneer starting biomes. */
function validateBiomes(file) {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${file} is not valid JSON: ${error instanceof Error ? error.message : error}`);
    return;
  }
  const biomes = doc?.biomes;
  if (!Array.isArray(biomes) || biomes.length === 0) {
    fail(`${file} must contain a non-empty "biomes" array.`);
    return;
  }
  for (const b of biomes) {
    if (typeof b?.name !== 'string' || b.name.length === 0) {
      fail(`${file}: every biome needs a non-empty string "name".`);
      return;
    }
    if (!Array.isArray(b?.polygons) || b.polygons.length === 0) {
      fail(`${file}: biome '${b.name}' has no polygons.`);
      return;
    }
  }
  const starts = biomes.filter((b) => b?.isStartingLocation === true).length;
  if (starts !== 4) {
    fail(`${file}: expected 4 starting biomes, found ${starts}.`);
  }
  console.log(`${file} OK: ${biomes.length} biomes, ${starts} starting locations.`);
}

const changed = git(`git diff --name-only ${baseSha} ${headSha}`)
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

// The shared biomes file is validated on its own (not a channel dataset).
if (changed.includes(`${DATA_DIR}/${BIOMES_FILE}`)) {
  validateBiomes(`${DATA_DIR}/${BIOMES_FILE}`);
}

// Every changed channel-bundle file under data/, excluding the README and the shared biomes file.
const dataChanged = changed.filter(
  (file) =>
    file.startsWith(`${DATA_DIR}/`) &&
    file !== `${DATA_DIR}/README.md` &&
    file !== `${DATA_DIR}/${BIOMES_FILE}`,
);

// --- Channel dataset validation (only when a channel bundle actually changed) ---
if (dataChanged.length > 0) {
  // 1. One channel per PR
  const touchedChannels = new Set(
    dataChanged.map((file) => file.slice(DATA_DIR.length + 1).split('/')[0]),
  );
  if (touchedChannels.size > 1) {
    fail(`Update one channel per PR. Channels touched: ${[...touchedChannels].join(', ')}.`);
  }
  const channel = [...touchedChannels][0];
  if (!CHANNELS.includes(channel)) {
    fail(`Unknown channel directory '${channel}'. Allowed: ${CHANNELS.join(', ')}.`);
  } else {
    const channelDir = `${DATA_DIR}/${channel}`;
    // A channel data PR may also touch the shared biomes.json / README, but nothing else.
    const stray = changed.filter(
      (file) =>
        !file.startsWith(`${channelDir}/`) &&
        file !== `${DATA_DIR}/${BIOMES_FILE}` &&
        file !== `${DATA_DIR}/README.md`,
    );
    if (stray.length > 0) {
      fail(
        `A channel data PR must touch only ${channelDir}/ (optionally ${BIOMES_FILE} / README). Unexpected changes:\n  ${stray.join('\n  ')}`,
      );
    }
    validateBundle(channel, channelDir);
  }
} else if (errors.length === 0) {
  console.log('No channel-dataset changes; biomes.json validated (if changed).');
}

if (errors.length > 0) {
  console.error('Game-data validation failed:');
  for (const error of errors) {
    console.error(`  ✗ ${error}`);
  }
  process.exit(1);
}

console.log('✓ bundled game data is valid.');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    fail(`${file} is not valid JSON.`);
    return undefined;
  }
}

function validateBundle(channel, channelDir) {
  // The bundle must be complete: every expected file present.
  for (const name of BUNDLE_FILES) {
    if (!fs.existsSync(path.join(channelDir, name))) {
      fail(
        `${path.join(channelDir, name)} is missing — a channel bundle needs all of: ${BUNDLE_FILES.join(', ')}.`,
      );
    }
  }
  validateDataset(channel, channelDir);
}

function validateDataset(channel, channelDir) {
  const file = path.join(channelDir, 'sf-game-data.json');
  if (!fs.existsSync(file)) {
    return undefined;
  }
  const data = readJson(file);
  if (!data) {
    return undefined;
  }

  // Version + build live in sf-game-data.json itself now (meta.json was retired).
  if (typeof data.gameVersion !== 'string' || data.gameVersion.trim() === '') {
    fail(`${file}: gameVersion must be a non-empty string.`);
  }
  if (!Number.isInteger(data.build) || data.build <= 0) {
    fail(`${file}: build must be a positive integer.`);
  }
  // A channel only moves forward, never back. A same-build re-extraction (build
  // unchanged) is allowed; a new build must not regress below the current one.
  let baseBuild = null;
  try {
    baseBuild = JSON.parse(git(`git show ${baseSha}:${file}`)).build;
  } catch {
    baseBuild = null; // channel did not exist on the base branch — first one is fine.
  }
  if (Number.isInteger(baseBuild) && Number.isInteger(data.build) && data.build < baseBuild) {
    fail(
      `${file}: build (${data.build}) must not be lower than the current ${channel} build (${baseBuild}).`,
    );
  }

  if (!Array.isArray(data.collectibles) || !Array.isArray(data.resourceNodes)) {
    fail(`${file} must have array 'collectibles' and 'resourceNodes'.`);
    return undefined;
  }

  // counts must equal the actual array lengths.
  const tally = {};
  for (const c of [...data.collectibles, ...data.resourceNodes]) {
    tally[c.kind] = (tally[c.kind] ?? 0) + 1;
  }
  // Loose crash-site parts are a separate array (no per-entry kind); they tally as `crashSitePart`.
  const loot = Array.isArray(data.lootPickups) ? data.lootPickups : [];
  if (loot.length > 0) {
    tally['crashSitePart'] = loot.length;
  }
  for (const [kind, n] of Object.entries(tally)) {
    if (data.counts?.[kind] !== n) {
      fail(`${file}: counts.${kind} (${data.counts?.[kind]}) != actual array length (${n}).`);
    }
  }
  for (const kind of Object.keys(data.counts ?? {})) {
    if (tally[kind] === undefined) {
      fail(`${file}: counts.${kind} present but no matching entries exist.`);
    }
  }

  // collectible counts must equal the known fixed world totals.
  for (const [kind, expected] of Object.entries(KNOWN_COLLECTIBLE_TOTALS)) {
    if (data.counts?.[kind] !== expected) {
      fail(`${file}: ${kind} count (${data.counts?.[kind]}) != known world total (${expected}).`);
    }
  }

  // The merged dataset (#160) also carries `gameData` parsed from en-US.json —
  // items, resources, recipes, buildings and schematics keyed by class name.
  // Require the object and non-empty core maps so a broken/empty parse fails CI.
  const gameData = data.gameData;
  if (typeof gameData !== 'object' || gameData === null || Array.isArray(gameData)) {
    fail(`${file} must have a 'gameData' object (the merged en-US.json parse).`);
  } else {
    for (const key of ['items', 'resources', 'recipes', 'buildings', 'schematics']) {
      const section = gameData[key];
      if (typeof section !== 'object' || section === null || Array.isArray(section)) {
        fail(`${file}: gameData.${key} must be an object keyed by class name.`);
      } else if (Object.keys(section).length === 0) {
        fail(`${file}: gameData.${key} is empty — the en-US.json parse looks broken.`);
      }
    }
  }

  return data;
}
