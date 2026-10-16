# Bridge v2: live world — buildables and Pioneer position

Date: 2026-10-15

Status: Design approved section by section in brainstorming; written spec
approved by the user on 2026-10-16; implementation planning authorised. Implements #10. Prerequisite for #11 (goals
watcher) and #12 (bases); #13 and #14 extend the same channel.

## Purpose and success

Generalise the live bridge from one hard-coded building class (Constructor)
to a **live world** model, so the foreman can answer, from the linked
dedicated-server world and without a save upload, questions like:

> "You have 14 Smelters on Iron Ingot, 2 of them paused; the nearest is 300 m
> north-east of you, 20 m up."

Success means:

- Every production building (manufacturers, extractors, generators, storage)
  is observed with its **configuration** — recipe, clock speed, shards,
  Somersloops, paused, extractor node, generator fuel.
- The requesting Pioneer's **live position** feeds the existing location tools.
- Configuration changes are seen promptly whether made by a player at the
  machine or by a remote-management mod using the vanilla setters.
- The state shape is the foundation #11 and #12 build on.

### Agreed with the user

- Scope option A: one spec, delivered in parts — Part 0 (v1 acceptance),
  Part 1 (protocol v2 + buildables), Part 2 (Pioneer position).
- The Pioneer is resolved by the **server from context**, never chosen by the
  model: today from a per-playthrough Pioneer name set by the playthrough
  owner; later from the sender of an in-game chat message. Name matching is a
  convenience lookup, not an identity guarantee.
- Scale: built for up to ~5,000 production-building rows, accepted against the
  user's real (early-game) world plus a synthetic ~5k test. Belts, pipes,
  foundations and decorative buildables are out.
- v2 captures **configuration**; runtime state (running/idle, productivity,
  fuel level, inventory) stays in #14. Clock speed and Somersloop boost move
  from #14 to v2.
- Registry keyed on **native base classes**, names resolved in ff-server via
  `sf-game-data` (approach 1). **Hard cut**: receiver and ff-server speak v2
  only and the three components are redeployed together.
- Change detection via setter hooks and game delegates (verified against
  primary sources — see "Research basis"), plus a public `RequestRecapture`
  API for mods that bypass the setters.
- The v1 in-game placement chat message is dropped; the `chat.send` command
  plumbing stays for the future in-game foreman.

### Unchanged from v1

One receiver world ↔ one playthrough by operator configuration; producer and
read-only query tokens; verified TLS with no redirects; bounded requests and
responses; epochs, sequences, snapshots and replay; the freshness semantics
(`fresh` / `last_known` / `unavailable`, monotonic 15 s window). Advice appears
in web chat only.

## Out of scope

