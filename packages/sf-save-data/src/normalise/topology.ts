// Extracts factory connectivity from a save: buildable actors, conveyor and pipe links, power
// circuits and smart-splitter sort rules. Edge ordering and de-duplication are fixed here so the
// output is deterministic.

import {
  BUILDABLE_ACTOR,
  CIRCUIT_COMPONENTS_PROP,
  CIRCUIT_ID_PROP,
  CONNECTED_COMPONENT_PROP,
  FACTORY_CONNECTION_COMPONENT,
  FILTER_RULE_ANY,
  FILTER_RULE_ANY_UNDEFINED,
  FILTER_RULE_NONE,
  FILTER_RULE_OVERFLOW,
  PIPE_CONNECTION_COMPONENT,
  PIPE_NETWORK_ID_PROP,
  POWER_CIRCUIT,
  PROGRAMMABLE_SPLITTER,
  SMART_SPLITTER,
  SORT_RULE_ITEM_CLASS_PROP,
  SORT_RULE_OUTPUT_INDEX_PROP,
  SORT_RULES_PROP,
} from '../constants.js';
import type { RawObject } from '../parser/types.js';
import { classNameFromPath } from './classRef.js';
import type {
  BuildableActor,
  ConnectionEdge,
  EdgeKind,
  PowerCircuit,
  SplitterConfig,
  SplitterRule,
  SplitterRuleKind,
  TopologyState,
} from './types.js';
import {
  arrayField,
  asString,
  dig,
  entryProps,
  numberField,
  propMap,
  refField,
  translation,
  type Warnings,
} from './util.js';

/** The owner actor's instance name of a component path — i.e. drop the trailing `.<connector>`. */
export function ownerOf(componentPath: string): string {
  const dot = componentPath.lastIndexOf('.');
  return dot < 0 ? componentPath : componentPath.slice(0, dot);
}

/** Maps a rule's filter-class tail to its category; a concrete item descriptor is `item`. */
function ruleKind(filterClass: string): SplitterRuleKind {
  switch (filterClass) {
    case FILTER_RULE_NONE:
      return 'none';
    case FILTER_RULE_ANY:
      return 'any';
    case FILTER_RULE_ANY_UNDEFINED:
      return 'anyUndefined';
    case FILTER_RULE_OVERFLOW:
      return 'overflow';
    default:
      return 'item';
  }
}

/**
 * Decodes a smart/programmable splitter's `mSortRules` into routing rules. Each
 * `SplitterSortRule` struct carries an `ItemClass` ref (a `FilteringRules` class or a
 * real item descriptor) and an `OutputIndex`. Malformed entries are skipped and
 * counted (returned in `malformed`) rather than throwing.
 */
function decodeSortRules(obj: RawObject): { rules: SplitterRule[]; malformed: number } {
  const rules: SplitterRule[] = [];
  let malformed = 0;
  for (const entry of arrayField(propMap(obj), SORT_RULES_PROP)) {
    const props = entryProps(entry);
    const outputIndex = numberField(props, SORT_RULE_OUTPUT_INDEX_PROP);
    const itemPath = refField(props, SORT_RULE_ITEM_CLASS_PROP);
    if (outputIndex === undefined || itemPath === undefined) {
      malformed++;
      continue;
    }
    const filterClass = classNameFromPath(itemPath);
    const kind = ruleKind(filterClass);
    rules.push({
      outputIndex,
      rule: kind,
      ...(kind === 'item' ? { itemClass: filterClass } : {}),
    });
  }
  return { rules, malformed };
}

/**
 * Extracts the factory's connectivity from the parsed objects: every buildable
 * actor (the complete node set), the conveyor/pipe links between them, and the
 * pre-grouped power circuits. This is the relational fact layer of `SaveState`;
 * the connection graph (`@foreman/sf-save-data-graph`) is a pure projection of it.
 *
 * Canonical edge ordering and symmetric-pair dedup live here (not in the graph) so
 * the edge list is deterministic — two semantically-equal saves yield the same
 * array. Never throws: unresolved references are counted and summarised in
 * `warnings`, mirroring the other normalisers.
 */
