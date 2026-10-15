# Gaffer for Satisfactory

*A live foreman for Satisfactory, descended from FICSIT Foreman.*

**Gaffer** is a derivative of Stuart Meeks's
[FICSIT Foreman](https://github.com/StuartMeeks/ficsit-foreman), taking it in its own
direction: live awareness of the factory floor. See [Origins](#origins) for what it
inherits and how it differs. The code, packages and Docker images still use the
`foreman` names until the rename planned before public release.

FICSIT Foreman is an AI companion for the game **Satisfactory**. It acts as your on-site
foreman: it knows the game, tracks where you are in it, and hands you a human-scaled
next step instead of an overwhelming blueprint — keeping the maths off your plate so
you can stay in the game. The foreman's personality is chosen by you during
onboarding; there is no hardcoded character.

This repository is a monorepo. It delivers the **game-data backbone** (an MCP server that
answers production questions accurately from real game data), the **foreman chat backend**
(a chat proxy — Anthropic or any OpenAI-compatible provider — with the foreman persona and
work-order persistence), and a **web UI** to talk to the foreman. All three run as services
in one Docker Compose project.

---

## What's in this release

| Package | Status | Purpose |
|---|---|---|
| [`packages/sf-mcp`](./packages/sf-mcp) | **Built** | The unified MCP server: game-data graph tools (loads the bundled merged dataset into an in-memory production graph) **and** live save-game tools (save-file parser exposing pioneer location, inventory, unlocks, milestones, remaining collectibles) from one endpoint. Works standalone with Claude Desktop. |
| [`packages/ff-server`](./packages/ff-server) | **Built** | Express backend: LLM chat proxy (Anthropic or OpenAI-compatible) with the foreman persona, MCP tool use, and stateful work-order persistence (see [`docs/work-orders.md`](./docs/work-orders.md)). |
| [`packages/ff-client`](./packages/ff-client) | **In progress** | React UI (Phase 3): foreman chat (streaming), active work-order panel, history, and onboarding/settings. Served on port `8725`. |

> FICSIT Foreman runs as a **Docker Compose project** named `foreman`: the `sf-mcp` server
> and backend are separate services in the one project (plus the web UI), so Docker
> Desktop keeps them grouped together under one start/stop.

---

## Quick start (Docker — recommended)

FICSIT Foreman ships as a Docker image with the latest **stable** game data baked in, so it runs
with **zero setup — you don't even need to find your game files**.

### Windows (Docker Desktop)

Most Satisfactory players are on Windows, so here's the full path:

1. Install **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** and start
   it. (It sets up the WSL 2 backend for you — just accept the prompts and let it finish.)
2. Save the [`compose.yaml`](./compose.yaml) from this repo into a folder (or copy this):

   ```yaml
   name: foreman
   services:
     sf-mcp:
       image: ghcr.io/stuartmeeks/foreman-sf-mcp:latest
       container_name: foreman-sf-mcp
       ports:
         - "8723:8723"
       restart: unless-stopped
   ```

   *(The snippet above is the MCP server on its own — all you need to use FICSIT Foreman
   from Claude Desktop. The full [`compose.yaml`](./compose.yaml) in this repo runs the
   whole stack: the `sf-mcp` server, the `server` backend (`:8724`), and the `web` UI (`:8725`).
   To run it all and chat with the foreman in your browser, set `ANTHROPIC_API_KEY` (or
   enter a key in the UI's settings) and run `docker compose up -d --build`, then open
   **<http://localhost:8725>**.)*
3. Open a terminal in that folder and run:

   ```powershell
   docker compose up -d
   ```

   *(GUI alternative: in Docker Desktop's **Images** tab, search
   `ghcr.io/stuartmeeks/foreman-sf-mcp`, click **Run**, expand **Optional settings**, set the
   name to `foreman-sf-mcp` and the host port to `8723`.)*
4. Confirm it's running: open **<http://localhost:8723/health>** — you should see
   `{"status":"ok","version":"1.2.3.1"}`.

**Start and stop it** any time from Docker Desktop's **Containers** tab (the `foreman`
project), or with `docker compose stop` and `docker compose start` — this keeps the
containers in place (they stay listed in Docker Desktop, just stopped). Use
`docker compose down` only when you want to **remove** the containers; your data
survives in the `foreman-db` volume either way. **Update** to a newer build with
`docker compose pull` then `docker compose up -d`.

> **Prefer not to install Docker Desktop?** On Windows 11 you can run the same images
> with WSL's built-in container runtime (`wslc`, public preview) instead — see
> [Installation — WSL Containers](https://github.com/StuartMeeks/ficsit-foreman/wiki/Installation-wslc)
> in the upstream wiki for the full walkthrough.

### macOS / Linux

Use the same `compose.yaml` (`docker compose up -d`), or a one-off container:

```bash
docker run -d --name foreman-sf-mcp -p 8723:8723 ghcr.io/stuartmeeks/foreman-sf-mcp:latest
```

> **Note:** the server speaks the MCP **Streamable-HTTP** protocol at
> `http://localhost:8723/mcp` — that endpoint is for MCP clients, not a web browser (a
> browser GET returns `405`). Use `/health` to check it's alive. It has **no
> authentication**, so keep it on your own machine or LAN, never the public internet.

---

## Using a specific game version (optional)

The image bundles the latest **stable** data. To use something else, set these in
`compose.yaml` (`environment:`) or via `docker run -e`:

- **Experimental channel:** `SATISFACTORY_GAME_CHANNEL=experimental`.
- **A newer or custom build:** the server loads a **pre-built merged dataset**, not a
  raw game install. Generate a `sf-game-data.json` with the offline extractor (it
  reads `en-US.json` + the cooked assets from your install — see
  [`packages/sf-game-data/extract`](./packages/sf-game-data/extract)) and point the
  server at it: `-e SF_GAME_DATA_PATH=/data/sf-game-data.json` (mount the file in).

---

## Run from source (Node.js)

Prefer not to use Docker, or want to develop on FICSIT Foreman? You'll need **Node.js 22+** and
**npm 10+** (Windows / macOS / Linux).

```bash
git clone https://github.com/max-is-loud/ficsit-foreman
cd ficsit-foreman
npm install
npm run build
npm test

# Try a tool against the bundled stable data (no game install needed):
npm run inspect:game-data -- total_raw_inputs '{"item":"Reinforced Iron Plate","targetPerMinute":5}'

# Run the unified sf-mcp server over HTTP (defaults to port 8723):
MCP_TRANSPORT=http npm run start:mcp
```

To wire the server into Claude Desktop over stdio, see
[`packages/sf-mcp/README.md`](./packages/sf-mcp/README.md).

---

## Configuration

All optional — by default the server serves the bundled **stable** game data.

**MCP server** (`packages/sf-mcp`):

| Variable | Description |
|---|---|
| `SATISFACTORY_GAME_CHANNEL` | Which bundled channel to use: `stable` (default) or `experimental`. |
| `SF_GAME_DATA_PATH` | Full path to your own merged `sf-game-data.json`, overriding the bundled data. |
| `MCP_TRANSPORT` | `stdio` (default, for Claude Desktop) or `http` to listen on a network port. |
| `MCP_HTTP_HOST` | HTTP bind host when `MCP_TRANSPORT=http` (default `0.0.0.0`). |
| `MCP_HTTP_PORT` | HTTP port when `MCP_TRANSPORT=http` (default `8723`). |
| `SAVE_FILE_PATH` | Optional fixed save (legacy/dev): path to a `.sav` to serve the save-game tools from. |
| `SAVE_DATA_DIR` | Directory host-injected `savePath` arguments must live under (the shared saves volume). |

**Backend** (`packages/ff-server`):

| Variable | Description |
|---|---|
| `LLM_PROVIDER` | `anthropic` (native Claude, default) or `openai` (OpenAI-compatible). |
| `LLM_API_KEY` | Hosted-tier key for the chosen provider. If unset, clients pass their own via the `x-anthropic-api-key` header. |
| `LLM_MODEL` | Model (default `claude-sonnet-4-6` / `gpt-4.1`). |
| `LLM_BASE_URL` | OpenAI-compatible base URL (OpenAI, OpenRouter, Gemini-compat, Azure). |
| `MCP_URL` | Where the backend reaches the unified sf-mcp server, game-data + save tools (Compose: `http://sf-mcp:8723/mcp`; bare metal default `http://127.0.0.1:8723/mcp`). |
| `SAVE_DATA_DIR` | Directory where uploaded playthrough saves are stored; shared with sf-mcp so it can read each save by the path the backend injects. |
| `PORT` | Backend HTTP port (default `8724`). |
| `DATABASE_URL` | Database connection (default `file:./dev.db`; Docker `file:/data/foreman.db`). For Postgres, use a `postgresql://` URL and switch the schema's datasource provider. |
| `BETTER_AUTH_SECRET` | Signs account session cookies. If unset, the server generates one on first start and persists it in the data volume (single-node deployments work out of the box). Set it explicitly (`openssl rand -base64 32`) for multi-instance or Postgres deployments. |
| `BETTER_AUTH_URL` | Public origin the app is served from (for correct cookies behind a proxy). Optional; derived from the request if unset. |
| `HISTORY_WINDOW` | Most-recent messages sent per chat request (default `20`). |
| `FOREMAN_BRIDGE_URL`, `FOREMAN_BRIDGE_QUERY_TOKEN`, `FOREMAN_BRIDGE_SERVER_ID`, `FOREMAN_BRIDGE_WORLD_ID`, `FOREMAN_BRIDGE_PLAYTHROUGH_ID` | Optional live Constructor awareness: link one bridge receiver world to one playthrough (all five or none). See [docs/live-constructor-awareness.md](docs/live-constructor-awareness.md). |

> The legacy `ANTHROPIC_*` variables still work when `LLM_PROVIDER` is `anthropic`.

### Using a different LLM provider

The foreman runs on Anthropic by default but works with any OpenAI-compatible
frontier provider. Set the provider on the server (covers everyone), or pick one
per player in the web UI's **Settings** (provider + model + your own key). For
example, to run the whole server on OpenRouter:

```bash
LLM_PROVIDER=openai
LLM_API_KEY=sk-or-...
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_MODEL=anthropic/claude-sonnet-4.5   # or any model OpenRouter offers
```

Tool-calling quality varies by model — the foreman leans on tools heavily, so a
strong frontier model gives the best results.

Resolution order for game data: `SF_GAME_DATA_PATH` → bundled channel
(`SATISFACTORY_GAME_CHANNEL`) → empty dataset with a warning. See
[`.env.example`](./.env.example) for the complete list.

---

## Contributing

Contributions are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the workflow
and conventions, including how to supply bundled `sf-game-data.json` game-data updates. Planned
work and open design questions live in the [issue tracker](https://github.com/max-is-loud/ficsit-foreman/issues) and on the
[Gaffer roadmap](https://github.com/users/max-is-loud/projects/4);
the parser and graph design are documented in [`PARSER.md`](./packages/sf-game-data/PARSER.md).

## Licence

[Apache 2.0](./LICENSE). Use it, fork it, build on it. Attribution for the upstream
project is in [`NOTICE`](./NOTICE).

## Disclaimer

Gaffer, like FICSIT Foreman before it, is an unofficial, community-made companion tool. It is **not affiliated
with, endorsed by, or sponsored by Coffee Stain Studios**. *Satisfactory*, *FICSIT*, and
all related names, logos, and game content are trademarks or property of Coffee Stain
Studios. Game data is read from files that ship with the game and remains their property.

## Origins

Gaffer began as a copy of [FICSIT Foreman](https://github.com/StuartMeeks/ficsit-foreman)
at upstream commit `3514182` (2026-10-01). Everything up to that point — the game-data
backbone, the foreman chat backend, work orders, the save subsystem and the web UI — is
Stuart Meeks's work, used under the [Apache 2.0](./LICENSE) licence; see [`NOTICE`](./NOTICE).

Gaffer is a separate project with its own [issue tracker](https://github.com/max-is-loud/ficsit-foreman/issues)
and [roadmap](https://github.com/users/max-is-loud/projects/4). Where FICSIT Foreman works
from uploaded saves, Gaffer adds near-real-time awareness of the game world through a
server-side SML bridge: what has been built, where the pioneer is, and whether work orders
have actually been met. Issue and PR numbers in commits and docs from before the split refer
to the [upstream tracker](https://github.com/StuartMeeks/ficsit-foreman/issues); the docs
label them "upstream #N". Generally useful fixes are kept in self-contained commits so they
can be offered back upstream.

## Attribution

FICSIT Foreman built by Stu · [GitHub](https://github.com/StuartMeeks) · [Reddit](https://www.reddit.com/user/sherman384)

Gaffer maintained by Maxime Langlois-Morin · [GitHub](https://github.com/max-is-loud)

## Independent SML bridge prototype

The private derivative includes a reviewed [SML companion bridge and independent
receiver](integrations/foreman-bridge/README.md). It observes constructors on a
dedicated server, delivers current state over HTTPS and replies through in-game
chat. It is separately built and tested. Foreman web chat can read its
Constructor observations for one explicitly linked playthrough through a
read-only receiver query — see [live Constructor awareness](docs/live-constructor-awareness.md).
