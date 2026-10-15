// Backs find_bottlenecks: builds a flow network from the save graph (belts, pipes, splitter sort-rules, fluid head lift),
// solves it with sf-flow, and classifies each producer as starved, unpowered, idle or unknown.

import { solveFlow, type FlowEdge, type FlowNetwork, type FlowNode } from '@foreman/sf-flow';
import type { WorldLocations } from '@foreman/sf-game-data';
import type { SaveGraph } from '@foreman/sf-save-data-graph';
import type { SaveState, SplitterRule } from '@foreman/sf-save-data';
import { cmToMetres, humaniseClassName } from '@foreman/sf-present';

import type { GameDataIndex } from '../gameData.js';
import { getEffectiveGameData, type EffectiveGameData } from './effectiveGameData.js';
import { powerView, resolveExtraction } from './selectors.js';

export type BottleneckVerdict = 'starved' | 'unpowered' | 'idle' | 'unknown';

export interface BottleneckEntry {
  instanceName: string;
  building: string;
  recipe?: string;
  location?: { x: number; y: number; z: number };
  verdict: BottleneckVerdict;
  /** A one-line, model-facing cause (e.g. "starved of Iron Ore: only 15/30 per min"). */
  detail: string;
}

export interface BottlenecksView {
  /** The tolerance band applied (a deficit within ±tolerance is treated as ok). */
  tolerance: number;
  producerCount: number;
  /** Counts by verdict, including the implicit `ok`. */
  summary: Record<BottleneckVerdict | 'ok', number>;
  /** The non-ok producers (capped at `limit`); each carries its verdict + cause. */
  bottlenecks: BottleneckEntry[];
  /** Set when the list was capped. */
  truncated?: number;
  note: string;
}

const NOTE =
  'Steady-state feed reconciliation: distributes each source’s output through belts/pipes ' +
  '(throughput-capped) and splitters/mergers to every machine input — honouring smart/' +
  'programmable splitter sort-rules (item filters, any, overflow, any-undefined) — then flags ' +
  'a producer starved when a belt input is delivered below its required rate (beyond tolerance). ' +
  'Fluid (pipe) inputs are reconciled over the connected pipe network instead — starved if the ' +
  'network has no source of the fluid, the machine sits above the network’s shared head lift, or ' +
  'the network’s total supply of that fluid is short of its total reachable demand (a whole-' +
  'component balance; per-leg pipe throughput is not modelled). Does not yet apply 1.2 recipe/' +
  'power modifiers (#172). Ambiguous belt flow (looping/unresolved) → unknown, never a false starved.';

/**
 * Maximum head lift (metres — the height at which flow stops) for the infrastructure that
 * re-pressurises or stores fluid: pumps push, buffers hold and re-share. These provide head lift
 * to a connected pipe network regardless of which way fluid flows through them. Values from the
 * Satisfactory wiki's head-lift table (max column).
 */
const INFRASTRUCTURE_HEAD_LIFT: Record<string, number> = {
  Build_PipelinePump_C: 23,
  Build_PipelinePumpMk2_C: 57,
  Build_PipeStorageTank_C: 8, // Fluid Buffer — a filled buffer shares head lift even at zero flow
  Build_IndustrialTank_C: 12, // Industrial Fluid Buffer
};
/** Max head lift (metres) of a building that *outputs* fluid (extractor / refinery / blender / …). */
const FLUID_OUTPUT_HEAD_LIFT = 13;
/**
 * Buildings that can supply *any* fluid to a network without appearing as a producer/extractor —
 * a filled buffer (water-tower) or a train fluid platform. Treated as a wildcard fluid source so
 * the feed check never falsely starves a consumer fed from one.
 */
const WILDCARD_FLUID_SOURCE = new Set([
  'Build_PipeStorageTank_C',
  'Build_IndustrialTank_C',
  'Build_TrainDockingStationLiquid_C',
]);

const capOf = (graph: SaveGraph, eff: EffectiveGameData, id: string): number => {
  const node = graph.getActor(id);
  if (node === undefined) {
    return Infinity;
  }
  return Math.min(eff.conveyorCapacity(node.classKey), eff.pipeCapacity(node.classKey));
};

/**
 * The flow-edge filter for one smart/programmable splitter output, from its `mSortRules`.
 * Rules for the same output combine: `any` (Wildcard) → unrestricted; `anyUndefined` →
 * unrestricted minus the items an item-rule routes to a *sibling* output (a `deny` list);
 * `item` rules → an `allow` list; `none` → carries nothing; `overflow` → an overflow output.
 */
