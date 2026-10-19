// CLI that replays fixed chat scenarios through the real runChat loop, provider and sf-mcp
// against a scratch database and a copy of a save, and reports rounds, tool calls and token
// usage per measured turn. Used to compare the foreman's tool economy before and after a change.
//
// Usage: npm run measure:turn -w @foreman/ff-server -- --save <file.sav> [--scenario <id|all>]
//          [--runs 5] [--model <id>] [--max-tokens 16000] [--out results.jsonl]
//          [--trace trace.jsonl] [--trace-result-chars 4000]
// --trace appends every scenario turn's tool arguments, capped results, answer and work orders.
// Environment: LLM_API_KEY (and LLM_PROVIDER), MCP_URL — as for the server. Run sf-mcp locally
// with MCP_TRANSPORT=http and SAVE_DATA_DIR set to the OS temp directory (e.g. /tmp), where the
// scratch saves are written.

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

import type { PrismaClient } from '@prisma/client';

import { SaveSummaryCache } from '../context/saveSummaryCache.js';
import { buildTurnContext } from '../context/turnContext.js';
import { loadSystemPromptTemplate } from '../anthropic/systemPrompt.js';
import { resolveServerConfig, resolveSystemPromptPath, serverLlmConfig } from '../config.js';
import { runChat, type ChatDeps } from '../llm/chat.js';
import { createProvider } from '../llm/factory.js';
import type { LlmRequest, LlmRuntimeConfig } from '../llm/types.js';
import type { TurnMetrics } from '../llm/turnMetrics.js';
import { McpHttpClient } from '../mcp/client.js';
import { PlaythroughService } from '../services/playthroughService.js';
import { SaveService } from '../services/saveService.js';
import { WorkOrderService } from '../services/workOrderService.js';
import {
  inputEquivalent,
  renderReportTable,
  renderToolTable,
  toolResultCharsByName,
  type MeasuredTurn,
} from './measureReport.js';
import { MEASURE_SCENARIOS, type MeasureScenario } from './measureScenarios.js';
import { RecordingProvider, traceToolCalls, type TurnTrace } from './measureTrace.js';
import { createScratchDb } from './scratchDb.js';

interface MeasureOptions {
  savePath: string;
  scenarios: MeasureScenario[];
  runs: number;
  llm: LlmRuntimeConfig;
  outPath?: string;
  tracePath?: string;
  /** Characters of each tool result kept in the trace. */
  traceResultChars: number;
}

function parseOptions(): MeasureOptions {
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
    runs: Number.parseInt(values.runs, 10),
    llm: { ...llm, model: values.model ?? llm.model, maxTokens: Number(values['max-tokens']) },
    outPath: values.out,
    tracePath: values.trace,
    traceResultChars: Number.parseInt(values['trace-result-chars'], 10),
  };
}

/** Creates a fresh playthrough with the save attached; returns its id and save path. */
async function freshPlaythrough(
  prisma: PrismaClient,
  saves: SaveService,
  savePath: string,
): Promise<{ playthroughId: string; attachedSave?: string }> {
  const suffix = Math.random().toString(36).slice(2);
  const user = await prisma.user.create({
    data: { id: `measure-${suffix}`, name: 'Measure', email: `${suffix}@measure.local` },
  });
  const foreman = await prisma.foreman.create({
    data: { userId: user.id, name: 'Foreman', personality: '' },
  });
  const playthrough = await new PlaythroughService(prisma).create({
    userId: user.id,
    foremanId: foreman.id,
  });
  await saves.addVersion(playthrough.id, {
    fileName: path.basename(savePath),
    bytes: fs.readFileSync(savePath),
  });
  return { playthroughId: playthrough.id, attachedSave: await saves.getSavePath(playthrough.id) };
}

interface RunContext {
  options: MeasureOptions;
  deps: ChatDeps;
  saves: SaveService;
  prisma: PrismaClient;
  /** Receives every scenario turn's trace; the CLI appends them to `--trace`. */
  onTrace?: (trace: TurnTrace) => void;
}

interface TurnOutcome {
  text: string;
  metrics: TurnMetrics | undefined;
  lastRequest: LlmRequest | undefined;
}

/** Asks one question through production's turn context and chat loop. */
async function runTurn(
  context: RunContext,
  playthroughId: string,
  saveSummaries: SaveSummaryCache,
  question: string,
): Promise<TurnOutcome> {
  const { options, deps } = context;
  await deps.playthroughs.appendMessage(playthroughId, 'user', question);
  const provider = new RecordingProvider(createProvider(options.llm));
  let metrics: TurnMetrics | undefined;
  const turnContext = await buildTurnContext(
    { saves: context.saves, saveSummaries, workOrders: deps.workOrders },
    playthroughId,
  );
  // The work-orders block can be present without a snapshot, so look for the snapshot itself.
  if (!turnContext.contextBlocks.some((block) => block.startsWith('## Save snapshot'))) {
    throw new Error('Measurement requires a save snapshot; check the MCP server and save path.');
  }
  const text = await runChat(
    {
      playthroughId,
      promptContext: { personality: '', pioneerProfile: '' },
      ...turnContext,
      provider,
      model: options.llm.model,
      maxTokens: options.llm.maxTokens,
    },
    deps,
    {
      text: () => {},
      toolUse: () => {},
      workOrder: () => {},
      metrics: (record) => (metrics = record),
    },
  );
  await deps.playthroughs.appendMessage(playthroughId, 'assistant', text);
  return { text, metrics, lastRequest: provider.lastRequest };
}

