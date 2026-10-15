// Declares AppDeps, the bundle of services and settings that startup hands to the Express app and
// its routers.

import type { Auth } from './auth.js';
import type { ServerConfig } from './config.js';
import type { LlmProviderFactory } from './llm/provider.js';
import type { SummaryService } from './llm/summary.js';
import type { McpGateway } from './mcp/client.js';
import type { ForemanService } from './services/foremanService.js';
import type { PlaythroughService } from './services/playthroughService.js';
import type { SaveService } from './services/saveService.js';
import type { WorkOrderService } from './services/workOrderService.js';
import type { LiveStateService } from './tools/liveStateTools.js';

/** Everything the HTTP layer needs, assembled once at startup. */
export interface AppDeps {
  config: ServerConfig;
  /** The Better Auth instance (owns /api/auth/* and session resolution). */
  auth: Auth;
  foremen: ForemanService;
  playthroughs: PlaythroughService;
  saves: SaveService;
  workOrders: WorkOrderService;
  mcp: McpGateway;
  /** Maintains each playthrough's running summary in the background. */
  summary: SummaryService;
  /** Builds an LLM provider from a resolved per-request runtime config. */
  llmProviderFactory: LlmProviderFactory;
  /** The foreman system prompt template (placeholders not yet substituted). */
  systemPromptTemplate: string;
  /** Live Constructor observations for the one bound playthrough; absent when disabled. */
  liveState?: LiveStateService;
}
