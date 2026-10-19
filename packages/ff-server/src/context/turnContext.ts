// Assembles what a chat turn needs from the playthrough: the save path the save tools read and the
// context blocks (the save snapshot and the work orders) sent after the system prompt.

import type { AppDeps } from '../deps.js';
import { logger } from '../logger.js';
import {
  buildContextBlocks,
  saveContributor,
  workOrdersContributor,
  type ContextContributor,
} from './contextBlocks.js';

type TurnContextDeps = Pick<AppDeps, 'saves' | 'saveSummaries'> &
  Partial<Pick<AppDeps, 'workOrders'>>;

/** The save path for save-game tools and the context blocks for the provider. */
export interface TurnContext {
  savePath?: string;
  contextBlocks: string[];
}

/** The contributors these deps can serve, in block order. */
function contributors(deps: TurnContextDeps): ContextContributor[] {
  return [
    ...(deps.saveSummaries === undefined ? [] : [saveContributor(deps.saveSummaries)]),
    ...(deps.workOrders === undefined ? [] : [workOrdersContributor(deps.workOrders)]),
  ];
}

/**
 * Resolves the playthrough's current save and builds its context blocks. Without a save, or
 * without a summary cache, there is no snapshot block; the save tools still work. Without work
 * orders (or the service), there is no work-orders block.
 */
export async function buildTurnContext(
  deps: TurnContextDeps,
  playthroughId: string,
): Promise<TurnContext> {
  const currentSave = await deps.saves.getCurrentSave(playthroughId);
  const contextBlocks = await buildContextBlocks(contributors(deps), {
    playthroughId,
    currentSave,
  });
  return currentSave === undefined
    ? { contextBlocks }
    : { savePath: currentSave.path, contextBlocks };
}

/**
 * Builds the current save's summary ahead of the next turn (after an upload or activation).
 * Never throws: a failure is logged and the next turn simply builds it then.
 */
export async function warmSaveSummary(deps: TurnContextDeps, playthroughId: string): Promise<void> {
  try {
    const currentSave = await deps.saves.getCurrentSave(playthroughId);
    if (currentSave !== undefined && deps.saveSummaries !== undefined) {
      await deps.saveSummaries.get(currentSave);
    }
  } catch (error) {
    logger.warn(`Could not prepare the save summary for playthrough '${playthroughId}':`, error);
  }
}
