# Gaffer for Satisfactory — orientation for coding agents

**Gaffer** is an AI companion web app for *Satisfactory*: a configurable
"foreman" that issues structured work orders, answers game questions from real
game data, and adapts to the factory floor. It runs locally via Docker Compose.

Gaffer is a derivative of [FICSIT Foreman](https://github.com/StuartMeeks/ficsit-foreman)
(Apache-2.0), heading in its own direction: live awareness of the game world
through a server-side SML bridge. The code, packages and images still use the
`foreman` names until the pre-release rename (#15); keep using them until then.

This file is a **map**, not a spec — it points at the canonical docs and states
the conventions' home. Read the relevant doc before working in an area.
`CLAUDE.md` imports this file; edit `AGENTS.md`, never `CLAUDE.md`.

## Monorepo layout (npm workspaces)

```
packages/
  sf-core/            structural/identity kernel — class-name helpers (zero-dep lib)
  sf-present/         reusable presentation helpers — humaniseClassName + unit/bearing (zero-dep lib)
  sf-game-data/       GameData types + merged-dataset loaders + bundled data (lib).
                      The offline C# extractor (en-US.json + cooked assets → one
                      sf-game-data.json per channel) lives in extract/ (PARSER.md here)
  sf-game-data-graph/ in-memory production graph as a library (no database, no native addon)
  sf-save-data/       .sav → SaveState parser + normalise (lib)
  sf-mcp/             unified MCP server: game-data graph tools + live save-game tools
  ff-server/          Express backend: LLM proxy (SSE), sessions, work orders, MCP gateway
                      (the foreman system prompt lives here: SYSTEM_PROMPT.md)
  ff-client/          React + Vite web UI (chat + work-order cockpit)
docs/                 product.md · architecture.md · work-orders.md · playthroughs.md
```

## Where to find what

| You want… | Read |
|---|---|
| The product — problem, vision, features | [`docs/product.md`](./docs/product.md) |
| How it fits together — services, MCP boundary, graph, deployment | [`docs/architecture.md`](./docs/architecture.md) |
| The **target** component architecture — `sf-*`/`ff-*` packaging, reuse, community split | [`docs/component-architecture.md`](./docs/component-architecture.md) |
| The work-order design (states, revisions, audit, plan/execution split) | [`docs/work-orders.md`](./docs/work-orders.md) |
| Ingest-time verification of work-order quantities ([upstream #223](https://github.com/StuartMeeks/ficsit-foreman/issues/223)) — power reject + manufacturing advisory | [`docs/work-order-quantity-verification.md`](./docs/work-order-quantity-verification.md) |
| Explore orders ([upstream #207](https://github.com/StuartMeeks/ficsit-foreman/issues/207)) — collection-route order type + collectible re-upload reconciliation ([upstream #209-B](https://github.com/StuartMeeks/ficsit-foreman/issues/209)) | [`docs/explore-orders.md`](./docs/explore-orders.md) |
| The session/playthrough & foreman model (design) | [`docs/playthroughs.md`](./docs/playthroughs.md) |
| The first-party top-down base-map renderer ([upstream #246](https://github.com/StuartMeeks/ficsit-foreman/issues/246)) — landscape decode, water model, ocean/void, offline tool | [`docs/base-map-renderer.md`](./docs/base-map-renderer.md) |
| FGFoliage decode ([upstream #246](https://github.com/StuartMeeks/ficsit-foreman/issues/246) "other trees") — reading Satisfactory's custom ~3.3 M-instance foliage component | [`docs/base-map-foliage-decode.md`](./docs/base-map-foliage-decode.md) |
| The save subsystem (identity, re-upload history, same-game) — design & roadmap | [`docs/save-subsystem.md`](./docs/save-subsystem.md) |
| Crash-site loot & drop-pod unlock costs ([upstream #107](https://github.com/StuartMeeks/ficsit-foreman/issues/107)) — design | [`docs/crash-site-loot.md`](./docs/crash-site-loot.md) |
| The game-data parsing logic & class-map (implemented by the C# parser) | [`packages/sf-game-data/PARSER.md`](./packages/sf-game-data/PARSER.md) |
| The single-producer game-data pipeline (`sf-game-data-extractor`) — design | [`docs/sf-game-data-extractor.md`](./docs/sf-game-data-extractor.md) |
| The foreman persona (runtime prompt) | [`packages/ff-server/SYSTEM_PROMPT.md`](./packages/ff-server/SYSTEM_PROMPT.md) |
| A package's usage, tools, and setup | that package's `README.md` |
| Conventions (commit/PR/branch/code standards) and game-data updates | [`CONTRIBUTING.md`](./CONTRIBUTING.md) |

## Status

Phases 1 (game-data MCP) and 2 (backend & foreman chat) are complete and merged;
Work Orders v2 shipped. The web client (Phase 3) is in progress. The save-game MCP
shipped v1. The **single-producer game-data pipeline** shipped (epic [upstream #164](https://github.com/StuartMeeks/ficsit-foreman/issues/164)): an
offline C# extractor parses `en-US.json` and extracts the cooked assets into one
merged `sf-game-data.json` per channel, which the runtime loads directly — the raw
`en-US.json` is no longer committed. Since then: **explore orders** (a second
work-order type — collection routes with save-reupload reconciliation, [upstream #207](https://github.com/StuartMeeks/ficsit-foreman/issues/207)/[upstream #209](https://github.com/StuartMeeks/ficsit-foreman/issues/209)),
**ingest-time verification** (every plan reference resolved-or-rejected + power/
recipe quantity checks, [upstream #222](https://github.com/StuartMeeks/ficsit-foreman/issues/222)/[upstream #223](https://github.com/StuartMeeks/ficsit-foreman/issues/223)), and a **flow solver** (`sf-flow` +
`find_bottlenecks`, [upstream #148](https://github.com/StuartMeeks/ficsit-foreman/issues/148)/[upstream #126](https://github.com/StuartMeeks/ficsit-foreman/issues/126)) shipped, and the game-data graph **dropped Kùzu**
for an in-memory adjacency projection ([upstream #243](https://github.com/StuartMeeks/ficsit-foreman/issues/243)) — no `sf-*` package carries a native
dependency now. Gaffer's own work — starting with live-world awareness via the
SML bridge (`integrations/foreman-bridge`) — is tracked in Gaffer's
[issue tracker](https://github.com/max-is-loud/ficsit-gaffer/issues) and on the
[Gaffer roadmap](https://github.com/users/max-is-loud/projects/4) board.

## Conventions

All commit / branch / PR / issue / code-standard conventions live in
[`CONTRIBUTING.md`](./CONTRIBUTING.md) — follow them exactly. In brief: Conventional
Commits with a required body; `feature/`-style branches; never commit to `main`;
squash-merge; British English in comments and docs; AI-generated PRs open with the
`🤖 AI-generated PR` line. When filing an issue, give it a type label, an `area:`
label and a milestone.

## Code standards — non-negotiable

Full text, with the enforcement details, in
[`CONTRIBUTING.md` › Code standards](./CONTRIBUTING.md#code-standards).

1. Descriptive names; single letters only for `i j k x y z _`.
2. Every non-test source file opens with a header comment; comments explain *why*, and non-obvious exports document their contract.
3. One responsibility per file: over 300 lines is a warning, over 500 fails.
4. Functions of at most 60 lines, depth 3, complexity 12 and 4 parameters.
5. Add new kinds of thing as registry or table entries, not as new `if`/`switch` arms.

Never add to a ratchet list (`source-limits.json`, `eslint-suppressions.json`),
never raise a recorded count, and never add an ESLint suppression by hand. When
you fix a violation, lower the record (`npm run check:source -- --update`,
`npm run lint:prune` in the package you changed; the root script covers only
root tooling). Run `npm run lint` and `npm run check:source` before
committing.

## Gaffer is its own project — rules for agents

- **Never create issues, PRs, comments, labels or board items on upstream**
  (`StuartMeeks/ficsit-foreman`). The `upstream` git remote is read-only, for
  fetching and cherry-picking. `gh` defaults to `max-is-loud/ficsit-gaffer`
  (`gh repo set-default`); pass `-R max-is-loud/ficsit-gaffer` if unsure.
- **Every new issue goes on the Gaffer roadmap board** (user project 4) with a
  status. The `gh issue create --project` flag fails on this board, so add it
  separately:

  ```sh
  url=$(gh issue create -R max-is-loud/ficsit-gaffer --title "…" --body-file body.md \
    --label "enhancement,area:ff-server" --milestone "Live world")
  gh project item-add 4 --owner max-is-loud --url "$url"
  ```

  New items start in **Backlog**; move them to Todo → In Progress as work is
  scheduled and started. Closing the issue moves it to Done.
- **Issue references:** a bare `#N` means a Gaffer issue or PR. References to the
  upstream tracker are written as links labelled `upstream #N`
  (`[upstream #207](https://github.com/StuartMeeks/ficsit-foreman/issues/207)`).
  Issue numbers in commit messages before the split (`3514182`) are upstream's.
- **Keep generic fixes upstreamable** — in self-contained commits, not tangled
  with Gaffer-only changes (see "Contributing upstream" in `CONTRIBUTING.md`).

## External documentation — consult Context7 first

For anything to do with **Unreal Engine** or **Satisfactory modding** (SML, the
`foreman-bridge` mod, mod tooling, FICSIT-Networks, Remote Monitoring, game
classes and engine APIs), look it up in Context7 (`query-docs`) **before**
answering from memory or writing code; treat it as the source of truth over
training data. Cite what you used when it shapes a decision. If Context7 has
nothing on the point, say so and fall back to the upstream sites.

| Topic | Context7 library ID |
|---|---|
| Satisfactory modding (SML) docs | `/websites/ficsit_app_satisfactory-modding` |
| Satisfactory modding — development guides | `/websites/ficsit_app_satisfactory-modding_development` |
| Satisfactory modding — documentation hub | `/websites/ficsit_app_satisfactory-modding-documentation` |
| ficsit.app (mod repository, all hosted docs) | `/websites/ficsit_app` |
| Satisfactory Mod Manager | `/satisfactorymodding/satisfactorymodmanager` |
| FICSIT-Networks | `/websites/ficsit_app_ficsit-networks` |
| FICSIT Remote Monitoring | `/websites/ficsit_app_ficsitremotemonitoring` |
| Unreal Engine (official docs, C++ API) | `/websites/dev_epicgames_unreal-engine` |
| Unreal Engine C++ coding standard | `/websites/dev_epicgames_unreal-engine_epic-cplusplus-coding-standard-for-unreal-engine` |

Satisfactory ships a customised Unreal Engine 5 build, so the modding docs win
where they disagree with the stock Unreal docs.

## Dev environment note

Development happens on a Proxmox VM over SSH. The Satisfactory game files are **not**
accessible from the VM. A copy of `en-US.json` may be placed at `game-data/en-US.json`
(gitignored) for the **offline extractor** to parse (`--enus`); it is **not** read at
runtime and is never committed. The VM and the running server load the bundled merged
`sf-game-data.json` (or `SF_GAME_DATA_PATH`). The C# extractor itself only builds/runs
on the Windows host (CUE4Parse + a game install) — do not assume a game directory is
mounted at runtime.
