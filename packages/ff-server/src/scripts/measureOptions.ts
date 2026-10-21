// Parses and checks the measurement CLI's options before anything runs. A mistyped count would
// otherwise measure nothing yet exit cleanly, or reach the provider as NaN.

import path from 'node:path';
import { parseArgs } from 'node:util';

import { resolveServerConfig, serverLlmConfig } from '../config.js';
import type { LlmRuntimeConfig } from '../llm/types.js';
import { MEASURE_SCENARIOS, type MeasureScenario } from './measureScenarios.js';

/**
 * The option's value as a whole number of at least `min`. Throws, naming the option, for anything
 * else: `abc`, `1.5`, `2e3`, a negative or an empty string.
 */
export function integerOption(name: string, value: string, min: number): number {
  const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    throw new Error(`--${name} must be a whole number of at least ${min}; got '${value}'.`);
  }
  return parsed;
}

/** What one measurement run measures, and where it writes. */
export interface MeasureOptions {
  savePath: string;
  scenarios: MeasureScenario[];
  runs: number;
  llm: LlmRuntimeConfig;
  outPath?: string;
  tracePath?: string;
  /** Characters of each tool result kept in the trace. */
  traceResultChars: number;
}

/** Reads the options from the command line; throws on a missing save or key, or a bad value. */
export function parseOptions(): MeasureOptions {
  const { values } = parseArgs({
    options: {
      save: { type: 'string' },
      scenario: { type: 'string', default: 'all' },
      runs: { type: 'string', default: '5' },
      model: { type: 'string' },
      'max-tokens': { type: 'string', default: '16000' },
      out: { type: 'string' },
      trace: { type: 'string' },
      'trace-result-chars': { type: 'string', default: '4000' },
    },
  });
  const config = resolveServerConfig();
  if (values.save === undefined || config.hostedApiKey === undefined) {
    throw new Error('Pass --save <file.sav> and set LLM_API_KEY.');
  }
  const scenarios = MEASURE_SCENARIOS.filter(
    (scenario) => values.scenario === 'all' || scenario.id === values.scenario,
  );
  if (scenarios.length === 0) {
    throw new Error(`Unknown scenario '${values.scenario}'.`);
  }
  const llm = serverLlmConfig(config, config.hostedApiKey);
  return {
    savePath: path.resolve(values.save),
    scenarios,
    runs: integerOption('runs', values.runs, 1),
    llm: {
      ...llm,
      model: values.model ?? llm.model,
      maxTokens: integerOption('max-tokens', values['max-tokens'], 1),
    },
    outPath: values.out,
    tracePath: values.trace,
    traceResultChars: integerOption('trace-result-chars', values['trace-result-chars'], 0),
  };
}
