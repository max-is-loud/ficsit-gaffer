// Extracts progression from a save: purchased milestones, MAM research unlocks and the space
// elevator assembly phase.

import {
  CURRENT_PHASE_PROP,
  GAME_PHASE_MANAGER,
  GAME_PHASE_NUMBER,
  MAM_SCHEMATIC,
  PURCHASED_SCHEMATICS_PROP,
  RESEARCH_MANAGER,
  SCHEMATIC_MANAGER,
  SCHEMATIC_TIER,
  TARGET_PHASE_PROP,
  TUTORIAL_SCHEMATIC,
  UNLOCKED_RESEARCH_PROP,
} from '../constants.js';
import type { RawObject } from '../parser/types.js';
import { classNameFromPath } from './classRef.js';
import type { AssemblyPhase, Milestone, MilestoneKind } from './types.js';
import { arrayField, asNumber, asString, dig, propMap, refField, type Warnings } from './util.js';

export interface ProgressionResult {
  milestones: Milestone[];
  mamResearch: string[];
  assemblyPhase?: AssemblyPhase;
}

/** Extracts purchased milestones, MAM research unlocks, and the assembly phase. */
export function extractProgression(objects: RawObject[], warnings: Warnings): ProgressionResult {
  return {
    milestones: extractMilestones(objects, warnings),
    mamResearch: extractMamResearch(objects),
    assemblyPhase: extractAssemblyPhase(objects),
  };
}

function extractMilestones(objects: RawObject[], warnings: Warnings): Milestone[] {
  const manager = objects.find((o) => SCHEMATIC_MANAGER.test(o.typePath ?? ''));
  if (manager === undefined) {
    warnings.add('No schematic manager (BP_SchematicManager) found in save.');
    return [];
  }
  const milestones: Milestone[] = [];
  const seen = new Set<string>();
  for (const ref of arrayField(propMap(manager), PURCHASED_SCHEMATICS_PROP)) {
    const path = asString(dig(ref, 'pathName'));
    if (path === undefined || path.length === 0) {
      continue;
    }
    const schematicClass = classNameFromPath(path);
    if (seen.has(schematicClass)) {
      continue;
    }
    seen.add(schematicClass);
    const tierMatch = SCHEMATIC_TIER.exec(schematicClass);
    const tier =
      tierMatch?.[1] === undefined ? undefined : asNumber(Number.parseInt(tierMatch[1], 10));
    milestones.push({
      schematicClass,
      tier,
      kind: classifyMilestone(path, schematicClass, tier),
    });
  }
  milestones.sort(
    (a, b) => (a.tier ?? 99) - (b.tier ?? 99) || a.schematicClass.localeCompare(b.schematicClass),
  );
  return milestones;
}

function classifyMilestone(
  path: string,
  schematicClass: string,
  tier: number | undefined,
): MilestoneKind {
  if (TUTORIAL_SCHEMATIC.test(schematicClass)) {
    return 'tutorial';
  }
  if (tier !== undefined && !MAM_SCHEMATIC.test(path)) {
    return 'milestone';
  }
  return 'other';
}

/**
 * The unlocked MAM research *trees* (the save's `mUnlockedResearchTrees`), e.g.
 * the categories the pioneer can research in, NOT the individual completed nodes —
 * as raw class names (e.g. `BPD_ResearchTree_AlienOrganisms_C`). Humanising and
 * trimming the "Research Tree" prefix to a readable name is the edge's job
 * (presentation boundary).
 */
function extractMamResearch(objects: RawObject[]): string[] {
  const manager = objects.find((o) => RESEARCH_MANAGER.test(o.typePath ?? ''));
  if (manager === undefined) {
    return [];
  }
  const classes = new Set<string>();
  for (const ref of arrayField(propMap(manager), UNLOCKED_RESEARCH_PROP)) {
    const path = asString(dig(ref, 'pathName'));
    if (path !== undefined && path.length > 0) {
      classes.add(classNameFromPath(path));
    }
  }
  return [...classes].sort((a, b) => a.localeCompare(b));
}

function extractAssemblyPhase(objects: RawObject[]): AssemblyPhase | undefined {
  const manager = objects.find((o) => GAME_PHASE_MANAGER.test(o.typePath ?? ''));
  if (manager === undefined) {
    return undefined;
  }
  const bag = propMap(manager);
  const currentRef = refField(bag, CURRENT_PHASE_PROP);
  const targetRef = refField(bag, TARGET_PHASE_PROP);
  const current = currentRef === undefined ? undefined : classNameFromPath(currentRef);
  const phaseMatch = current === undefined ? null : GAME_PHASE_NUMBER.exec(current);
  return {
    phase: phaseMatch?.[1] === undefined ? undefined : asNumber(Number.parseInt(phaseMatch[1], 10)),
    current,
    target: targetRef === undefined ? undefined : classNameFromPath(targetRef),
  };
}
