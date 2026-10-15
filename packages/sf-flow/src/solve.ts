// solveFlow: the steady-state solver. Orders the network topologically, then iterates to a fixed
// point, sharing each node's output across edges by downstream demand within edge capacities.
// Pure maths over FlowNetwork; the network types are in types.ts.

import type { FlowEdge, FlowNetwork, FlowResult, RateMap, SolveOptions } from './types.js';

interface Indexed {
  /** Outgoing edge indices per node id. */
  out: Map<string, number[]>;
  /** Topologically ordered node ids (sources first); excludes cyclic nodes. */
  order: string[];
  /** Node ids on a directed cycle (could not be ordered). */
  cyclic: string[];
}

/** Kahn topological sort over the directed edges; leftover nodes are cyclic. */
function topoSort(network: FlowNetwork): Indexed {
  const out = new Map<string, number[]>();
  const inDegree = new Map<string, number>();
  for (const node of network.nodes) {
    out.set(node.id, []);
    inDegree.set(node.id, 0);
  }
  network.edges.forEach((edge, index) => {
    // Ignore self-loops and edges to/from unknown nodes for ordering robustness.
    if (!out.has(edge.from) || !inDegree.has(edge.to) || edge.from === edge.to) {
      return;
    }
    out.get(edge.from)?.push(index);
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  });

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) {
      queue.push(id);
    }
  }
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    order.push(id);
    for (const edgeIndex of out.get(id) ?? []) {
      const to = network.edges[edgeIndex]?.to;
      if (to === undefined) {
        continue;
      }
      const next = (inDegree.get(to) ?? 0) - 1;
      inDegree.set(to, next);
      if (next === 0) {
        queue.push(to);
      }
    }
  }
  const ordered = new Set(order);
  const cyclic = network.nodes.map((n) => n.id).filter((id) => !ordered.has(id));
  return { out, order, cyclic };
}

const edgeAllows = (edge: Pick<FlowEdge, 'allow' | 'deny'>, item: string): boolean =>
  (edge.allow === undefined || edge.allow.includes(item)) && edge.deny?.includes(item) !== true;

function addRate(map: RateMap, item: string, amount: number): void {
  map[item] = (map[item] ?? 0) + amount;
}

/**
 * Solves the steady-state material flow over `network`. Runs a fixed-point iteration:
 * each pass pushes source output downstream in topological order, distributing flow
 * across splitter outputs in proportion to downstream demand (capped by edge capacity,
 * honouring item filters and overflow outputs), then recomputes each producer's
 * throughput as the fraction of its hungriest input that is met. A starved producer's
 * reduced output propagates to its own consumers on the next pass until the rates settle.
 *
 * Pure and deterministic — no game data, no I/O. Nodes on a directed cycle cannot be
 * ordered and are returned in `cyclic` for the caller to treat as unknown.
 */
export function solveFlow(network: FlowNetwork, options: SolveOptions = {}): FlowResult {
  const maxIterations = options.maxIterations ?? 100;
  const epsilon = options.epsilon ?? 1e-4;
  const { out, order, cyclic } = topoSort(network);
  const nodeById = new Map(network.nodes.map((n) => [n.id, n]));

  // Backward (reverse-topo) gross downstream demand per item — the distribution weights.
  // wants[node][item] = own demand + what everything reachable downstream wants, only
  // through edges that allow the item. Capacity is ignored here (it is a weight, not a flow).
  const wants = new Map<string, RateMap>();
  for (const id of order) {
    wants.set(id, {});
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i] as string;
    const node = nodeById.get(id);
    const w: RateMap = {};
    for (const [item, rate] of Object.entries(node?.demand ?? {})) {
      addRate(w, item, rate);
    }
    for (const edgeIndex of out.get(id) ?? []) {
      const edge = network.edges[edgeIndex];
      if (edge === undefined) {
        continue;
      }
      for (const [item, rate] of Object.entries(wants.get(edge.to) ?? {})) {
        if (edgeAllows(edge, item)) {
          addRate(w, item, rate);
        }
      }
    }
    wants.set(id, w);
  }

  const throughput = new Map<string, number>(network.nodes.map((n) => [n.id, 1]));
  let delivered = new Map<string, RateMap>();

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const arriving = new Map<string, RateMap>(network.nodes.map((n) => [n.id, {}]));
    delivered = new Map<string, RateMap>(network.nodes.map((n) => [n.id, {}]));

    for (const id of order) {
      const node = nodeById.get(id);
      const incoming = arriving.get(id) ?? {};
      const tput = throughput.get(id) ?? 1;

      // A demand item that arrives is consumed here (recorded as delivered), not forwarded.
      const demand = node?.demand ?? {};
      const forwardable: RateMap = {};
      for (const [item, rate] of Object.entries(incoming)) {
        if (demand[item] !== undefined) {
          addRate(delivered.get(id) as RateMap, item, rate);
        } else {
          addRate(forwardable, item, rate);
        }
      }
      // The node's own production (scaled by how hard it is running) flows downstream.
      for (const [item, rate] of Object.entries(node?.supply ?? {})) {
        addRate(forwardable, item, rate * tput);
      }

      distribute(network, out.get(id) ?? [], forwardable, wants, arriving);
    }

    // Recompute throughput from this pass's delivered inputs; converge when stable.
    let maxChange = 0;
    for (const node of network.nodes) {
      const demandEntries = Object.entries(node.demand ?? {});
      let next = 1;
      if (demandEntries.length > 0) {
        next = 1;
        for (const [item, required] of demandEntries) {
          if (required > 0) {
            const got = delivered.get(node.id)?.[item] ?? 0;
            next = Math.min(next, got / required);
          }
        }
      }
      maxChange = Math.max(maxChange, Math.abs(next - (throughput.get(node.id) ?? 1)));
      throughput.set(node.id, next);
    }
    if (maxChange < epsilon) {
      break;
    }
  }

  return {
    delivered: Object.fromEntries(delivered),
    throughput: Object.fromEntries(throughput),
    cyclic,
  };
}

