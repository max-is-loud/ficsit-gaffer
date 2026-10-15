// Test helper that builds a throwaway git repository from a map of file paths to contents.
// Each source-check test uses it so that file listing runs against real git behaviour.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Environment that stops git reading the developer's own configuration or parent repositories. */
export const HERMETIC_GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

/**
 * Creates a temporary git repository, writes the files and stages them.
 * @param {Record<string, string>} files repo-relative POSIX paths mapped to contents
 * @returns {string} absolute path of the repository; the caller removes it
 */
export function makeRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'source-check-'));
  const git = (...args) =>
    execFileSync('git', args, { cwd: root, stdio: 'ignore', env: HERMETIC_GIT_ENV });
  git('init', '-q');
  git('config', 'user.name', 'Source Check');
  git('config', 'user.email', 'source-check@example.invalid');
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
  git('add', '-A');
  return root;
}
