// Runs one round of the model's tool calls: read-only calls concurrently (bounded), state-changing
// work-order calls one at a time in call order, and every result returned in call order. Routing a
// single call to the live, work-order or MCP handler also lives here.

import { logger } from '../logger.js';
import { isHostInternalTool } from '../tools/hostInternalTools.js';
import { withoutHostManagedArguments } from '../tools/hostManagedArguments.js';
import { handleLiveStateTool, isLiveStateTool } from '../tools/liveStateTools.js';
import { handleWorkOrderTool, isWorkOrderTool } from '../tools/workOrderTools.js';
import type { ChatDeps, ChatEvents } from './chat.js';
import type { NeutralToolCall } from './types.js';

/** Most read-only tool calls in flight at once; keeps a large round from flooding sf-mcp. */
export const MAX_CONCURRENT_TOOL_CALLS = 6;

/**
 * A tool is sequential (state-changing) when any rule matches. Sequential calls never overlap
 * each other and run in call order; add a new state-changing tool family as one entry here.
 */
export const SEQUENTIAL_TOOL_RULES: ((name: string) => boolean)[] = [isWorkOrderTool];

/** What a round's tool calls need: whose turn it is, the save to read, services and events. */
export interface ToolRunContext {
  playthroughId: string;
  /** Absolute path of the playthrough's save, injected into save-game tools. */
  savePath?: string;
  deps: ChatDeps;
  events: ChatEvents;
}

/** The result of one tool call as fed back to the model. */
export interface ToolOutcome {
  text: string;
  isError: boolean;
}

/**
 * Runs a round's calls and returns their outcomes in call order, as both providers require.
 * `toolUse` events fire for every call, in call order, before any runs. The calls in one round
 * were issued together, so none depends on another's result: read-only calls run up to
 * {@link MAX_CONCURRENT_TOOL_CALLS} at a time alongside the sequential chain, and
 * `workOrder` events therefore arrive in call order. A call that throws becomes an error result;
 * the others carry on.
 */
export async function runToolCalls(
  calls: NeutralToolCall[],
  context: ToolRunContext,
): Promise<ToolOutcome[]> {
  calls.forEach((call) => context.events.toolUse(call.name));
  const outcomes: ToolOutcome[] = calls.map(() => ({ text: '', isError: true }));
  const sequential: number[] = [];
  const concurrent: number[] = [];
  calls.forEach((call, index) => {
    const isSequential = SEQUENTIAL_TOOL_RULES.some((rule) => rule(call.name));
    (isSequential ? sequential : concurrent).push(index);
  });
  const runOne = async (index: number): Promise<void> => {
    const call = calls[index];
    if (call !== undefined) {
      outcomes[index] = await safeDispatch(call, context);
    }
  };
  await Promise.all([
    runPool(concurrent, MAX_CONCURRENT_TOOL_CALLS, runOne),
    runPool(sequential, 1, runOne),
  ]);
  return outcomes;
}

/** Runs `task` over `indexes` in order with at most `limit` running at once. */
async function runPool(
  indexes: number[],
  limit: number,
  task: (index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < indexes.length) {
      const index = indexes[next] ?? 0;
      next += 1;
      await task(index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, indexes.length) }, worker));
}

/** Dispatches one call, turning a thrown error into an error result the model can read. */
async function safeDispatch(call: NeutralToolCall, context: ToolRunContext): Promise<ToolOutcome> {
  try {
    return await dispatchTool(call, context);
  } catch (error) {
    logger.error(`Tool ${call.name} failed for playthrough '${context.playthroughId}':`, error);
    const message = error instanceof Error ? error.message : String(error);
    return { text: `Tool ${call.name} failed: ${message}`, isError: true };
  }
}

/** Routes a tool call to the live, work-order or MCP handler; host-internal tools are refused. */
async function dispatchTool(call: NeutralToolCall, context: ToolRunContext): Promise<ToolOutcome> {
  const { deps, events, playthroughId } = context;
  // Local and authority-checked even when unadvertised; never falls through to MCP.
  if (isLiveStateTool(call.name)) {
    return handleLiveStateTool(playthroughId, call.arguments, deps.liveState);
  }
  if (isWorkOrderTool(call.name)) {
    const outcome = await handleWorkOrderTool(playthroughId, call.name, call.arguments, {
      workOrders: deps.workOrders,
      gameVersion: () => deps.mcp.gameVersion,
      mcp: deps.mcp,
    });
    if (outcome.workOrder !== undefined) {
      events.workOrder(outcome.workOrder);
    }
    return { text: outcome.text, isError: outcome.isError };
  }
  // The backend calls these itself; a model that names one gets the unknown-tool answer.
  if (isHostInternalTool(call.name)) {
    return { text: `Tool '${call.name}' is not available.`, isError: true };
  }
  // Remove host-managed arguments from the model's call. The gateway adds the host's savePath.
  return deps.mcp.callTool(call.name, withoutHostManagedArguments(call.arguments), {
    savePath: context.savePath,
  });
}
