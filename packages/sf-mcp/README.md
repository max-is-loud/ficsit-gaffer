# @foreman/sf-mcp

The FICSIT Foreman **unified MCP server**. It serves two Satisfactory tool sets
from one [Model Context Protocol](https://modelcontextprotocol.io) endpoint:

- **Game-data tools** — answer *"how is anything in the game made?"* from the static
  game data, parsed by [`@foreman/sf-game-data`](../sf-game-data) and wrapped in an
  in-memory production graph ([`@foreman/sf-game-data-graph`](../sf-game-data-graph)).
- **Save-game tools** — answer *"what has this pioneer actually built, unlocked, and
  collected?"* from their live `.sav`, parsed by [`@foreman/sf-save-data`](../sf-save-data).

Together they let the foreman issue orders grounded in reality rather than
assumption. It runs standalone and can be wired directly into Claude Desktop.

> **Core principle:** tools return computed, distilled answers — not raw rows or
> save dumps. The graph makes recursive production queries cheap server-side; the
> save selectors extract the few facts the foreman needs. The model asks one
> question and gets one ready-to-use answer.

---

## Prerequisites

- Node.js 22+
- For the game-data tools: a copy of Satisfactory's `en-US.json` (ships at
  `<game install>/CommunityResources/Docs/en-US.json`, UTF-16 LE — the parser
  handles that). The stable channel is bundled, so this is optional.
- For the save-game tools: a Satisfactory save file (`.sav`). On a default install:
  - **Windows:** `%LOCALAPPDATA%\FactoryGame\Saved\SaveGames\<steam-id>\`
  - **Linux (Steam/Proton):** `…/steamapps/compatdata/<id>/pfx/drive_c/users/steamuser/AppData/Local/FactoryGame/Saved/SaveGames/`

## Install & build

From the repository root (npm workspaces):

```bash
npm install
npm run build -w @foreman/sf-mcp
```

## Pointing it at game data

The server loads a pre-built merged dataset (`sf-game-data.json`) in this priority
order — it no longer parses a raw `en-US.json` at runtime:

| Priority | Source | Meaning |
|---|---|---|
| 1 | `SF_GAME_DATA_PATH` | Full path directly to a merged `sf-game-data.json`. Highest priority. |
| 2 | Bundled channel | Committed game data under `packages/sf-game-data/data/<channel>/`, selected by `SATISFACTORY_GAME_CHANNEL` (default `stable`). Supplied via PRs — see [CONTRIBUTING.md](../../CONTRIBUTING.md). |

If none resolve, the game-data tools start with an empty dataset and log a warning
(they never crash). A leading `~` is expanded to your home directory. To build a
dataset for a custom game build, run the offline extractor — see
[`../sf-game-data/extract`](../sf-game-data/extract).

## Pointing it at a save

Set `SAVE_FILE_PATH` to the full path of a `.sav` to read by default (legacy/dev):

```bash
SAVE_FILE_PATH=/path/to/MySave.sav npm run dev -w @foreman/sf-mcp
```

If `SAVE_FILE_PATH` is unset the save tools start with no save loaded — they return
empty results rather than crashing. The save is re-parsed automatically when its
mtime changes, so progress shows up as you play without a restart.

In the hosted app, the backend uploads per-playthrough saves into a shared directory
(`SAVE_DATA_DIR`) and injects each tool call's `savePath`; the server LRU-caches one
parsed store per path. Paths outside `SAVE_DATA_DIR` are refused.

## Running

```bash
# Development (watch mode, runs TypeScript directly):
npm run dev -w @foreman/sf-mcp

# Production (after build):
npm run start -w @foreman/sf-mcp
```

By default the server speaks MCP over **stdio** — no network port; the client spawns
it and talks over stdin/stdout. All logging goes to stderr; stdout is reserved for
the protocol.

### HTTP transport (opt-in)

Set `MCP_TRANSPORT=http` to listen on a network port instead (MCP Streamable HTTP,
stateless), serving on `/mcp` with a `/health` endpoint:

```bash
MCP_TRANSPORT=http MCP_HTTP_HOST=0.0.0.0 MCP_HTTP_PORT=8723 \
  npm run start -w @foreman/sf-mcp
