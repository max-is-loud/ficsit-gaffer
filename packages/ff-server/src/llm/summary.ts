// Keeps each playthrough's running summary up to date in the background so context survives beyond
// the chat history window.

import type { PlaythroughService } from '../services/playthroughService.js';
import type { ChatMessage } from '../types.js';
import { logger } from '../logger.js';
import { createProvider } from './factory.js';
import type { LlmProvider, LlmProviderFactory } from './provider.js';
import type { LlmRuntimeConfig } from './types.js';

/** The summariser's instruction — kept verbatim per the Phase 2 spec. */
const SUMMARY_INSTRUCTION =
  'Summarise this Satisfactory factory session concisely: what was built, what decisions ' +
  'were made, what did the pioneer say they enjoyed or disliked. Max 200 words. Plain text, ' +
  'no headings.';

/** Settings the summariser depends on. */
export interface SummaryConfig {
  historyWindow: number;
}

/**
 * Maintains a playthrough's running summary so context survives beyond the
 * history window. Provider-agnostic: it builds a provider from the same runtime
 * config the chat turn used, so summaries run on the player's chosen provider
 * with that provider's cheaper summary model.
 */
export class SummaryService {
  private readonly inFlight = new Set<string>();

  public constructor(
    private readonly playthroughs: PlaythroughService,
    private readonly config: SummaryConfig,
    private readonly providerFactory: LlmProviderFactory = createProvider,
  ) {}

  /**
   * True once the message count has rolled past the window at least once. The
   * window defaults to the server config but a BYOK request may pass its own.
   */
  public shouldSummarise(messageCount: number, window = this.config.historyWindow): boolean {
    return messageCount > window * 2;
  }

  /**
   * Fire-and-forget entry point: if the playthrough has grown past the
   * threshold, regenerate and store its summary using the request's
   * provider/config. The `historyWindow` (the request's effective window —
   * server default unless a BYOK caller overrode it) governs both the threshold
   * and which messages count as "older than the window". Never throws — failures
   * are logged so a background summarisation can never crash the request that
   * scheduled it.
   */
  public async summariseIfNeeded(
    playthroughId: string,
    llm: LlmRuntimeConfig,
    historyWindow = this.config.historyWindow,
  ): Promise<void> {
    if (this.inFlight.has(playthroughId)) {
      return;
    }
    try {
      const count = await this.playthroughs.countMessages(playthroughId);
      if (!this.shouldSummarise(count, historyWindow)) {
        return;
      }
      this.inFlight.add(playthroughId);
      const playthrough = await this.playthroughs.get(playthroughId);
      if (playthrough === undefined) {
        return;
      }
      const older = await this.playthroughs.messagesBeforeWindow(playthroughId, historyWindow);
      if (older.length === 0) {
        return;
      }
      const provider = this.providerFactory(llm);
      const summary = await this.summarise(provider, llm, older, playthrough.summary);
      if (summary.length > 0) {
        await this.playthroughs.updateSummary(playthroughId, summary);
        logger.info(
          `Updated running summary for playthrough '${playthroughId}' (${summary.length} chars).`,
        );
      }
    } catch (error) {
      logger.error(`Background summarisation failed for playthrough '${playthroughId}':`, error);
    } finally {
      this.inFlight.delete(playthroughId);
    }
  }

  /**
   * Produces a fresh summary by folding the given messages into the prior
   * summary with a single non-streaming completion. Exposed for testing.
   */
  public async summarise(
    provider: LlmProvider,
    llm: LlmRuntimeConfig,
    messages: ChatMessage[],
    priorSummary?: string,
  ): Promise<string> {
    const transcript = messages
      .map((message) => `${message.role === 'user' ? 'Pioneer' : 'Foreman'}: ${message.content}`)
      .join('\n');
    const prior = priorSummary?.trim();
    const priorBlock =
      prior !== undefined && prior.length > 0 ? `Summary so far:\n${prior}\n\n` : '';
    return provider.complete({
      system: SUMMARY_INSTRUCTION,
      userText: `${priorBlock}Conversation to summarise:\n${transcript}`,
      model: llm.summaryModel,
      maxTokens: llm.summaryMaxTokens,
    });
  }
}
