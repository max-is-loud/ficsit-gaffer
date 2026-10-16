// The per-turn context blocks placed after the system prompt, each from one source. Today only the
// save snapshot; a live-readings contributor (bridge v2) is added as one more table entry.

import type { CurrentSave, SaveSummaryCache } from './saveSummaryCache.js';

/** What a contributor may read to build its block. */
export interface ContextRequest {
  playthroughId: string;
  currentSave?: CurrentSave;
}

/**
 * One source of context. Blocks keep their sources apart — a later block (e.g. live readings)
 * states which earlier figures it supersedes — so a stable block stays byte-identical and cached.
 */
export interface ContextContributor {
  source: 'save' | 'live';
  build(request: ContextRequest): Promise<string | undefined>;
}

/** Builds every contributor's block, in table order, skipping those with nothing to say. */
export async function buildContextBlocks(
  contributors: ContextContributor[],
  request: ContextRequest,
): Promise<string[]> {
  const blocks = await Promise.all(contributors.map((contributor) => contributor.build(request)));
  return blocks.filter((block): block is string => block !== undefined);
}

/** The save snapshot, from the cache; nothing when the playthrough has no save. */
export function saveContributor(cache: SaveSummaryCache): ContextContributor {
  return {
    source: 'save',
    build: async (request) =>
      request.currentSave === undefined ? undefined : cache.get(request.currentSave),
  };
}
