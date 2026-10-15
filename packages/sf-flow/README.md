# `@foreman/sf-flow`

A pure, steady-state **material-flow solver**. Given an abstract flow network it computes
the actual delivered rate at every machine input and the throughput each producer can
sustain — resolving contention, belt/pipe capacity, splitter filters and starvation
feedback to a fixed point.

It is deliberately **game-agnostic**: nodes carry per-item `supply`/`demand` rates and
edges carry a throughput `capacity` plus an optional item `allow` filter (and an
`overflow` flag) — all plain numbers. No game data, no save types, no I/O. The `sf-mcp`
adapter maps the save connection graph ([upstream #142](https://github.com/StuartMeeks/ficsit-foreman/issues/142)) + the effective game data (recipe rates,
belt/pipe caps, pump head lift) onto this model, and applies fluid head-lift limits as a
zeroed edge capacity, so the solver never needs geometry. See
[`docs/flow-solver.md`](../../docs/flow-solver.md).

```ts
import { solveFlow } from '@foreman/sf-flow';

const { delivered, throughput, cyclic } = solveFlow({
  nodes: [
    { id: 'miner', supply: { OreIron: 60 } },
    { id: 'smelter', demand: { OreIron: 30 }, supply: { IngotIron: 30 } },
  ],
  edges: [{ from: 'miner', to: 'smelter', capacity: 120 }],
});
// throughput.smelter === 1 (fully fed); delivered.smelter.OreIron === 60
```

## Model

- **Node** — `{ id, supply?, demand? }`. A source has `supply` only; a final consumer
  `demand` only; a producer has both (its output scales by its solved throughput).
- **Edge** — `{ from, to, capacity, allow?, deny?, overflow? }`. `capacity` caps the total
  across all items; `allow` restricts which items may pass (a smart-splitter output filter);
  `deny` blocks specific items (an "Any Undefined" output excludes items routed to a sibling);
  `overflow` marks an output that only carries what its siblings cannot.
- **Result** — `delivered[node][item]`, `throughput[node]` (0–1), and `cyclic[]` (nodes on
  a directed loop that could not be ordered — treat as *unknown*, never a negative).

## Algorithm

A fixed-point iteration: each pass pushes source output downstream in topological order,
distributing across splitter outputs in proportion to downstream demand (capped by edge
capacity, honouring filters and overflow), then recomputes each producer's throughput as
the fraction of its hungriest input that is met. A starved producer's reduced output
feeds back to its own consumers on the next pass until the rates settle. It models
**steady-state rates**, not tick-level belt timing.