function outputFilter(
  rules: SplitterRule[],
  outputIndex: number,
): { allow?: string[]; deny?: string[]; overflow?: boolean } {
  const own = rules.filter((r) => r.outputIndex === outputIndex);
  if (own.length === 0) {
    return {}; // no rule configured for this output — carries anything
  }
  const overflow = own.some((r) => r.rule === 'overflow') ? { overflow: true } : {};
  const items = own.flatMap((r) =>
    r.rule === 'item' && r.itemClass !== undefined ? [r.itemClass] : [],
  );
  if (own.some((r) => r.rule === 'any')) {
    return { ...overflow };
  }
  if (own.some((r) => r.rule === 'anyUndefined')) {
    const deny = rules
      .filter(
        (r) => r.outputIndex !== outputIndex && r.rule === 'item' && r.itemClass !== undefined,
      )
      .map((r) => r.itemClass as string)
      .filter((it) => !items.includes(it));
    return { ...(deny.length > 0 ? { deny: [...new Set(deny)] } : {}), ...overflow };
  }
  if (items.length > 0) {
    return { allow: [...new Set(items)], ...overflow };
  }
  if ('overflow' in overflow) {
    return overflow; // overflow-only output: any item, but only as spillover
  }
  return { allow: [] }; // `none`
}

/** Tolerance (metres) for height comparisons — absorbs cm→m noise without missing real lift gaps. */
const HEAD_LIFT_EPS = 1;

/** Direction-independent reachability of fluids over the connected pipe network. */
export interface PipeNetworkAnalysis {
  /** Whether `id` is connected to any pipe. */
  inNetwork(id: string): boolean;
  /**
   * The maximum height (metres) fluid can reach in `id`'s connected pipe network — `max(elevation
   * + max head lift)` over its head-lift providers (pumps, buffers, and fluid-OUTPUTTING buildings;
   * a fluid *consumer* does not credit its own head lift). `undefined` if not on a pipe network or
   * the network has no provider.
   */
  maxReachableHeight(id: string): number | undefined;
  /** Whether `id`'s pipe network can supply fluid item `itemClass` (a producing source, or a wildcard buffer/freight). */
  hasFluidSource(id: string, itemClass: string): boolean;
  /**
   * The fraction (0–1) of fluid `itemClass`'s demand that `id`'s connected pipe network can meet,
   * by conservation across the shared pool (total source output ÷ total reachable demand, capped
   * at 1). `undefined` when it can't be quantified — a wildcard buffer/freight source is present
   * (unknown sustained output), or the network has no demand for it. Per-leg pipe throughput is
   * not modelled; this is a whole-component supply/demand balance.
   */
  fluidSupplyRatio(id: string, itemClass: string): number | undefined;
}

/**
 * Analyses the **undirected** pipe network — pipe flow direction can't be reliably inferred
 * (ambiguous `PipelineConnection` connectors), and in Satisfactory head lift is anyway *shared*
 * across the whole connected network (the highest among its providers applies everywhere). So per
 * connected component this computes the max reachable fluid height and which fluids are sourced,
 * for the fluid-feed verdict. A building credits head lift only as infrastructure (pump/buffer) or
 * when it actually outputs fluid — a water Packager (fluid in, solid out) is a consumer and does
 * not lift its own supply.
 */