# → [foreman-sf-mcp] Listening on http://0.0.0.0:8723/mcp (health: /health)
```

| Variable | Default | Meaning |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | `stdio` or `http`. |
| `MCP_HTTP_HOST` | `0.0.0.0` | Bind host for http mode. |
| `MCP_HTTP_PORT` | `8723` | Port for http mode. |
| `SAVE_FILE_PATH` | — | Optional default save (legacy/dev). |
| `SAVE_DATA_DIR` | — | Directory host-injected `savePath` arguments must live under. |

> **Security:** the HTTP transport has **no authentication**. Only run it on a
> trusted localhost/LAN, or put an authenticating proxy in front of it.

### Docker

The container image ([`Dockerfile`](./Dockerfile)) bundles the stable game data and
defaults to HTTP on `:8723`. Gaffer publishes no images yet, so build the image from
the repository root. The `sf-mcp` service is part of the project
[`compose.yaml`](../../compose.yaml): run `docker compose up -d --build sf-mcp`. See
[Quick start (Docker)](../../README.md#quick-start-docker--recommended).

## Inspecting without an MCP client

Two debug CLIs exercise the tools directly (they print to stdout):

```bash
# Game-data tools:
npm run inspect:game-data -w @foreman/sf-mcp                                   # summary + tool list
npm run inspect:game-data -w @foreman/sf-mcp ingredient_tree '{"item":"Reinforced Iron Plate","targetPerMinute":5}'

# Save-game tools (point at a real save):
SAVE_FILE_PATH=~/saves/My.sav npm run inspect:save -w @foreman/sf-mcp          # overview
npm run inspect:save -w @foreman/sf-mcp -- get_player_state ~/saves/My.sav     # run a tool
npm run inspect:save -w @foreman/sf-mcp -- typepaths ~/saves/My.sav            # typePath histogram
```

## Wiring into Claude Desktop

Build first (`npm run build -w @foreman/sf-mcp`), then add to your Claude Desktop
config (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "foreman": {
      "command": "node",
      "args": ["/absolute/path/to/foreman/packages/sf-mcp/dist/index.js"],
      "env": {
        "SATISFACTORY_GAME_CHANNEL": "stable",
        "SAVE_FILE_PATH": "/absolute/path/to/MySave.sav"
      }
    }
  }
}
```

Restart Claude Desktop; the FICSIT Foreman tools appear in the tool list. Every
response is tagged with the detected game version.

---

## Tools

### Game data

| Tool | Description |
|---|---|
| `get_item(name)` | Resolve an item by display name or class name; returns form and sink points. |
| `list_items(search?)` | Discover canonical item/resource names (display + class); optional substring search. |
| `get_recipe(name)` | Full recipe: ingredients, products, machine, per-minute rates. |
| `list_recipes(search?)` | Discover canonical recipe names (display + class + isAlternate); optional substring search. |
| `recipes_for(item)` | All recipes that produce an item, including alternates; flags the standard. |
| `ingredient_tree(item, targetPerMinute, recipeChoices?)` | Flat per-minute requirements + machine counts for every tier. |
| `total_raw_inputs(item, targetPerMinute)` | Leaf raw resources only — what to mine/extract. |
| `full_production_line(item, targetPerMinute, recipeChoices?, assumptions?)` | Total build cost of the whole line, aggregated into one shopping list. Logistics figures are estimates. |
| `what_consumes(item)` | All recipes that use an item as an ingredient. |
| `compare_alternates(item)` | Side-by-side cost/throughput of every recipe producing an item. |
| `buildable_with(resources)` | Items producible from a set of raw resources (transitive closure). |
| `list_schematics(tier?)` / `get_schematic(name)` | Milestones/MAM/shop/hard-drive schematics. |
| `get_building(name)` / `list_power_generators()` | Building power/cost; full generator fuel breakdowns. |
| `list_buildings(search?, category?)` | Discover canonical buildable names (display + class + category); search by name or list a category. |
| `list_collectibles(type?)` / `nearest_collectibles(coord, type?, n?)` | Static world collectible totals + nearest-to-a-location, each with its stable identity (`guid` / `schematic`). |
| `resolve_collectibles(ids)` | Resolve collectible ids to their world facts (kind, coordinates, identity, unlock cost); reports unresolved ids. Backs explore-order ingest. |
| `nearest_resource_nodes(coord, resource?, purity?, n?)` | Resource nodes nearest a location, with resource type and purity. |
| `list_parts(item?)` / `nearest_parts(coord, item?, n?)` | Loose crash-site parts: world totals + nearest-to-a-location. |
| `describe_location(coord)` | Names the biome a location falls in (nearest biome for a coastal/cave point) + the within-biome bearing, so a position reads as "the north-west of the Grass Fields". Each `nearest_*` hit also carries its `biome`. |

