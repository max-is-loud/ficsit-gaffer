#!/usr/bin/env node
// Command-line entry for the source check: file size and header rules against source-limits.json.
// Exit 0 passes, 1 means findings, 2 means a configuration or environment problem.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, loadConfig } from './source-check/config.mjs';
import { listSourceFiles } from './source-check/files.mjs';
import { formatReport } from './source-check/report.mjs';
import { checkFile, findMissingExemptions } from './source-check/rules.mjs';
import { applyUpdates, writeConfig } from './source-check/update.mjs';

function findRepoRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new ConfigError('not inside a git repository');
  }
}

function collectFindings({ repoRoot, config }) {
  const files = listSourceFiles({ repoRoot, config });
  const findings = files.flatMap((file) => {
    const text = fs.readFileSync(path.join(repoRoot, file), 'utf8');
    return checkFile({ path: file, text, config });
  });
  const missing = findMissingExemptions({ config, checkedPaths: new Set(files) });
  return [...findings, ...missing];
}

/**
 * Runs the source check, optionally ratcheting source-limits.json first.
 * @param {{ cwd: string, update: boolean }} input
 * @returns {{ text: string, exitCode: 0 | 1 | 2 }}
 */
export function runCheck({ cwd, update }) {
  try {
    const repoRoot = findRepoRoot(cwd);
    const configPath = path.join(repoRoot, 'source-limits.json');
    let config = loadConfig(configPath);
    if (update) {
      config = applyUpdates({ config, findings: collectFindings({ repoRoot, config }) });
      writeConfig({ path: configPath, config });
    }
    return formatReport({ findings: collectFindings({ repoRoot, config }), config });
  } catch (error) {
    if (error instanceof ConfigError) {
      return { text: error.message.split('\n')[0], exitCode: 2 };
    }
    throw error;
  }
}

const isEntryPoint = process.argv[1] === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  const { text, exitCode } = runCheck({
    cwd: process.cwd(),
    update: process.argv.includes('--update'),
  });
  if (text !== '') {
    (exitCode === 2 ? process.stderr : process.stdout).write(`${text}\n`);
  }
  process.exitCode = exitCode;
}
