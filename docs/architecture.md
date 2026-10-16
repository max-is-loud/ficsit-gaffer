# FICSIT Foreman — Architecture

How the system fits together **today**. For the product "why", see [`product.md`](./product.md);
for the work-order feature, [`work-orders.md`](./work-orders.md); for the session/playthrough &
foreman model (design), [`playthroughs.md`](./playthroughs.md); for the parser,
[`packages/sf-game-data/PARSER.md`](../packages/sf-game-data/PARSER.md).

> **Target architecture:** the packages are intended to split into reusable
> Satisfactory components (`sf-*`) and the Ficsit Foreman app (`ff-*`) — see
> [`component-architecture.md`](./component-architecture.md). That refactor is
> sequenced foreman-first; the layout below is the current state.

---

## Services

FICSIT Foreman is a monorepo of npm-workspace packages that run as separate
services under one `foreman` Docker Compose project.

```
┌──────────────────────────────────────────────────────────┐
│                   Web App (React) — packages/ff-client    │
│   Foreman chat (streaming)   ·   Work-order panel + history│
└───────────────────────────────┬──────────────────────────┘
                                │ REST + SSE  (/api proxied by nginx)
┌───────────────────────────────▼──────────────────────────┐
│             Backend (Node/Express) — packages/ff-server    │
│  · LLM proxy (Anthropic or OpenAI-compatible), SSE stream  │
│  · playthrough + work-order persistence (Prisma/SQLite→PG) │
│  · MCP gateway: one client to the unified sf-mcp server ↓  │
└───────┬───────────────────────────────────────────┬──────┘
        │ MCP (Streamable HTTP)                       │ LLM API
┌───────▼─────────────────────────────────────┐   ┌──▼─────────────┐
│ sf-mcp                                       │   │ Claude / OpenAI │
│  · game-data tools: parser + in-mem graph +  │   │ -compatible     │
│    world locations — "how is it made?"       │   │ foreman persona │
│  · save-game tools: live save state          │   │                 │
│    — player, unlocks, collectibles, …        │   │                 │
└──────────────────────────────────────────────┘   └─────────────────┘
        └── built on sf-game-data / sf-game-data-graph / sf-save-data ──┘
```

The unified **sf-mcp** server hosts two tool sets on one endpoint: **game-data
tools** answer *"how is anything in the game made?"* from static game data, and
**save-game tools** answer *"what has this pioneer actually built/unlocked/
collected?"* from their live save. The backend reaches it with a single MCP
client, injecting the active playthrough's save path into each tool call (see
[`packages/ff-server/README.md`](../packages/ff-server/README.md)).

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Frontend | React + TypeScript + Vite | Fast dev, strong ecosystem |
| Backend | Node.js + Express + TypeScript | Unified language across the stack |
| MCP servers | TypeScript (official MCP SDK) | Same stack everywhere |
| Production graph | In-memory adjacency (no DB) | Dataset is tiny (~320 recipes); item→recipe maps + TS traversal beat a native graph DB — no daemon, no native addon, instant load |
| App DB | SQLite (dev) → Postgres (prod) | Zero local setup; clean migration path |
| ORM | Prisma | Readable schema, good migrations |
| Auth | Better Auth (self-hosted) | Email+password now, passkeys/TOTP next; HttpOnly-cookie sessions; Prisma adapter |
| Deployment | Docker Compose (local) + Railway/Render (hosted) | Laptop → production with the same images |
| Repo | Monorepo (`sf-core`, `sf-game-data`, `sf-game-data-graph`, `sf-save-data`, `sf-mcp`, `ff-server`, `ff-client`) | Easy to navigate |

## Accounts & identity