### Save game

All save tools are read-only, tag every response with the detected game version +
save name, and accept a host-injected `savePath` (the model never sets it).

| Tool | Description |
|---|---|
| `get_player_state()` | Player + HUB location (metres), play time, and personal inventory. |
| `get_unlocked_recipes()` | Unlocked recipes, split into standard and alternate, with counts. |
| `get_milestones()` | Milestones by tier, Project Assembly phase, and unlocked MAM research trees. |
| `get_storage(location?)` | Storage container contents + dimensional depot; sortable nearest-first. |
| `get_collectibles()` | Exact per-kind collectible progress (worldTotal/collected/remaining). |
| `get_collected_identities()` | The collected identity set — looted-pod/destroyed-pickup GUIDs ∪ unlocked schematics. Backs explore-order re-upload reconciliation. |
| `get_nearby(location, kinds?, radius?, limit?)` | Un-collected collectibles near a location. |
| `get_nearby_parts(location, item?, radius?, limit?)` | Un-grabbed loose crash-site parts near a location. |
| `get_production(item?)` | Theoretical production capacity by output item, with an estimated power draw. |
| `get_power()` | Power-grid status per circuit: production, consumption, capacity, battery, and trip state. |
| `check_material_coverage(items)` | Whether the pioneer's on-hand + producible materials cover a set of item targets. |
| `find_bottlenecks(tolerance?)` | Steady-state flow analysis over the save's connection graph — throttled machines and starved links (via `@foreman/sf-flow`). |
| `describe_save(savePath)` | Host-internal: a save's identity (name, session/map, build/save version, play time). |

---

## Architecture

```
src/
  tools/gameData.ts   game-data graph MCP tools (zod schemas, version-tagged)
  tools/save.ts       save-game MCP tools
  gameData.ts         className → displayName index the save tools join against
  query/selectors.ts  pure, computed save read functions (proximity sort, grouping, …)
  store/              SaveStore (mtime-gated re-parse) + SaveStoreRegistry (per-path LRU)
  config.ts           transport + save-source resolution
  http.ts             opt-in Streamable HTTP transport (registers both tool sets)
  index.ts            server entry: graph + world + save registry, stdio transport
  scripts/            the inspectGameData / inspectSave CLIs
```

The `en-US.json` parser, types and bundled data live in
[`@foreman/sf-game-data`](../sf-game-data); the in-memory production graph in
[`@foreman/sf-game-data-graph`](../sf-game-data-graph); the `.sav` model in
[`@foreman/sf-save-data`](../sf-save-data). This package is a thin MCP server that
loads those libraries and registers their tools — see
[`docs/component-architecture.md`](../../docs/component-architecture.md).

## Attribution

The save tools build on [`@etothepii/satisfactory-file-parser`](https://github.com/etothepii4/satisfactory-file-parser)
(MIT, via `@foreman/sf-save-data`) to decode the binary `.sav` format — credit and
thanks to *etothepii*, and to the wider Satisfactory modding community whose format
documentation made this possible.
