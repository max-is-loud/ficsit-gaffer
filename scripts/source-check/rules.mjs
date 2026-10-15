// The source check's size and header rules: each takes a file's text and yields findings.
// It decides what is wrong, and leaves wording to report.mjs and file discovery to files.mjs.

import { isTestFile } from './files.mjs';

/** @typedef {import('./config.mjs').SourceLimitsConfig} SourceLimitsConfig */
/**
 * @typedef {object} Finding
 * @property {string} path
 * @property {'too-long'|'soft-limit'|'exempt-grew'|'exempt-shrunk'|'exempt-compliant'
 *   |'exempt-missing'|'missing-header'} kind
 * @property {'error'|'warning'} severity
 * @property {number} [lines] Current physical line count.
 * @property {number} [recorded] Line count recorded in the ratchet list.
 * @property {number} [issue] Refactor issue linked to the exemption.
 */

const BYTE_ORDER_MARK = '﻿';
const COMMENT_OPENERS = ['//', '/*'];

/**
 * Counts physical lines the way `wc -l` does: the number of newline characters.
 * @param {string} text
 * @returns {number}
 */
export function countLines(text) {
  let count = 0;
  for (const char of text) {
    if (char === '\n') {
      count += 1;
    }
  }
  return count;
}

const isSkippable = (line, index) =>
  line.trim() === '' || line.trim() === '#pragma once' || (index === 0 && line.startsWith('#!'));

/**
 * True when the first meaningful line opens a comment. A shebang, `#pragma once`, a BOM and
 * blank lines are skipped because they must precede the header in some languages.
 * @param {string} text
 * @returns {boolean}
 */
export function hasHeader(text) {
  const stripped = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text;
  const first = stripped.split('\n').find((line, index) => !isSkippable(line, index));
  if (first === undefined) {
    return false;
  }
  return COMMENT_OPENERS.some((opener) => first.trim().startsWith(opener));
}

const error = (path, kind, extra) => ({ path, kind, severity: 'error', ...extra });

/** Size findings for a file with a ratchet entry; the entry is what makes the file exempt. */
function checkExempt({ path, lines, entry, config }) {
  const common = { lines, recorded: entry.lines, issue: entry.issue };
  if (lines <= config.hardLimit) {
    return [error(path, 'exempt-compliant', common)];
  }
  if (lines > entry.lines) {
    return [error(path, 'exempt-grew', common)];
  }
  return lines < entry.lines ? [error(path, 'exempt-shrunk', common)] : [];
}

function checkUnexempt({ path, lines, config }) {
  if (lines > config.hardLimit) {
    return [error(path, 'too-long', { lines })];
  }
  if (lines > config.softLimit) {
    return [{ path, kind: 'soft-limit', severity: 'warning', lines }];
  }
  return [];
}

/**
 * Applies the size and header rules to one file.
 * @param {{ path: string, text: string, config: SourceLimitsConfig }} input
 * @returns {Finding[]}
 */
export function checkFile({ path, text, config }) {
  const lines = countLines(text);
  const entry = config.exemptFiles.find((candidate) => candidate.path === path);
  const size = entry
    ? checkExempt({ path, lines, entry, config })
    : checkUnexempt({ path, lines, config });
  const header = isTestFile(path) || hasHeader(text) ? [] : [error(path, 'missing-header')];
  return [...size, ...header];
}

/**
 * Reports ratchet entries whose file was not among the checked paths, so stale ones get removed.
 * @param {{ config: SourceLimitsConfig, checkedPaths: Set<string> }} input
 * @returns {Finding[]}
 */
export function findMissingExemptions({ config, checkedPaths }) {
  return config.exemptFiles
    .filter((entry) => !checkedPaths.has(entry.path))
    .map((entry) => error(entry.path, 'exempt-missing', { issue: entry.issue }));
}