- Non-production buildables (belts, pipes, power poles, foundations, decor).
- Runtime state, power, actual production rates (#14); progression (#13);
  bases (#12); goal evaluation (#11).
- Server-side rate aggregation (nominal or actual) — deferred to #14 so nominal
  figures are not presented as fact.
- In-game foreman chat and any in-game notices.
- Remote-management mods that neither use the vanilla setters nor call
  `RequestRecapture` — **unsupported**, documented as such.
- Large-world certification beyond what is measured (see Acceptance).
- Exposing other players' positions to chat.

## Delivery

| Part | Delivers | Gate |
|---|---|---|
| 0 | v1 real-game/web-chat acceptance (the five outstanding steps in `docs/live-constructor-awareness.md`) recorded on the user's world | Known-good v1 baseline before the breaking change |
| 1 | Protocol v2, buildables registry and capture, change detection, `RequestRecapture`, receiver v2 storage/query, `get_live_buildables` | Opens with the Part 1 spike; ends with Part 1 acceptance |
| 2 | Pioneer sampler, `pioneers` channel, receiver pioneer store/queries, `pioneerName` setting, `RequestingPioneer` resolver, `get_my_live_position` | Opens with the Part 2 spike; ends with Part 2 acceptance |

## Part 1 — plugin

### Registry

One ordered table (`BuildableRegistry.cpp`). Each entry: native base class →
category → capture function. For each buildable the plugin walks its class
hierarchy; the **first matching entry wins** (table order is precedence).
Unmatched buildables are ignored. Every Blueprint subclass of a registered
base — vanilla, a future update's, or a mod's — is captured with no
per-class entry.

| Native base | Category |
|---|---|
| `AFGBuildableManufacturer` | `manufacturer` |
| `AFGBuildableResourceExtractorBase` | `extractor` |
| `AFGBuildableGeneratorFuel` (further generator bases if the hierarchy requires) | `generator` |
| `AFGBuildableStorage` | `storage` |

`AFGBuildableStorage` derives from `AFGBuildableFactory`, as do the others;
order the table most-specific first. Adding a category is one registry entry
plus one schema entry in each codec — no new branches (code standard 5).

### Capture

Each category's capture function lives in its own file (e.g.
`Capture/ManufacturerCapture.cpp`) and returns a typed configuration struct.
A field the game does not expose for that building is `null`; nothing is
invented. Accessors (all confirmed in the pinned headers, see Research basis):

- Recipe: `AFGBuildableManufacturer::GetCurrentRecipe()`.
- Clock speed: `AFGBuildableFactory::GetCurrentPotential()`.
- Production boost: `GetCurrentProductionBoost()`.
- Power Shards and Somersloops: counted from `GetPotentialInventory()` (no
  dedicated count getter exists).
- Paused: the factory's production-paused state.
- Extractor resource: `GetExtractableResource()` →
  `IFGExtractableResourceInterface::GetResourceClass()`; purity via
  `AFGResourceNode::GetResourcePurity()` when the resource is a node; node
  actor path when there is one (water extractors have none). Do not use the
  deprecated `GetResourceNode()`.
- Generator fuel: `AFGBuildableGeneratorFuel::GetCurrentFuelClass()`.

Identity is unchanged from v1: a fresh GUID entity ID per actor, so a
same-position rebuild gets a new ID.

### Change detection

Placement and removal use the `AFGBuildableSubsystem` add/remove delegates, as
in v1. Configuration changes queue a **re-capture** of the affected buildable;
the queue deduplicates per buildable and is drained under a fixed per-tick cap.

| Change path | Detection |
|---|---|
| Recipe | `SUBSCRIBE_METHOD_AFTER` on `AFGBuildableManufacturer::SetRecipe` (non-virtual, hookable for every caller) |
| Clock speed | Bind `mOnPendingPotentialChanged` per tracked buildable (avoids missing virtual overrides of `SetPendingPotential`) |
| Somersloop boost | Bind `mOnPendingProductionBoostChanged` |
| Paused | Hook after `SetIsProductionPaused` (signature verified in the spike) |
| Power Shards / Somersloop items | Potential-inventory item added/removed delegates (names verified in the spike) |
| Player opens/closes a machine | `OnUseStop` re-capture as a safety net, kept only if the spike proves it fires on the server |
| Blueprint or fresh build | Placement delegate, plus one **settle re-capture** 2 s after construction (a tunable constant) in case configuration is applied after `BeginPlay` |
| World load / save edit | New epoch → full snapshot |
| Mod that bypasses setters | `RequestRecapture` (below) |
| Mod that does neither | Unsupported |

**Fallback.** Anything the spike cannot verify falls back to a **near-player
sweep**: every 10 ticks, buildables within ~30–50 m of each online player are
re-fingerprinted, using a coarse spatial grid built from tracked positions
(updated only on place/remove), under the same per-tick cap. Cost scales with
players × local density, not world size. Missing hooks or delegates in a future
game build are logged at start-up and fall back to the sweep — never silent.

There is no whole-world background sweep: with remote management limited to the
paths above, every configuration change is covered.

### `RequestRecapture` — public API for other mods

```cpp
// Public, BlueprintCallable — usable from C++ and Blueprint-only mods.
UFUNCTION(BlueprintCallable, Category = "Foreman Bridge")
static void RequestRecapture(AFGBuildable* Buildable);
```

- Requests a re-capture only; the caller never supplies data. The bridge reads
  the configuration itself through the registry, so a faulty or malicious mod
  can cause extra reads, never false state.
- Server-only (no-op without authority), game thread only; null or
  unregistered buildables are ignored.
- Uses the same deduplicated, capped queue — spam cannot stall the game thread.
- Consumers declare the bridge as an optional dependency (`"Optional": true`
  in `.uplugin`) and check `IsModLoaded` before calling. Documented in the
  plugin README as a stable, versioned contract.

### In-game chat

The v1 placement greeting is removed. The `chat.send` command type, its
validation and result handling stay.

### Code layout

To the new code standards: file headers, ≤ 500 lines per file, functions
≤ 60 lines. Registry, each capture function, the change detector, the
re-capture queue and the public API each get their own file. `State`,
`Delivery`, `Transport` and `Wire` keep their v1 roles; `BridgeWire.cpp`'s row
and configuration codecs split into a table of category schemas.

## Part 1 — wire protocol v2

`protocol: 2`. Envelope, sequences, snapshot chunking/digest, epochs, limits
(256 KiB, 128 events per exchange, nesting 32) and command rules are unchanged
from `protocol-v1.md` except as below. The canonical fixture becomes `v2.json`,
byte-identical in the receiver and plugin test trees.

### Rows

```
entityId, actorPath, classPath, category, transform, player, config
```

`category` is one of `manufacturer`, `extractor`, `generator`, `storage`.
`config` has exactly the fields for its category; unknown fields are rejected;
every field is nullable.

| Category | `config` fields |
|---|---|
| `manufacturer` | `recipe` (class path), `clockSpeed`, `productionBoost`, `powerShards`, `somersloops`, `paused` |
| `extractor` | `resource` (item class path), `purity` (`impure` \| `normal` \| `pure`), `node` (actor path), `clockSpeed`, `powerShards`, `paused` |
| `generator` | `fuel` (item class path), `clockSpeed`, `powerShards`, `paused` |
| `storage` | `{}` |

Numbers are finite JSON numbers (counts are uint32 integers); paths follow
v1's path rules.

### Events

Types `buildable.upsert` / `buildable.remove`; origins `placed`, `reconciled`,
`reconfigured`. No event creates chat.

### Pioneers (Part 2)

`/v2/exchange` requests gain optional `pioneers` (≤ 64 entries, latest sample
per player):

```
{ platform, accountId, displayName, position: [x,y,z], yaw, travelMode, online }
```

`travelMode` ∈ `on_foot`, `airborne`, `swimming`, `vehicle`, `hypertube`,
`zipline`, `unknown`. Not sequenced, retained, replayed or snapshotted; a lost
sample is superseded by the next. Strings follow v1's player-string limits.

## Part 1 — receiver

### Storage

- `buildables(world_id, epoch, entity_id, category, class_path, recipe,
  row_json)` replaces `constructors`; indexes on category, class path and recipe
  within world/epoch.
- Schema version via `PRAGMA user_version`. Opening a v1 database wipes the
  ingestion state so the world reads `no_baseline` and the game re-snapshots on
  its next hello. No history exists to lose.

### Query: `POST /query/v2/buildables`

```ts
type BuildablesQuery = {
  filter?: { category?: string; classPath?: string; recipe?: string }; // exact, AND-combined
  groupBy?: 'category' | 'class' | 'recipe';
  from?: [number, number, number];   // cm; distance mode
  includeRows?: boolean;             // default false
  limit?: number;                    // 1..100, default 50
  cursor?: string;                   // id-ordered mode only
};
```

Response: v1's `protocol`, binding, `revision`, `epoch`, `status`, `reason`,
`lastSyncAt`, `evaluatedAt`, plus:

- `totalCount` — exact count matching the filter for the revision.
- `groups: [{ key, count }]` when `groupBy` is set.
- `rows: [{ entityId, category, classPath, position, config, distanceMetres? }]`.
- `coordinateSystem: 'unreal_cm'`, `returnedCount`, `hasMore`, `nextCursor`.

Modes:

- **Id-ordered** (no `from`): ordered by `entityId`, paginated by a cursor bound
  to world, revision and last entity — v1 semantics, including `409
  state_changed`.
- **Distance** (`from` set): one page sorted by distance, `nextCursor` null,
  `hasMore` signals that more exist; `cursor` with `from` is `invalid_query`.

All reads in one SQLite read transaction; distance sorting is in memory (≤ ~5k
rows). Errors as in `query-v1.md`. The query token gains the v2 routes; the v1
route is removed.

## Part 2 — plugin and receiver

### `PioneerSampler`

About once a second, iterate the server's player controllers; for each pawn
read position (cm), yaw, travel mode, and identity from `PlayerState` (display
name, platform, account ID). Emit when the player moves > 5 m, turns > 30°,
changes travel mode, connects or disconnects, and as a 10 s heartbeat. Cost is
per player, independent of world size. The Part 2 spike verifies the
movement-mode, vehicle, hypertube and zipline accessors.

### Receiver

- `pioneers(world_id, platform, account_id, display_name, online, row_json,
  updated_at)` — one row per platform/account, overwritten. A new epoch clears
  the world's rows.
- Freshness independent of buildables: `fresh` if updated < 15 s ago
  (monotonic, in-process), else `last_known`; `offline` with last-seen time
  once disconnected.
- `POST /query/v2/pioneer { displayName }` — exact, case-insensitive match;
  returns the match, `not_found`, or `ambiguous` with a count and no positions.
- `POST /query/v2/pioneers` — display names seen, with online status (no
  positions), for the settings pick list.

## ff-server

### Live-tool registry

`liveStateTools.ts` becomes a small registry (binding check, advertising only
to the linked playthrough, shared error mapping) plus one file per tool.
`bridge/types.ts` and `bridge/client.ts` move to v2 types; deadline (5 s),
response cap (256 KiB) and no-retry policy unchanged.

### `get_live_buildables` (Part 1)

Model arguments (query options only):

```ts
{
  category?: 'manufacturer' | 'extractor' | 'generator' | 'storage';
  building?: string;                 // e.g. "Smelter"
  recipe?: string;                   // e.g. "Alternate: Pure Iron Ingot"
  groupBy?: 'category' | 'building' | 'recipe';
  nearestTo?: { x: number; y: number; z: number };  // metres
  includeRows?: boolean; limit?: number; cursor?: string;
}
```

- `building` and `recipe` resolve **exactly** (display name or class name) via
  `sf-game-data`; unknown or ambiguous names return a tool error with
  candidates and send no query. Metres → cm for `from`.
- Paths in results are resolved to display names (building, recipe, resource,
  fuel); paths the game data does not know are shown by class name with
  `unresolved: true`.
- Output carries status/freshness wording as in v1, totals, groups, and rows
  with building, recipe, configuration, `positionMetres`, `distanceMetres`.

### Pioneer identity and `get_my_live_position` (Part 2)

- Prisma migration: nullable `pioneerName` on the playthrough, settable by its
  owner through the playthrough route; the client offers a settings field with
  a pick list from `/query/v2/pioneers`.
- `RequestingPioneer` resolver interface. `PlaythroughNameResolver` reads
  `pioneerName` (today). A future in-game-chat resolver supplies the sender's
  platform/account ID. Tools depend only on the interface.
- `get_my_live_position` takes **no model arguments**. It returns
  `positionMetres`, height, yaw/bearing, travel mode and freshness, for use
  with `describe_location`, `nearest_*` and `get_live_buildables.nearestTo`.
- Unset, not-found or ambiguous names produce an explanatory tool result; the
  foreman asks the user to fix the setting and never guesses.
- Only the resolved Pioneer's position reaches chat.

### System prompt

"Live Constructor Observations" becomes "Live Factory Observations": keep v1's
rules (re-query for every claim, keep live and save sources separate, honour
unavailable/last-known) and add:

- **Configuration is not activity** — "set to Iron Ingot, not paused" does not
  mean producing; running status comes with #14. Nominal rates derived from
  recipe and clock speed via the game-data tools must be labelled nominal.
- The Pioneer's live position comes only from `get_my_live_position`; say when
  it is not fresh. The "do not invent 'near your base'" rule stays until #12.

## Error handling

v1's model carries over: any receiver failure is reported as unavailable and
the rest of chat keeps working.

| Case | Behaviour |
|---|---|
| Unknown/ambiguous building or recipe name | Tool error with candidates; no query |
| Unresolvable path in data | Class name with `unresolved: true` |
| Config field unreadable | `null` on the wire; foreman says "unknown" |
| Pioneer name unset / not found / ambiguous | Explanatory tool result; ask the user to fix the setting |
| Pioneer stale or offline | Last-known position with time, or offline with last seen |
| Hook or delegate missing in a game build | Logged at start-up; near-player sweep fallback |
| v1 database on start-up | Ingestion state reset to `no_baseline` |

## Testing and acceptance

### Automated

- **Codecs:** shared `v2.json` fixtures with valid and invalid cases per
  category and for `pioneers`; native-encoded requests decoded independently
  by JS, as in v1.
- **Plugin (native tests):** registry precedence, each capture function,
  re-capture queue deduplication and cap, `RequestRecapture` server-only
  behaviour, sampler thresholds and heartbeat.
- **Receiver:** v1 → v2 reset, filters, grouping, distance mode, revision-bound
  cursors, pioneer freshness/offline, name matching; a **synthetic ~5k-row
  world** for snapshot and query timings.
- **ff-server:** name resolution, tool authorisation, resolver interface,
  `pioneerName` migration and route, and the HTTPS integration test against a
  real receiver updated for v2.

### Real-game acceptance (recorded separately from automated results)

- **Part 0:** the five outstanding v1 steps.
- **Part 1 spike:** hooks fire on the dedicated server; `SetIsProductionPaused`
  signature; potential-inventory delegate names; whether `OnUseStop` fires on
  the server; settle re-capture timing.
- **Part 1:** baseline matches in-game counts; place/remove; recipe, clock,
  shard, Somersloop and pause changes each observed; a FicsIt-Networks recipe
  change caught via the setter hook if installed on the test server (else
  recorded as untested); delivery interruption and recovery as in v1; measured
  per-buildable capture cost and snapshot timings at the world's size.
- **Part 2 spike:** movement-mode/vehicle/hypertube/zipline accessors.
- **Part 2:** position tracks the Pioneer through each travel mode;
  disconnect → offline; unset/wrong/duplicate name handling;
  `describe_location` and `nearestTo` driven from the live position in web chat.

Performance claims in docs are limited to what these measurements show.

## Research basis

Verified on 2026-10-15 against primary sources: SML `master` @ `8eebc9e` (the
bridge's pinned starter commit), FicsIt-Networks `master` @ `789c32f`,
FicsitRemoteMonitoring `main` @ `9e5f542`, and docs.ficsit.app.

- Optional inter-mod dependencies (`"Optional": true`) and `IsModLoaded` are
  documented SML patterns; no concrete example of one mod calling another's
  Blueprint library was found, but nothing indicates it is unsupported.
- FicsIt-Networks changes machines remotely via vanilla `SetRecipe`,
  `SetPendingPotential`, `SetPendingProductionBoost`, `SetIsProductionPaused`;
  FRM only via `SetIsProductionPaused`.
- `SetRecipe` is a non-virtual `UFUNCTION`; the potential/boost setters are
  virtual (base-class hooks can miss overrides — hence the delegates); all
  getters are `FORCEINLINE` (readable, not hookable).
- `RegisterInteractingPlayer` is "called from widgets" and not replicated —
  not relied on; `OnUse`/`OnUseStop` are documented as server and client.
- SML hooking on dedicated servers is undocumented; FRM ships a server-only
  module. Verified in the Part 1 spike.

## Follow-ups

- Update #14 to drop clock speed and Somersloop boost (now in v2).
- Update `docs/live-constructor-awareness.md` (or replace it with a live-world
  doc) and the receiver/plugin READMEs and protocol/query docs for v2.
