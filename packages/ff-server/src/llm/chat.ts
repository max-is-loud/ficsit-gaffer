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
  handleLiveStateTool,
  isLiveStateTool,
  liveStateToolDefinitions,
  type LiveStateService,
} from '../tools/liveStateTools.js';
import {
  handleWorkOrderTool,
  isWorkOrderTool,
  workOrderToolDefinitions,
} from '../tools/workOrderTools.js';
import type { LlmProvider } from './provider.js';
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

  const history = await deps.playthroughs.recentMessages(req.playthroughId, deps.historyWindow);
  const messages: NeutralMessage[] = history.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  let streamedText = '';

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const result = await req.provider.runTurn(
      { system, messages, tools, model: req.model, maxTokens: req.maxTokens },
      (event) => {
        if (event.type === 'text') {
          streamedText += event.delta;
          events.text(event.delta);
        }
      },
    );

    messages.push({
      role: 'assistant',
      text: result.text,
      toolCalls: result.toolCalls,
      continuation: result.continuation,
    });

    if (result.stopReason !== 'tool_use') {
      return streamedText;
    }

    for (const call of result.toolCalls) {
      events.toolUse(call.name);
      const outcome = await dispatchTool(req.playthroughId, req.savePath, call, deps, events);
      messages.push({
        role: 'tool',
        toolCallId: call.id,
        content: outcome.text,
        isError: outcome.isError,
      });
    }
  }

  logger.warn(
    `Tool loop hit the ${MAX_TOOL_ITERATIONS}-iteration cap; returning partial response.`,
  );
  return streamedText;
}

/**
 * Merges the MCP game-data tools with the server-local work-order and live tools.
 * The live tool's name is reserved: an MCP tool of the same name is never offered.
 */
async function assembleTools(
  mcp: McpGateway,
  playthroughId: string,
  liveState: LiveStateService | undefined,
): Promise<ToolDefinition[]> {
  const mcpTools = (await mcp.listTools()).filter((tool) => !isLiveStateTool(tool.name));
  return [
    ...mcpTools,
    ...workOrderToolDefinitions(),
    ...liveStateToolDefinitions(playthroughId, liveState),
  ];
}

interface ToolOutcome {
  text: string;
  isError: boolean;
}

/** Routes a tool call to the live, work-order or MCP handler. */
async function dispatchTool(
  playthroughId: string,
  savePath: string | undefined,
  call: NeutralToolCall,
  deps: ChatDeps,
  events: ChatEvents,
): Promise<ToolOutcome> {
  // Local and authority-checked even when unadvertised; never falls through to MCP.
  if (isLiveStateTool(call.name)) {
    return handleLiveStateTool(call.name, playthroughId, call.arguments, deps.liveState);
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
  // savePath is injected into save-game tool calls by the aggregate gateway.
  return deps.mcp.callTool(call.name, call.arguments, { savePath });
}
