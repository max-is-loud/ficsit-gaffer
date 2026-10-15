#!/usr/bin/env node
// Command-line entry for the source check. It runs unconditionally, so a symlinked path cannot skip it.
// Exit 0 passes, 1 means findings, 2 means a configuration, usage or environment problem.

import { runCli } from './source-check/cli.mjs';

const { text, exitCode } = runCli({ cwd: process.cwd(), args: process.argv.slice(2) });
if (text !== '') {
  (exitCode === 2 ? process.stderr : process.stdout).write(`${text}\n`);
}
process.exitCode = exitCode;