export function extractTopology(objects: RawObject[], warnings: Warnings): TopologyState {
  // 1. Buildable actors → the complete node set (machines, belts, splitters, poles, …).
  //    Smart/programmable splitters additionally carry conditional routing rules, decoded
  //    here in the same pass (their class key is already to hand).
  const buildables: BuildableActor[] = [];
  const actorNames = new Set<string>();
  const splitters: SplitterConfig[] = [];
  let malformedSortRules = 0;
  for (const obj of objects) {
    const instanceName = obj.instanceName;
    const typePath = obj.typePath;
    if (instanceName === undefined || typePath === undefined) {
      continue;
    }
    const classKey = classNameFromPath(typePath);
    if (BUILDABLE_ACTOR.test(classKey)) {
      actorNames.add(instanceName);
      buildables.push({ instanceName, classKey, location: translation(obj) });
      if (SMART_SPLITTER.test(classKey) || PROGRAMMABLE_SPLITTER.test(classKey)) {
        const { rules, malformed } = decodeSortRules(obj);
        malformedSortRules += malformed;
        splitters.push({ instanceName, classKey, rules });
      }
    }
  }

  // 2. Resolve conveyor + pipe links from their connection components.
  const edges: ConnectionEdge[] = [];
  const seen = new Set<string>();
  let unresolvedConveyor = 0;
  let unresolvedPipe = 0;

  for (const obj of objects) {
    const typePath = obj.typePath;
    const thisPath = obj.instanceName;
    if (typePath === undefined || thisPath === undefined) {
      continue;
    }
    const isConveyor = FACTORY_CONNECTION_COMPONENT.test(typePath);
    const isPipe = !isConveyor && PIPE_CONNECTION_COMPONENT.test(typePath);
    if (!isConveyor && !isPipe) {
      continue;
    }
    const bag = propMap(obj);
    const connectedPath = refField(bag, CONNECTED_COMPONENT_PROP);
    if (connectedPath === undefined) {
      continue; // An unconnected connector — common and not an error.
    }
    const kind: EdgeKind = isConveyor ? 'conveyor' : 'pipe';

    // Dedup the symmetric pair (each connector declares the same physical link).
    const key =
      thisPath < connectedPath ? `${thisPath}|${connectedPath}` : `${connectedPath}|${thisPath}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const fromOwner = ownerOf(thisPath);
    const toOwner = ownerOf(connectedPath);
    if (!actorNames.has(toOwner)) {
      if (isConveyor) {
        unresolvedConveyor++;
      } else {
        unresolvedPipe++;
      }
    }
    // Canonical ordering so `from`/`to` are stable regardless of which connector we saw first.
    const flip = thisPath > connectedPath;
    edges.push({
      kind,
      from: flip ? toOwner : fromOwner,
      to: flip ? fromOwner : toOwner,
      fromConnector: classNameFromPath(flip ? connectedPath : thisPath),
      toConnector: classNameFromPath(flip ? thisPath : connectedPath),
      ...(isPipe ? { networkId: numberField(bag, PIPE_NETWORK_ID_PROP) } : {}),
    });
  }

  // 3. Power circuits are pre-grouped by the game — read membership directly.
  const powerCircuits: PowerCircuit[] = [];
  let unresolvedCircuitMembers = 0;
  for (const obj of objects) {
    if (obj.typePath === undefined || !POWER_CIRCUIT.test(obj.typePath)) {
      continue;
    }
    const bag = propMap(obj);
    const circuitId = numberField(bag, CIRCUIT_ID_PROP);
    if (circuitId === undefined) {
      continue;
    }
    const members = new Set<string>();
    for (const entry of arrayField(bag, CIRCUIT_COMPONENTS_PROP)) {
      const memberPath = asString(dig(entry, 'pathName'));
      if (memberPath === undefined) {
        continue;
      }
      const owner = ownerOf(memberPath);
      if (!actorNames.has(owner)) {
        unresolvedCircuitMembers++;
      }
      members.add(owner);
    }
    powerCircuits.push({ circuitId, members: [...members] });
  }

  if (unresolvedConveyor > 0) {
    warnings.add(`${unresolvedConveyor} conveyor connection(s) referenced an unknown owner actor.`);
  }
  if (unresolvedPipe > 0) {
    warnings.add(`${unresolvedPipe} pipe connection(s) referenced an unknown owner actor.`);
  }
  if (unresolvedCircuitMembers > 0) {
    warnings.add(
      `${unresolvedCircuitMembers} power-circuit member(s) referenced an unknown owner actor.`,
    );
  }
  if (malformedSortRules > 0) {
    warnings.add(`${malformedSortRules} splitter sort-rule(s) had an unreadable shape.`);
  }

  return { buildables, edges, powerCircuits, splitters };
}