/** Replays one scenario on a fresh playthrough and returns its measured turn. */
export async function runScenario(
  context: RunContext,
  scenario: MeasureScenario,
  run: number,
): Promise<MeasuredTurn> {
  const { options, deps } = context;
  const { playthroughId } = await freshPlaythrough(context.prisma, context.saves, options.savePath);
  const saveSummaries = new SaveSummaryCache(deps.mcp);
  let measured: MeasuredTurn | undefined;
  for (const [index, question] of scenario.turns.entries()) {
    const outcome = await runTurn(context, playthroughId, saveSummaries, question);
    const isMeasured = index === scenario.measuredTurn;
    if (isMeasured && outcome.metrics !== undefined) {
      measured = toMeasuredTurn(scenario.id, run, outcome.metrics, outcome.lastRequest);
    }
    context.onTrace?.({
      scenario: scenario.id,
      run,
      turn: index,
      measured: isMeasured,
      question,
      contextBlocks: outcome.lastRequest?.contextBlocks ?? [],
      toolCalls: traceToolCalls(outcome.lastRequest?.messages ?? [], options.traceResultChars),
      answer: outcome.text,
      workOrders: await deps.workOrders.list(playthroughId),
    });
  }
  if (measured === undefined) {
    throw new Error(`Scenario '${scenario.id}' produced no measured turn.`);
  }
  return measured;
}

function toMeasuredTurn(
  scenario: string,
  run: number,
  metrics: TurnMetrics,
  lastRequest: LlmRequest | undefined,
): MeasuredTurn {
  const toolCalls: Record<string, number> = {};
  metrics.toolCalls.forEach((name) => (toolCalls[name] = (toolCalls[name] ?? 0) + 1));
  return {
    scenario,
    run,
    contextChars: (lastRequest?.contextBlocks ?? []).reduce((sum, block) => sum + block.length, 0),
    rounds: metrics.rounds,
    toolCalls,
    toolResultChars: toolResultCharsByName(lastRequest?.messages ?? []),
    usage: metrics.usage,
    inputEquivalent: inputEquivalent(metrics.usage),
    stopReason: metrics.stopReason,
    durationMs: metrics.durationMs,
  };
}

/** Runs a scenario `runs` times, appending each turn to the results file as it lands. */
async function runAll(context: RunContext, scenario: MeasureScenario): Promise<MeasuredTurn[]> {
  const turns: MeasuredTurn[] = [];
  for (let run = 1; run <= context.options.runs; run += 1) {
    const turn = await runScenario(context, scenario, run);
    turns.push(turn);
    if (context.options.outPath !== undefined) {
      fs.appendFileSync(context.options.outPath, `${JSON.stringify(turn)}\n`);
    }
    process.stderr.write(`${scenario.id} run ${run}: ${turn.rounds} rounds\n`);
  }
  return turns;
}

async function main(): Promise<void> {
  const options = parseOptions();
  const config = resolveServerConfig();
  const scratch = await createScratchDb();
  const mcp = new McpHttpClient(config.mcpUrl);
  const workOrders = new WorkOrderService(scratch.prisma);
  const saves = new SaveService(scratch.prisma, mcp, scratch.saveDataDir, workOrders);
  const deps: ChatDeps = {
    systemPromptTemplate: loadSystemPromptTemplate(resolveSystemPromptPath()),
    historyWindow: config.historyWindow,
    playthroughs: new PlaythroughService(scratch.prisma),
    workOrders,
    mcp,
  };
  const { tracePath } = options;
  const onTrace =
    tracePath === undefined
      ? undefined
      : (trace: TurnTrace) => fs.appendFileSync(tracePath, `${JSON.stringify(trace)}\n`);
  const turns: MeasuredTurn[] = [];
  try {
    for (const scenario of options.scenarios) {
      turns.push(
        ...(await runAll({ options, deps, saves, prisma: scratch.prisma, onTrace }, scenario)),
      );
    }
  } finally {
    await mcp.close();
    await scratch.cleanup();
  }
  printReport(options, turns);
}

function printReport(options: MeasureOptions, turns: MeasuredTurn[]): void {
  const saveHash = createHash('sha256').update(fs.readFileSync(options.savePath)).digest('hex');
  const commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  process.stdout.write(
    [
      `Model: ${options.llm.providerKind}/${options.llm.model}, max tokens ${options.llm.maxTokens}, commit ${commit}`,
      `Save: ${path.basename(options.savePath)} (sha256 ${saveHash.slice(0, 16)})`,
      '',
      renderReportTable(turns),
      '',
      renderToolTable(turns),
      '',
    ].join('\n'),
  );
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