/**
 * Distributes a node's forwardable output across its outgoing edges. For each item:
 * non-overflow edges that allow it take flow weighted by downstream demand, each capped
 * by the edge's remaining capacity (shared across items); a second sweep tops up any
 * non-overflow edge with spare capacity (conserving flow when demand weighting under-fills
 * one); whatever still cannot be placed spills to overflow edges. Capacity is enforced
 * during allocation — so an overflow output receives the *true* residual its siblings
 * could not carry.
 */
function distribute(
  network: FlowNetwork,
  outIndices: number[],
  forwardable: RateMap,
  wants: Map<string, RateMap>,
  arriving: Map<string, RateMap>,
): void {
  const edges = outIndices
    .map((i) => network.edges[i])
    .filter((e): e is NonNullable<typeof e> => e !== undefined);
  const capLeft = edges.map((e) => e.capacity);
  const deposit: RateMap[] = edges.map(() => ({}));

  const give = (i: number, item: string, amount: number): number => {
    const actual = Math.max(0, Math.min(amount, capLeft[i] as number));
    if (actual > 0) {
      addRate(deposit[i] as RateMap, item, actual);
      capLeft[i] = (capLeft[i] as number) - actual;
    }
    return actual;
  };

  for (const [item, total] of Object.entries(forwardable)) {
    if (total <= 0) {
      continue;
    }
    const normal = edges
      .map((edge, i) => ({ edge, i }))
      .filter((e) => !e.edge.overflow && edgeAllows(e.edge, item));
    const overflow = edges
      .map((edge, i) => ({ edge, i }))
      .filter((e) => e.edge.overflow && edgeAllows(e.edge, item));

    let remaining = total;
    // 1. Demand-weighted across non-overflow edges, capped by each edge's capacity.
    const weights = normal.map(({ edge }) => wants.get(edge.to)?.[item] ?? 0);
    const weightSum = weights.reduce((a, b) => a + b, 0);
    normal.forEach(({ i }, k) => {
      const share =
        weightSum > 0 ? (total * (weights[k] as number)) / weightSum : total / normal.length;
      remaining -= give(i, item, Math.min(share, remaining));
    });
    // 2. Top up non-overflow edges that still have capacity (weighting under-filled them).
    if (remaining > 1e-9) {
      for (const { i } of normal) {
        remaining -= give(i, item, remaining);
        if (remaining <= 1e-9) {
          break;
        }
      }
    }
    // 3. Spill the true residual to overflow edges.
    if (remaining > 1e-9) {
      for (const { i } of overflow) {
        remaining -= give(i, item, remaining);
        if (remaining <= 1e-9) {
          break;
        }
      }
    }
  }

  edges.forEach((edge, i) => {
    const into = arriving.get(edge.to);
    if (into === undefined) {
      return;
    }
    for (const [item, amount] of Object.entries(deposit[i] as RateMap)) {
      addRate(into, item, amount);
    }
  });
}
