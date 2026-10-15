// The source check's orchestration: find the repository root, collect findings, optionally ratchet.
// It lives here, not in the entry script, so tests and the entry share one tested implementation.
// Exit codes: 0 passes, 1 means findings, 2 means a configuration or environment problem.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ConfigError, loadConfig } from './config.mjs';
import { listSourceFiles } from './files.mjs';
import { formatReport } from './report.mjs';
import { checkFile, findMissingExemptions } from './rules.mjs';
import { applyUpdates, writeConfig } from './update.mjs';

function firstLine(error) {
  return String(error instanceof Error ? error.message : error).split('\n')[0];
}

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
      return { text: firstLine(error), exitCode: 2 };
    }
    // Anything else (git failing, an unreadable file) is an environment problem, not a finding.
    return { text: `source check failed: ${firstLine(error)}`, exitCode: 2 };
  }
}

/**
 * Runs the check for a command line, rejecting anything but `--update` so a typo cannot pass.
 * @param {{ cwd: string, args: string[] }} input
 * @returns {{ text: string, exitCode: 0 | 1 | 2 }}
 */
export function runCli({ cwd, args }) {
  const unknown = args.find((arg) => arg !== '--update');
  if (unknown !== undefined) {
    return { text: `unknown argument ${unknown}; the only option is --update`, exitCode: 2 };
  }
  return runCheck({ cwd, update: args.length > 0 });
}
