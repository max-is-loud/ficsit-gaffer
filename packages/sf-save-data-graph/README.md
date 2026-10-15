# @foreman/sf-save-data-graph

The **save-game connection graph** for *Satisfactory*. A **pure projection** of a
parsed save's `SaveState`: it builds an in-memory, **game-data-agnostic** index over
`SaveState.topology` (buildable actors, conveyor/pipe links, pre-grouped power
circuits) and joins each node to its typed domain record. It holds **no facts of its
own** — `@foreman/sf-save-data` is the single source of truth; this is the queryable
lens. It is the substrate every *relational* save question is answered over:

- **Power** ([upstream #68](https://github.com/StuartMeeks/ficsit-foreman/issues/68)) — circuits are pre-grouped by the game, so this is mostly aggregation.
- **Production feed-tracing & real bottlenecks** ([upstream #126](https://github.com/StuartMeeks/ficsit-foreman/issues/126)) — directed traversal over belts/pipes.
- Logistics and map adjacency.

It sits in the same domain layer as `@foreman/sf-save-data` and mirrors the
`@foreman/sf-game-data` → `@foreman/sf-game-data-graph` split. Strictly downward:
it depends on `@foreman/sf-save-data` only — **no game data, no app concerns**.
Resolving raw class names to display names is a cross-domain join that lives at the
edge (`sf-mcp`), keeping this package agnostic. See
[`docs/component-architecture.md`](../../docs/component-architecture.md).

## Usage

```ts
import { normaliseSave, parseSaveFile } from '@foreman/sf-save-data';
import { buildSaveGraph } from '@foreman/sf-save-data-graph';

const { state } = normaliseSave(parseSaveFile(savePath, 'my-save'), new Date().toISOString());
const graph = buildSaveGraph(state); // a projection of state.topology

graph.getActor(instanceName);             // → ActorNode (class key, location, kind + its domain record)
graph.actorsByKind('producer');           // → all recipe-runner nodes (with their ProducerLine)
graph.neighbours(instanceName, 'conveyor'); // → directly connected actors
graph.traverse(start, { kind: 'conveyor' }); // → BFS reachable set (the feed-trace primitive)
graph.powerCircuitOf(instanceName);       // → the actor's pre-grouped power circuit
graph.edges('pipe');                      // → all pipe links (each carries its networkId)
graph.state();                            // → the backing SaveState (every save fact, reachable)
graph.stats();                            // → counts for diagnostics
graph.warnings;                           // → the save's non-fatal issues (never throws)
```

### Model

- **Actors** are the buildings (`Build_*`), taken from `state.topology.buildables` —
  the complete node set. Belts, lifts, splitters and mergers are themselves nodes, so
  a real chain is `Machine → Belt → Splitter → … → Machine`. Each node carries a
  `kind` (`storage` / `producer` / `extractor` / `building`) and, where one exists, its
  typed `SaveState` record — joined by instance name, so a feed-tracer sees a node's
  recipe/clock or contents without a second lookup.
- **Edges** are `conveyor` or `pipe`, deduped to one per physical link. They are
  **undirected** as stored — `from`/`to` are canonically ordered, not a flow direction.
  The connector-name tails (`Output0`/`Input0`/`ConveyorAny0`) are retained so
  consumers can infer flow; belt connectors are deliberately ambiguous in the save.
- **Power circuits** are pre-grouped by the game (`mCircuitID` + `mComponents`), so no
  traversal is needed.
- **`state()`** returns the `SaveState` the graph projects, so the non-spatial facts
  (player, recipes, milestones, MAM research, collectibles, assembly phase, header) are
  reachable from the graph too — indexed, never copied.

The relational facts themselves live in `SaveState.topology` (produced by the
`sf-save-data` normaliser, which also owns canonical edge ordering and dedup). This
package only **indexes** them. Direction inference and belt-chain collapsing are
**consumer** concerns ([upstream #126](https://github.com/StuartMeeks/ficsit-foreman/issues/126)).

## Backend & the in-memory-vs-Kùzu spike

The graph is backed by **in-memory adjacency maps**. The issue ([upstream #122](https://github.com/StuartMeeks/ficsit-foreman/issues/122)) called for a
spike between this and a Kùzu-per-save database. Measured on a real mid save
(`~/saves/sam-good-12.sav`, 51,523 objects):

| step | cost |
|---|---|
| parse (already paid by the save store) | ~5,100 ms |
| normalise → `SaveState` (incl. topology extraction) | ~300 ms |
| **project the graph** (14k actors, ~5.2k conveyor + ~0.8k pipe edges, 5 circuits) | **~19 ms** |

Connectivity extraction now happens once in `normaliseSave` (it's part of the single
source of truth); projecting the graph over `state.topology` is a trivial index build.
The total adds a few percent to a parse already paid. Kùzu-per-save would add
multi-second row-by-row ingestion *and* hold a native DB per cache slot, and would pull
the native `kuzu` addon into this otherwise zero-native-dep package. **Decision:
in-memory.** The `SaveGraph` facade is the stable surface — swapping in an embedded
graph DB later (should recursive queries ever demand it) is an implementation change,
not an API one.

Reproduce the numbers:

```sh
npm run inspect -w @foreman/sf-save-data-graph -- ~/saves/sam-good-12.sav
```

## Caching

Building is cheap but not free, so callers cache per save. `@foreman/sf-mcp`'s
`SaveStore` parses once, normalises to a `SaveState`, and projects the graph from that
same state — memoising both and rebuilding only when the `.sav` mtime changes
(`store.getGraph()`). Because the graph is projected from the state, the two can never
drift.
