// Lists the repository files the source check applies to, using git as the source of truth.
// It also holds the glob and test-file helpers so the rules never re-implement path matching.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** @typedef {import('./config.mjs').SourceLimitsConfig} SourceLimitsConfig */

/** @type {readonly string[]} */
export const SOURCE_EXTENSIONS = Object.freeze(['.ts', '.tsx', '.js', '.mjs', '.cs', '.cpp', '.h']);

const REGEXP_SPECIALS = /[.+^${}()|[\]\\?]/g;

/**
 * Converts a glob to an anchored RegExp: `**` spans path segments, `*` stays in one.
 * @param {string} glob
 * @returns {RegExp}
 */
export function globToRegExp(glob) {
  let source = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      const followedBySlash = glob[index + 2] === '/';
      source += followedBySlash ? '(?:.*/)?' : '.*';
      index += followedBySlash ? 2 : 1;
    } else if (char === '*') {
      source += '[^/]*';
    } else {
      source += char.replace(REGEXP_SPECIALS, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

const TEST_FOLDER = /^(?:tests?|.+-tests)$/i;

/**
 * Whether a path is a test file: in a test folder or a `-tests` folder, or named `.test.`/`.spec.`.
 * @param {string} filePath repo-relative POSIX path
 * @returns {boolean}
 */
export function isTestFile(filePath) {
  const segments = filePath.split('/');
  const name = segments.pop() ?? '';
  return segments.some((segment) => TEST_FOLDER.test(segment)) || /\.(?:test|spec)\./.test(name);
}

function gitFileList(repoRoot) {
  const output = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  return output.split('\0').filter((entry) => entry !== '');
}

/**
 * Lists tracked and untracked-but-not-ignored source files that exist on disk and are in scope.
 * @param {{ repoRoot: string, config: SourceLimitsConfig }} options
 * @returns {string[]} sorted repo-relative POSIX paths
 */
export function listSourceFiles({ repoRoot, config }) {
  const ignored = config.ignore.map(globToRegExp);
  const exemptPrefixes = config.exemptDirectories.map((directory) => directory.path);
  const candidates = new Set(gitFileList(repoRoot));
  return [...candidates]
    .filter((file) => SOURCE_EXTENSIONS.includes(path.posix.extname(file)))
    .filter((file) => !ignored.some((pattern) => pattern.test(file)))
    .filter((file) => !exemptPrefixes.some((prefix) => file.startsWith(prefix)))
    .filter((file) => fs.existsSync(path.join(repoRoot, ...file.split('/'))))
    .sort();
}
