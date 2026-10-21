// The chat endpoint: resolves the LLM settings for the request and streams the foreman's reply over
// SSE.

import { Router } from 'express';

import type { AppDeps } from '../deps.js';
import { clientLlmConfig, serverLlmConfig } from '../config.js';
import { buildTurnContext } from '../context/turnContext.js';
import { runChat, type ChatDeps } from '../llm/chat.js';
import type { LlmRuntimeConfig } from '../llm/types.js';
import { logger } from '../logger.js';
import { openSse } from '../sse.js';
import { chatSchema } from '../validation.js';

/**
 * Chat route, mounted under /api/playthroughs/:playthroughId/chat. Streams the
 * foreman's response over SSE while running the tool-use loop server-side. The
 * provider, model, and key are resolved per request: a client that supplies its
 * own key (header) may also override provider/model/base URL (body); otherwise
 * the server's configured defaults and hosted key are used.
 */
export function chatRouter(deps: AppDeps): Router {
  const router = Router({ mergeParams: true });

  const chatDeps: ChatDeps = {
    systemPromptTemplate: deps.systemPromptTemplate,
    historyWindow: deps.config.historyWindow,
    playthroughs: deps.playthroughs,
    workOrders: deps.workOrders,
    mcp: deps.mcp,
    liveState: deps.liveState,
  };

  router.post('/', async (req, res) => {
    const { playthroughId = '' } = req.params as { playthroughId?: string };

    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const playthrough = await deps.playthroughs.get(playthroughId);
    if (playthrough === undefined) {
      res.status(404).json({ error: 'Playthrough not found.' });
      return;
    }
    // The persona lives on the attached foreman; an orphaned reference would be a
    // data-integrity bug (the FK restricts deletion), so treat it as not-found.
    const foreman = await deps.foremen.get(playthrough.foremanId);
    if (foreman === undefined) {
      res.status(404).json({ error: 'Foreman not found.' });
      return;
    }

    // A client key (header) unlocks its own provider/model/base-URL override, and
    // — being BYOK — its own conversation history window. Without a key, fall back
    // entirely to the server's configured defaults (the hosted plan's window too).
    const headerKey = req.header(deps.config.clientKeyHeader)?.trim();
    let llm: LlmRuntimeConfig;
    let historyWindow = deps.config.historyWindow;
    if (headerKey !== undefined && headerKey.length > 0) {
      llm = clientLlmConfig(
        deps.config,
        { provider: parsed.data.provider, model: parsed.data.model, baseUrl: parsed.data.baseUrl },
        headerKey,
      );
      historyWindow = parsed.data.historyWindow ?? deps.config.historyWindow;
    } else if (deps.config.hostedApiKey !== undefined) {
      llm = serverLlmConfig(deps.config, deps.config.hostedApiKey);
    } else {
      res.status(400).json({
        error: `No LLM API key. Supply one via the '${deps.config.clientKeyHeader}' header, or configure a server key (LLM_API_KEY).`,
      });
      return;
    }

    // Persist the user turn before building history, so it is included in the
    // windowed context sent to the model.
    await deps.playthroughs.appendMessage(playthroughId, 'user', parsed.data.message);

    // The current save feeds the save tools (path) and the save snapshot block.
    const { savePath, contextBlocks } = await buildTurnContext(deps, playthroughId);

    const sse = openSse(res);
    try {
      const provider = deps.llmProviderFactory(llm);
      const finalText = await runChat(
        {
          playthroughId,
          promptContext: {
            personality: foreman.personality,
            pioneerProfile: playthrough.pioneerProfile,
            summary: playthrough.summary,
          },
          savePath,
          contextBlocks,
          provider,
          model: llm.model,
          maxTokens: llm.maxTokens,
        },
        // Per-request window: a BYOK caller may widen/narrow their own history.
        { ...chatDeps, historyWindow },
        {
          text: (delta) => sse.send('text', { delta }),
          toolUse: (name) => sse.send('tool_use', { name }),
          workOrder: (order) => sse.send('work_order', order),
        },
      );
      if (finalText.length > 0) {
        await deps.playthroughs.appendMessage(playthroughId, 'assistant', finalText);
      }
      sse.send('done', { ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Chat turn failed for playthrough '${playthroughId}':`, error);
      sse.send('error', { message });
    } finally {
      sse.close();
    }

    // Refresh the running summary in the background, on the same provider/config
    // and the same effective window, so summarisation tracks the BYOK override.
    void deps.summary.summariseIfNeeded(playthroughId, llm, historyWindow);
  });

  return router;
}
