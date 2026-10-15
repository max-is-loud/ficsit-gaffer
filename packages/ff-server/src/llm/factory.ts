// Maps a resolved LLM runtime config to the matching provider adapter.

import { AnthropicProvider } from './anthropic.js';
import { OpenAiCompatibleProvider } from './openai.js';
import type { LlmProvider, LlmProviderFactory } from './provider.js';
import type { LlmRuntimeConfig } from './types.js';

/** Builds the provider for a resolved runtime config. */
export const createProvider: LlmProviderFactory = (config: LlmRuntimeConfig): LlmProvider => {
  if (config.providerKind === 'openai') {
    return new OpenAiCompatibleProvider(config.apiKey, config.baseUrl);
  }
  return new AnthropicProvider(config.apiKey, config.baseUrl);
};
