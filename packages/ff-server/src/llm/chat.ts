// The server-side chat turn loop: builds the system prompt and windowed history, calls the
// provider, runs the tools it asks for and repeats until the model gives a final answer. Provider
// wire formats live in the adapters.

import type { McpGateway, ToolDefinition } from '../mcp/client.js';
import type { PlaythroughService } from '../services/playthroughService.js';
import type { WorkOrderService } from '../services/workOrderService.js';
import type { WorkOrder } from '../types.js';
import { logger } from '../logger.js';
import { buildSystemPrompt, type PromptContext } from '../anthropic/systemPrompt.js';
import {
  isLiveStateTool,
  liveStateToolDefinitions,
  type LiveStateService,
} from '../tools/liveStateTools.js';
import { isHostInternalTool } from '../tools/hostInternalTools.js';
import { workOrderToolDefinitions } from '../tools/workOrderTools.js';
import type { LlmProvider } from './provider.js';
import { formatTurnMetrics, TurnMetricsRecorder, type TurnMetrics } from './turnMetrics.js';
import { runToolCalls, type ToolOutcome } from './toolRunner.js';
import type { NeutralMessage, NeutralToolCall } from './types.js';

/** Backing services and settings the chat loop needs (provider-agnostic). */
export interface ChatDeps {
  systemPromptTemplate: string;
  historyWindow: number;
  playthroughs: PlaythroughService;
  workOrders: WorkOrderService;
  mcp: McpGateway;
  /** Live Constructor observations; only the bound playthrough may use them. */
  liveState?: LiveStateService;
}

/** A single chat turn to run. The user message is already persisted. */
export interface ChatRequest {
  playthroughId: string;
  /** Persona + pioneer profile + summary substituted into the system prompt. */
  promptContext: PromptContext;
  /** Absolute path of the playthrough's save, injected into save-game tools. */
  savePath?: string;
  /** Context blocks (save snapshot, …) sent after the system prompt on every round. */
  contextBlocks?: string[];
  /** The LLM provider for this request, already built from the effective config. */
  provider: LlmProvider;
  model: string;
  maxTokens: number;
}

/** Sink for streaming events as the turn unfolds. */
export interface ChatEvents {
  text(delta: string): void;
  toolUse(name: string): void;
  workOrder(order: WorkOrder): void;
  /** Called once when the turn ends, with its rounds, tool calls and token usage. */
  metrics?(metrics: TurnMetrics): void;
}

/** Safety bound on tool-use round-trips within a single turn. */
const MAX_TOOL_ITERATIONS = 12;

/**
 * Runs one foreman chat turn against whichever provider the request carries:
 * assembles the windowed history and system prompt, then drives the tool-use
 * loop server-side — streaming text and invoking MCP game-data tools and
 * work-order tools — until the model returns a final answer. Returns the full
 * assistant text for persistence.
 */
export async function runChat(
  req: ChatRequest,
  deps: ChatDeps,
  events: ChatEvents,
): Promise<string> {
  const system = buildSystemPrompt(deps.systemPromptTemplate, req.promptContext);
  const tools = await assembleTools(deps.mcp, req.playthroughId, deps.liveState);

  const messages = await loadHistory(deps, req.playthroughId);

  let streamedText = '';
  const recorder = new TurnMetricsRecorder();
  const finish = (hitIterationCap: boolean): string => {
    const metrics = recorder.finish(hitIterationCap);
    logger.info(formatTurnMetrics(metrics));
    events.metrics?.(metrics);
    return streamedText;
  };

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const result = await req.provider.runTurn(
      {
        system,
        contextBlocks: req.contextBlocks,
        messages,
        tools,
        model: req.model,
        maxTokens: req.maxTokens,
      },
      (event) => {
        if (event.type === 'text') {
          streamedText += event.delta;
          events.text(event.delta);
        }
      },
    );

    recorder.recordRound(result);
    messages.push({
      role: 'assistant',
      text: result.text,
      toolCalls: result.toolCalls,
      continuation: result.continuation,
    });

    if (result.stopReason !== 'tool_use') {
      return finish(false);
    }

    recorder.recordToolCalls(result.toolCalls);
    const outcomes = await runToolCalls(result.toolCalls, {
      playthroughId: req.playthroughId,
      savePath: req.savePath,
      deps,
      events,
    });
    appendToolResults(messages, result.toolCalls, outcomes);
  }

  logger.warn(
    `Tool loop hit the ${MAX_TOOL_ITERATIONS}-iteration cap; returning partial response.`,
  );
  return finish(true);
}

/** The windowed conversation so far, as plain text turns (tool rounds are never persisted). */
async function loadHistory(deps: ChatDeps, playthroughId: string): Promise<NeutralMessage[]> {
  const history = await deps.playthroughs.recentMessages(playthroughId, deps.historyWindow);
  return history.map((message) => ({ role: message.role, content: message.content }));
}

/**
 * Merges the MCP game-data tools with the server-local work-order and live tools.
 * The live tool's name is reserved: an MCP tool of the same name is never offered, and
 * host-internal tools are not offered either.
 */
async function assembleTools(
  mcp: McpGateway,
  playthroughId: string,
  liveState: LiveStateService | undefined,
): Promise<ToolDefinition[]> {
  const mcpTools = (await mcp.listTools()).filter(
    (tool) => !isLiveStateTool(tool.name) && !isHostInternalTool(tool.name),
  );
  return [
    ...mcpTools,
    ...workOrderToolDefinitions(),
    ...liveStateToolDefinitions(playthroughId, liveState),
  ];
}

/** Adds one tool message per call, in call order, so each result matches its call id. */
function appendToolResults(
  messages: NeutralMessage[],
  calls: NeutralToolCall[],
  outcomes: ToolOutcome[],
): void {
  calls.forEach((call, index) => {
    const outcome = outcomes[index] ?? { text: 'Tool produced no result.', isError: true };
    messages.push({
      role: 'tool',
      toolCallId: call.id,
      content: outcome.text,
      isError: outcome.isError,
    });
  });
}
