// Loads and validates source-limits.json, the ratchet list for the source check.
// Validation is strict (unknown keys, missing issues and duplicates fail) so the list cannot rot.

import fs from 'node:fs';

/**
 * @typedef {{ path: string, issue: number, reason: string }} ExemptDirectory
 * @typedef {{ path: string, lines: number, issue: number }} ExemptFile
 * @typedef {{
 *   softLimit: number,
 *   hardLimit: number,
 *   ignore: string[],
 *   exemptDirectories: ExemptDirectory[],
 *   exemptFiles: ExemptFile[],
 * }} SourceLimitsConfig
 */

const TOP_LEVEL_KEYS = ['softLimit', 'hardLimit', 'ignore', 'exemptDirectories', 'exemptFiles'];
const DIRECTORY_KEYS = ['path', 'issue', 'reason'];
const FILE_KEYS = ['path', 'lines', 'issue'];

/** A configuration problem, reported by the CLI as a single line without a stack trace. */
export class ConfigError extends Error {
  /** @param {string} message what is wrong, without the file prefix */
  constructor(message) {
    super(`source-limits.json: ${message}`);
    this.name = 'ConfigError';
  }
}

const isPlainObject = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0;

function rejectUnknownKeys(object, allowed, where) {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) {
      throw new ConfigError(`unknown key "${key}" in ${where}`);
    }
  }
}

function requireString(value, where) {
  if (typeof value !== 'string' || value === '') {
    throw new ConfigError(`${where} must be a non-empty string`);
  }
  return value;
}

function requireNumber(value, where) {
  if (!isPositiveInteger(value)) {
    throw new ConfigError(`${where} must be a positive integer`);
  }
  return value;
}

function requireArray(value, where) {
  if (!Array.isArray(value)) {
    throw new ConfigError(`${where} must be an array`);
  }
  return value;
}

function requireObject(value, where) {
  if (!isPlainObject(value)) {
    throw new ConfigError(`${where} must be an object`);
  }
  return value;
}

function parseEntries({ raw, where, keys, build }) {
  const seen = new Set();
  return requireArray(raw, where).map((item, index) => {
    const label = `${where}[${index}]`;
    requireObject(item, label);
    rejectUnknownKeys(item, keys, label);
    const entry = build(item, label);
    if (seen.has(entry.path)) {
      throw new ConfigError(`duplicate path "${entry.path}" in ${where}`);
    }
    seen.add(entry.path);
    return entry;
  });
}

const buildDirectory = (item, label) => {
  const dirPath = requireString(item.path, `${label}.path`);
  if (!dirPath.endsWith('/')) {
    throw new ConfigError(`${label}.path must end in "/"`);
  }
  return {
    path: dirPath,
    issue: requireNumber(item.issue, `${label}.issue`),
    reason: requireString(item.reason, `${label}.reason`),
  };
};

const buildFile = (item, label) => ({
  path: requireString(item.path, `${label}.path`),
  lines: requireNumber(item.lines, `${label}.lines`),
  issue: requireNumber(item.issue, `${label}.issue`),
});

function parseJson(jsonText) {
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    throw new ConfigError(`invalid JSON (${error.message})`);
  }
}

/**
 * Parses and validates the text of source-limits.json.
 * @param {string} jsonText
 * @returns {SourceLimitsConfig}
 * @throws {ConfigError}
 */
export function parseConfig(jsonText) {
  const raw = requireObject(parseJson(jsonText), 'the top level');
  const { $comment: _comment, ...rest } = raw;
  rejectUnknownKeys(rest, TOP_LEVEL_KEYS, 'the top level');
  const softLimit = requireNumber(rest.softLimit, 'softLimit');
  const hardLimit = requireNumber(rest.hardLimit, 'hardLimit');
  if (softLimit >= hardLimit) {
    throw new ConfigError('softLimit must be lower than hardLimit');
  }
  const ignore = requireArray(rest.ignore, 'ignore').map((glob, index) =>
    requireString(glob, `ignore[${index}]`),
  );
  return {
    softLimit,
    hardLimit,
    ignore,
    exemptDirectories: parseEntries({
      raw: rest.exemptDirectories,
      where: 'exemptDirectories',
      keys: DIRECTORY_KEYS,
      build: buildDirectory,
    }),
    exemptFiles: parseEntries({
      raw: rest.exemptFiles,
      where: 'exemptFiles',
      keys: FILE_KEYS,
      build: buildFile,
    }),
  };
}

/**
 * Reads and validates a source-limits.json file.
 * @param {string} filePath
 * @returns {SourceLimitsConfig}
 * @throws {ConfigError}
 */
export function loadConfig(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new ConfigError(`cannot read ${filePath} (${error.message})`);
  }
  return parseConfig(text);
}
