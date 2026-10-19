// Renders a save summary as the compact text block placed after the system prompt. Output must be
// byte-stable for the same summary — the block sits in a cached prompt prefix — so it uses only
// absolute UTC times and fixed number formats, never "now"-relative wording.

import type { SaveSummary } from './saveSummarySchema.js';

/** `2026-10-16T04:58:40.112Z` → `2026-10-16 04:58 UTC`. */
function utcMinute(iso: string): string {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

function playTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

const point = (vec: { x: number; y: number; z: number }): string =>
  `(${vec.x}, ${vec.y}, ${vec.z}) m`;

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

function heading(summary: SaveSummary, uploadedAt: Date): string {
  const saved = summary.save.savedAt;
  const uploaded = `uploaded ${utcMinute(uploadedAt.toISOString())}`;
  const when = saved === undefined ? uploaded : `saved in-game ${utcMinute(saved)}, ${uploaded}`;
  return `## Save snapshot — ${when} (not live)`;
}

function identity({ save }: SaveSummary): string {
  const time =
    save.playDurationSeconds === undefined
      ? ''
      : `, play time ${playTime(save.playDurationSeconds)}`;
  const version = save.version.startsWith('build') ? save.version : `version ${save.version}`;
  const suffix = time === '' ? '.' : `${time}. Figures are as of that save.`;
  return `Save "${save.saveName}", ${version}${suffix}`;
}

function position({ player }: SaveSummary): string | undefined {
  if (player.position === undefined) {
    return undefined;
  }
  let place = '';
  if (player.biome !== undefined) {
    place =
      player.within === undefined
        ? `, in ${player.biome}`
        : `, in the ${player.within} of ${player.biome}`;
  }
  const hub = player.hub === undefined ? '' : ` HUB: ${point(player.hub)}.`;
  return `- Position: ${point(player.position)}${place}.${hub}`;
}

/** ` (needs 50 Smart Plating; unlocks tier 4)`, or nothing without phase costs. */
function spaceElevatorGoal(view: SaveSummary['progress']): string {
  if (view.spaceElevatorCost === undefined || view.spaceElevatorCost.length === 0) {
    return '';
  }
  const cost = view.spaceElevatorCost.map((entry) => `${entry.amount} ${entry.item}`).join(', ');
  const tier =
    view.spaceElevatorUnlocksTier === undefined
      ? ''
      : `; unlocks tier ${view.spaceElevatorUnlocksTier}`;
  return ` (needs ${cost}${tier})`;
}

function progress({ progress: view }: SaveSummary): string {
  if (view.highestTier === 0 && view.tierMilestones.length === 0) {
    return '- Progress: no milestones purchased yet.';
  }
  const parts = [`tier ${view.highestTier} (milestones ${view.tierMilestones.join(', ')})`];
  if (view.spaceElevatorPhase !== undefined) {
    parts.push(`Space Elevator phase ${view.spaceElevatorPhase}${spaceElevatorGoal(view)}`);
  }
  if (view.mamTrees.length > 0) {
    parts.push(`MAM trees: ${view.mamTrees.join(', ')}`);
  }
  return `- Progress: ${parts.join('; ')}.`;
}

function recipes({ recipes: view }: SaveSummary): string {
  const more = view.alternatesOmitted > 0 ? `, +${view.alternatesOmitted} more` : '';
  const names = view.alternates.length > 0 ? `: ${view.alternates.join(', ')}${more}` : '';
  return `- Recipes: ${view.standardCount} standard, ${plural(view.alternateCount, 'alternate')}${names}.`;
}

/** `A, B, +3 more`; undefined for an empty list. */
function nameList(names: string[], omitted: number): string | undefined {
  if (names.length === 0) {
    return undefined;
  }
  return `${names.join(', ')}${omitted > 0 ? `, +${omitted} more` : ''}`;
}

function buildings({ unlocks }: SaveSummary): string | undefined {
  const names = unlocks && nameList(unlocks.buildings, unlocks.buildingsOmitted);
  return names === undefined ? undefined : `- Buildings unlocked (exact names): ${names}.`;
}

function partRecipes({ unlocks }: SaveSummary): string | undefined {
  const names = unlocks && nameList(unlocks.partRecipes, unlocks.partRecipesOmitted);
  return names === undefined ? undefined : `- Standard part recipes unlocked: ${names}.`;
}

function power({ power: view }: SaveSummary): string | undefined {
  if (view.circuits === 0 && view.generators.length === 0) {
    return undefined;
  }
  const generators = view.generators
    .map((generator) => `${generator.count} × ${generator.type} (${generator.mw} MW)`)
    .join(', ');
  return (
    `- Power: ${view.capacityMw} MW capacity, ${view.consumptionMw} MW draw, ` +
    `${view.headroomMw} MW headroom; ${plural(view.circuits, 'circuit')}, ` +
    `${view.overloadedCircuits} overloaded.${generators === '' ? '' : ` Generators: ${generators}.`}`
  );
}

function production({ production: items }: SaveSummary): string | undefined {
  if (items.length === 0) {
    return undefined;
  }
  const entries = items.map(
    (entry) =>
      `${entry.item} ${entry.perMinute}${entry.unit === undefined ? '' : ` ${entry.unit}`} (${entry.machines})`,
  );
  return `- Production, configured per minute (machines): ${entries.join(', ')}.`;
}

function storage({ storage: items }: SaveSummary): string | undefined {
  if (items.length === 0) {
    return undefined;
  }
  const entries = items.map((entry) => `${entry.item} ${entry.quantity}`);
  return `- Storage, containers and depot: ${entries.join(', ')}.`;
}

function resources({ nearbyResources: nodes }: SaveSummary): string | undefined {
  if (nodes.length === 0) {
    return undefined;
  }
  const entries = nodes.map((node) => {
    const purity = node.purity === null ? '' : ` ${node.purity}`;
    const biome = node.biome === null ? '' : ` (${node.biome})`;
    return `${node.resource}${purity} ${node.distanceMetres} m ${node.bearing}${biome}`;
  });
  return `- Nearest resource node of each type (existing miners not checked): ${entries.join(', ')}.`;
}

/** Body lines in order; a renderer returning undefined omits its line (code standard 5). */
const LINES: ((summary: SaveSummary) => string | undefined)[] = [
  identity,
  position,
  progress,
  recipes,
  buildings,
  partRecipes,
  power,
  production,
  storage,
  resources,
];

/**
 * The save snapshot block: a heading naming the save and upload times, one line per section,
 * and a pointer to the save tools. Deterministic for the same `summary` and `uploadedAt`.
 */
export function renderSaveSummary(summary: SaveSummary, uploadedAt: Date): string {
  const body = LINES.map((line) => line(summary)).filter((line) => line !== undefined);
  return [
    heading(summary, uploadedAt),
    '',
    ...body,
    '',
    'For anything not listed here, or more detail, use the save tools.',
  ].join('\n');
}