function analyzePipeNetwork(
  state: SaveState,
  graph: SaveGraph,
  eff: EffectiveGameData,
  nodes: FlowNode[],
): PipeNetworkAnalysis {
  const pipeTopoEdges = state.topology.edges.filter((e) => e.kind === 'pipe' && e.from !== e.to);
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while ((parent.get(root) ?? root) !== root) {
      root = parent.get(root) as string;
    }
    let cur = x;
    while (cur !== root) {
      const next = parent.get(cur) ?? cur;
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    if (!parent.has(a)) {
      parent.set(a, a);
    }
    if (!parent.has(b)) {
      parent.set(b, b);
    }
    parent.set(find(a), find(b));
  };
  for (const edge of pipeTopoEdges) {
    union(edge.from, edge.to);
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const heightOf = (id: string): number | undefined => {
    const loc = graph.getActor(id)?.location;
    return loc === undefined ? undefined : cmToMetres(loc.z);
  };

  const addRate = (
    m: Map<string, Map<string, number>>,
    root: string,
    item: string,
    rate: number,
  ): void => {
    let byItem = m.get(root);
    if (byItem === undefined) {
      byItem = new Map();
      m.set(root, byItem);
    }
    byItem.set(item, (byItem.get(item) ?? 0) + rate);
  };

  const maxHead = new Map<string, number>();
  const sourcedFluids = new Map<string, Set<string>>();
  const wildcardSource = new Set<string>();
  const supplyByRoot = new Map<string, Map<string, number>>(); // root → fluid item → total source output

  // Pass 1: head lift, fluid sources, and per-component fluid supply.
  for (const id of parent.keys()) {
    const root = find(id);
    const classKey = graph.getActor(id)?.classKey ?? '';
    const supply = nodeById.get(id)?.supply;
    const fluidOutputs = Object.entries(supply ?? {}).filter(([it]) => eff.isFluid(it));

    const lift =
      INFRASTRUCTURE_HEAD_LIFT[classKey] ??
      (fluidOutputs.length > 0 ? FLUID_OUTPUT_HEAD_LIFT : undefined);
    const z = heightOf(id);
    if (lift !== undefined && z !== undefined) {
      maxHead.set(root, Math.max(maxHead.get(root) ?? -Infinity, z + lift));
    }

    if (fluidOutputs.length > 0) {
      let set = sourcedFluids.get(root);
      if (set === undefined) {
        set = new Set();
        sourcedFluids.set(root, set);
      }
      for (const [it, rate] of fluidOutputs) {
        set.add(it);
        addRate(supplyByRoot, root, it, rate);
      }
    }
    if (WILDCARD_FLUID_SOURCE.has(classKey)) {
      wildcardSource.add(root);
    }
  }

  // Pass 2: per-component fluid demand from the consumers the network can actually reach
  // (above the shared head lift → unreachable, so they don't draw from the pool).
  const reachableDemandByRoot = new Map<string, Map<string, number>>();
  for (const id of parent.keys()) {
    const root = find(id);
    const z = heightOf(id);
    const head = maxHead.get(root);
    const reachable = z === undefined || head === undefined || z <= head + HEAD_LIFT_EPS;
    if (!reachable) {
      continue;
    }
    for (const [item, rate] of Object.entries(nodeById.get(id)?.demand ?? {})) {
      if (eff.isFluid(item)) {
        addRate(reachableDemandByRoot, root, item, rate);
      }
    }
  }

  return {
    inNetwork: (id) => parent.has(id),
    maxReachableHeight: (id) => (parent.has(id) ? maxHead.get(find(id)) : undefined),
    hasFluidSource: (id, itemClass) => {
      if (!parent.has(id)) {
        return false;
      }
      const root = find(id);
      return (sourcedFluids.get(root)?.has(itemClass) ?? false) || wildcardSource.has(root);
    },
    fluidSupplyRatio: (id, itemClass) => {
      if (!parent.has(id)) {
        return undefined;
      }
      const root = find(id);
      if (wildcardSource.has(root)) {
        return undefined; // a buffer/freight could supply an unknown sustained rate — don't rate-starve
      }
      const demand = reachableDemandByRoot.get(root)?.get(itemClass) ?? 0;
      if (demand <= 0) {
        return undefined;
      }
      const supply = supplyByRoot.get(root)?.get(itemClass) ?? 0;
      return Math.min(1, supply / demand);
    },
  };
}

/** Maps the save graph + effective game data onto the abstract flow network the solver reconciles. */
export function buildNetwork(
  state: SaveState,
  graph: SaveGraph,
  eff: EffectiveGameData,
  world: WorldLocations,
): FlowNetwork {
  const nodes: FlowNode[] = [];
  for (const buildable of state.topology.buildables) {
    const node = graph.getActor(buildable.instanceName);
    if (node?.producer !== undefined) {
      nodes.push({
        id: node.instanceName,
        demand: eff.requiredInputs(node.producer),
        supply: eff.producerOutputs(node.producer),
      });
    } else if (node?.extractor !== undefined) {
      const { resourceClass, purityMul } = resolveExtraction(
        node.extractor,
        world,
        state.resourceNodeOverrides,
      );
      const rate = eff.raw.buildings[node.extractor.buildingClass]?.extractionRatePerMin;
      const supply =
        resourceClass !== undefined && rate !== undefined
          ? {
              [resourceClass]:
                rate * purityMul * node.extractor.clockSpeed * node.extractor.productionBoost,
            }
          : undefined;
      nodes.push(
        supply === undefined
          ? { id: buildable.instanceName }
          : { id: buildable.instanceName, supply },
      );
    } else {
      // Belts, splitters, mergers, storage, poles: pass-through carriers.
      nodes.push({ id: buildable.instanceName });
    }
  }

  // Map each smart/programmable splitter's output edge to its rule outputIndex. The
  // splitter-side connector is `OutputN`; verified mapping is `outputIndex = N − 1`
  // (Output1/2/3 ↔ idx 0/1/2). Single pass over the topology edges.
  const splitterIds = new Set(state.topology.splitters.map((s) => s.instanceName));
  const outputIndexFor = new Map<string, Map<string, number>>();
  for (const edge of state.topology.edges) {
    for (const [owner, connector, other] of [
      [edge.from, edge.fromConnector, edge.to],
      [edge.to, edge.toConnector, edge.from],
    ] as const) {
      if (!splitterIds.has(owner)) {
        continue;
      }
      const match = /^Output(\d+)$/.exec(connector);
      if (match === null) {
        continue;
      }
      let byNeighbour = outputIndexFor.get(owner);
      if (byNeighbour === undefined) {
        byNeighbour = new Map();
        outputIndexFor.set(owner, byNeighbour);
      }
      byNeighbour.set(other, Number(match[1]) - 1);
    }
  }

  const edges: FlowEdge[] = graph.flowEdges().map(({ from, to }) => {
    const edge: FlowEdge = {
      from,
      to,
      capacity: Math.min(capOf(graph, eff, from), capOf(graph, eff, to)),
    };
    // A smart/programmable splitter output carries only what its sort-rules allow.
    const rules = graph.getActor(from)?.splitter?.rules;
    const outputIndex = outputIndexFor.get(from)?.get(to);
    if (rules !== undefined && outputIndex !== undefined) {
      return { ...edge, ...outputFilter(rules, outputIndex) };
    }
    return edge;
  });

  return { nodes, edges };
}

const round = (n: number): number => Math.round(n * 10) / 10;

/**
 * `find_bottlenecks` — reconciles the save's material flow and reports each producer that is
 * starved (an input under-fed beyond tolerance), unpowered (on an overloaded circuit with no
 * battery buffer), idle (no recipe) or unknown (flow direction unresolved). Compact and
 * aggregated: a summary plus the non-ok producers with the upstream cause — never a graph dump.
 */
export function bottlenecksView(
  state: SaveState,
  graph: SaveGraph,
  game: GameDataIndex,
  world: WorldLocations,
  options: { tolerance?: number; limit?: number } = {},
): BottlenecksView {
  const tolerance = options.tolerance ?? 0.05;
  const limit = options.limit ?? 50;
  const eff = getEffectiveGameData(state, game);
  const network = buildNetwork(state, graph, eff, world);
  const result = solveFlow(network);
  const cyclic = new Set(result.cyclic);
  // Fluids are reconciled over the undirected pipe network (direction is unreliable; head lift is
  // shared), separately from the directed solid solve.
  const pipes = analyzePipeNetwork(state, graph, eff, network.nodes);

  // Per-circuit power status, for the unpowered verdict.
  const power = powerView(state, graph, game);
  const circuitById = new Map(power.circuits.map((c) => [c.circuitId, c]));
  const name = (cls: string): string => game.displayNames.get(cls) ?? humaniseClassName(cls);

  const summary: Record<BottleneckVerdict | 'ok', number> = {
    ok: 0,
    starved: 0,
    unpowered: 0,
    idle: 0,
    unknown: 0,
  };
  const bottlenecks: BottleneckEntry[] = [];
  let producerCount = 0;

  for (const node of graph.actorsByKind('producer')) {
    producerCount += 1;
    const producer = node.producer;
    if (producer === undefined) {
      continue;
    }
    const base = (verdict: BottleneckVerdict, detail: string): BottleneckEntry => ({
      instanceName: node.instanceName,
      building: name(producer.buildingClass),
      ...(producer.recipeClass === undefined ? {} : { recipe: name(producer.recipeClass) }),
      ...(node.location === undefined
        ? {}
        : {
            location: {
              x: cmToMetres(node.location.x),
              y: cmToMetres(node.location.y),
              z: cmToMetres(node.location.z),
            },
          }),
      verdict,
      detail,
    });

    if (producer.recipeClass === undefined) {
      summary.idle += 1;
      bottlenecks.push(base('idle', 'no recipe set — not producing'));
      continue;
    }

    // Unpowered: the producer's circuit is overloaded and has no battery charge to ride it out.
    const circuit = circuitById.get(graph.powerCircuitOf(node.instanceName)?.circuitId ?? NaN);
    if (circuit?.status === 'overloaded' && circuit.batteryChargeMWh <= 0) {
      summary.unpowered += 1;
      bottlenecks.push(
        base('unpowered', `on overloaded circuit ${circuit.circuitId} (no battery buffer)`),
      );
      continue;
    }

    const required = Object.entries(eff.requiredInputs(producer)).filter(([, need]) => need > 0);
    const id = node.instanceName;
    const zHere = node.location === undefined ? undefined : cmToMetres(node.location.z);

    // 1. Fluid inputs — reconciled over the undirected pipe network (direction-independent, so a
    //    verdict here is definite). A fluid input fails when the network has no source of it, or
    //    the machine sits above the network's shared head lift.
    let fluidCause: string | undefined;
    for (const [item, need] of required.filter(([it]) => eff.isFluid(it))) {
      if (!pipes.inNetwork(id) || !pipes.hasFluidSource(id, item)) {
        fluidCause = `no ${name(item)} reaches it (no source in its pipe network)`;
        break;
      }
      const head = pipes.maxReachableHeight(id);
      if (zHere !== undefined && head !== undefined && zHere > head + HEAD_LIFT_EPS) {
        fluidCause =
          `${name(item)} can't be lifted to it — its pipe network's head lift reaches ~` +
          `${Math.round(head)} m but the machine is at ${Math.round(zHere)} m (add a pump)`;
        break;
      }
      // Reachable, but is the shared pipe network supplying enough? (whole-component balance)
      const ratio = pipes.fluidSupplyRatio(id, item);
      if (ratio !== undefined && ratio < 1 - tolerance) {
        fluidCause =
          `only ${round(need * ratio)}/${round(need)} ${name(item)} per min ` +
          `(its pipe network's ${name(item)} supply is shared short)`;
        break;
      }
    }
    if (fluidCause !== undefined) {
      summary.starved += 1;
      bottlenecks.push(base('starved', `starved: ${fluidCause}`));
      continue;
    }

    // 2. Solid inputs — from the directed belt solve.
    const delivered = result.delivered[id] ?? {};
    const solidStarved = required.filter(
      ([item, need]) => !eff.isFluid(item) && (delivered[item] ?? 0) < need * (1 - tolerance),
    );
    if (solidStarved.length === 0) {
      summary.ok += 1;
      continue;
    }

    // Under-fed on a belt input. Only the *conveyor* feed matters here — ambiguous pipe edges must
    // not make a belt-fed machine read `unknown` (fluids are handled above). If the belt feed
    // direction is unresolved, say unknown.
    const reach = graph.upstreamOf(id, { kind: 'conveyor' });
    if (cyclic.has(id) || !reach.complete) {
      summary.unknown += 1;
      bottlenecks.push(
        base(
          'unknown',
          'flow direction unresolved (looping or ambiguous belts) — cannot confirm feed',
        ),
      );
      continue;
    }

    // Report the hungriest belt input as the cause.
    solidStarved.sort((a, b) => (delivered[a[0]] ?? 0) / a[1] - (delivered[b[0]] ?? 0) / b[1]);
    const [item, need] = solidStarved[0] as [string, number];
    const got = delivered[item] ?? 0;
    const cause =
      got <= 0
        ? `no ${name(item)} reaching it`
        : `only ${round(got)}/${round(need)} ${name(item)} per min (shared supply or belt limit)`;
    summary.starved += 1;
    bottlenecks.push(base('starved', `starved of ${name(item)}: ${cause}`));
  }

  // Most-broken first; cap for tokens.
  const order: Record<BottleneckVerdict, number> = {
    unpowered: 0,
    starved: 1,
    idle: 2,
    unknown: 3,
  };
  bottlenecks.sort((a, b) => order[a.verdict] - order[b.verdict]);
  const capped = bottlenecks.slice(0, limit);

  return {
    tolerance,
    producerCount,
    summary,
    bottlenecks: capped,
    ...(capped.length < bottlenecks.length
      ? { truncated: bottlenecks.length - capped.length }
      : {}),
    note: NOTE,
  };
}