Using the app requires an account. Identity is a **user** (email + password as the
first factor), managed by [Better Auth](https://better-auth.com) mounted at
`/api/auth/*` with **HttpOnly-cookie** sessions — no auth token is exposed to client
JavaScript. Every **playthrough** (and through it its messages and work orders) and
every **foreman** is scoped to a `userId`; the API rejects unauthenticated calls (401)
and cross-user access (403). The pioneer's own LLM API key stays **client-side** as
before — it is never sent to or stored by the server beyond the per-request header it
authorises.

Better Auth owns four tables (`user`, `account`, `verification`, and its session
table, mapped to **`AuthSession`** so it does not collide with our domain
`Playthrough` — a play session, see [`playthroughs.md`](./playthroughs.md)). On first
sign-in the browser's existing pre-accounts playthrough is **claimed** for the new
user, so anonymous work done before signing up is not lost. Opt-in MFA (passkeys and
TOTP + recovery codes, with a 30-day "trust this device") is the next slice.

## Computed-answers principle

MCP tools return **computed, distilled answers — not raw rows.** The graph exists
to make recursive production queries cheap; the token saving comes from pushing
computation server-side. For example, `ingredient_tree` returns a flat per-minute
requirement list and machine counts, not nested recipe objects the model must
reduce itself. The foreman asks one question and gets one useful answer.

## Game data: source of truth

Satisfactory ships `<install>/CommunityResources/Docs/en-US.json` — machine-readable
data for all items, recipes, buildings, and rates. FICSIT Foreman parses it with a
**purpose-built, hand-written parser** (no third-party parsing libraries), builds
the in-memory production graph from it, and tags it to the detected game version.
Bundled copies per release
channel ship with the game-data package so it works out of the box; players can
also point at a local install. Version support is additive. The full parser design
is in [`packages/sf-game-data/PARSER.md`](../packages/sf-game-data/PARSER.md).

## Production graph (in-memory)

`@foreman/sf-game-data-graph` wraps the parsed `GameData` in a query facade — no
database. The nodes (items, recipes, buildings, schematics) and their nested
relationships (a recipe's ingredients/products/producedIn, a building's build
cost, a schematic's unlocks) already live fully-resolved on the parsed objects,
with `perMinute` precomputed at parse (`amount * 60 / durationSeconds`).

Relationship queries — *what produces / consumes an item* — read two adjacency
maps built once from the recipe set (`item className → producing recipes` and
`→ consuming recipes`). Everything else (full recipe/item/schematic detail,
building lookups) reads `GameData` directly. The recursive work — ingredient-tree
demand roll-up, topological ordering, the buildable-with fixpoint closure — runs
in TypeScript over those maps. The dataset is small (~320 recipes), so this beats
an embedded graph DB on every axis: no native addon, no daemon, near-instant load.

## Tool surface

The full, authoritative MCP tool reference lives with the server package,
[`packages/sf-mcp/README.md`](../packages/sf-mcp/README.md): the game-data tools
(recipes, ingredient trees, raw inputs, alternates, schematics, buildings,
world-location queries) and the save-game tools
(player state, unlocks, milestones, storage, remaining collectibles). Name
resolution (displayName or className) is transparent — the foreman never needs
internal class names.

## Work orders

Work orders are application state owned by `packages/ff-server` (not an MCP server):
stateful, auditable records with a plan/execution split, revision snapshots, an
audit trail, and parent/child relationships. The canonical design is
[`work-orders.md`](./work-orders.md).

## Deployment

- **Local (recommended):** `docker compose up -d --build` from the repo root runs
  the whole stack (see the root [`README.md`](../README.md) for the quick start and
  the [`.env.example`](../.env.example) for configuration).
- **Bare metal:** Node.js 22+ / npm 10+, `npm install && npm run dev`.
- **Hosted:** Railway/Render — the same images, Postgres in place of SQLite,
  environment variables in place of `.env`.

## Status / history

Built in phases: **1** (game-data MCP) and **2** (backend & foreman chat) are
complete; **3** (web UI) is in progress; the **save-game MCP** (originally Phase 4)
shipped v1 early. Live, per-component work is tracked in the
[issue tracker](https://github.com/max-is-loud/ficsit-gaffer/issues) and on the [Gaffer roadmap](https://github.com/users/max-is-loud/projects/4); work from before
the split is in the [upstream tracker](https://github.com/StuartMeeks/ficsit-foreman/issues).
