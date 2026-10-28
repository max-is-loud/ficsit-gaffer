# @foreman/ff-server

The FICSIT Foreman backend — the Express service that sits between the web client
and the LLM provider. It runs the foreman persona, streams chat responses, calls
the unified `sf-mcp` server (game-data + save-game tools) for accurate game data
and live save state, and persists sessions and work orders.

It runs as the `server` service in the `foreman` Docker Compose project,
alongside `sf-mcp`.

## What it does

- **Chat proxy.** Streams the foreman's responses over Server-Sent Events while
  running the tool-use loop server-side: the model calls MCP game-data tools and
  work-order tools, and the server feeds the results back until the foreman
  produces a final answer.
- **Multiple providers.** Native Anthropic, or any OpenAI-compatible API
  (OpenAI, OpenRouter, Gemini-compat, Azure) via a base URL — see the provider
  seam below. `LLM_PROVIDER` selects the default; a client can override per
  request.
- **Accounts.** Using the app requires an account. [Better Auth](https://better-auth.com)
  (mounted at `/api/auth/*`) provides email + password with HttpOnly-cookie sessions;
  every playthrough and its data is scoped to a user. The pioneer's own LLM key still
  stays client-side. See `BETTER_AUTH_*` in `.env.example`.
- **Foremen & playthroughs.** A **foreman** is a reusable persona (its
  `{{PERSONALITY}}`); a **playthrough** is one save's journey, attached to a
  foreman and carrying its own `{{PIONEER_PROFILE}}`, chat history, and work
  orders (see [`docs/playthroughs.md`](../../docs/playthroughs.md)).
- **Foreman persona.** Loads `SYSTEM_PROMPT.md` once at startup and substitutes
  the attached foreman's `{{PERSONALITY}}` and the playthrough's
  `{{PIONEER_PROFILE}}` per request.
- **Two key tiers.** Free tier — the client passes its own provider key in the
  `x-anthropic-api-key` header (and may pick provider/model in the chat body).
  Hosted tier — the server uses its own `LLM_API_KEY`. The header wins when both
  are present.
- **Work orders (v2).** Stateful, auditable records with a plan/execution split —
  see the canonical [`docs/work-orders.md`](../../docs/work-orders.md). The foreman
  drives the plan via tools (`create_work_order`, `create_explore_order`,
  `revise_work_order`, `block_work_order`/`unblock_work_order`/`supersede_work_order`,
  `create_child_work_order`) and may only `propose_completion` — **completion is
  Pioneer-only** (via REST/UI). Two order types share this machinery: **build**
  orders and **explore** orders (collection routes of waypoints). Every plan
  reference is resolved against game data and **rejected at ingest** if unresolvable,
  and quantities are verified (power over-provision is hard-rejected; recipes and
  per-minute rates are server-derived). Creating an order no longer abandons the
  current one; supersession is explicit. Sequence numbers are per-playthrough and
  monotonic (WO-001 for build, EO-001 for explore); at most one order is `active`
  at a time, though non-terminal orders may coexist (a blocked parent + an active
  child). Plan edits write acknowledged **revision snapshots**; execution changes
  (checklists, machine counts, hours) append to an **audit trail**.
- **Windowed history.** Only the most recent N messages (default 20) are sent
  with each request.

## API

All routes are under `/api`. **Authentication is required** — Better Auth owns
`/api/auth/*` (email + password; HttpOnly-cookie sessions), and every other
`/api/*` route rejects unauthenticated requests with 401. Foremen and playthroughs
are owned by a user: reads/updates of one you don't own return 403. Send requests
with credentials (cookies) included.

| Method | Path | Purpose |
|---|---|---|
| `POST`/`GET` | `/api/auth/*` | Better Auth: sign-up/sign-in (email), sign-out, session. |
| `POST` | `/api/foremen` | Create a reusable foreman (persona) owned by the caller. |
| `GET` | `/api/foremen` | List the caller's own foremen. |
| `GET`/`PATCH`/`DELETE` | `/api/foremen/:id` | Fetch, edit (name/personality), or delete a foreman you own. |
| `POST` | `/api/playthroughs` | Create a playthrough owned by the caller (requires `foremanId`; optional name/profile). |
| `GET` | `/api/playthroughs` | List the caller's own playthroughs. |
| `GET` | `/api/playthroughs/:id` | Fetch a playthrough you own. |
| `POST` | `/api/playthroughs/:id/claim` | Claim a pre-accounts anonymous playthrough on first login. |
| `PATCH` | `/api/playthroughs/:id` | Update name, pioneer profile, and/or attached foreman (effective next message). |
| `DELETE` | `/api/playthroughs/:id` | Delete a playthrough — cascades its messages + work orders, removes its save files. |
| `GET` | `/api/playthroughs/:id/messages` | Recent chat history (chronological) for re-hydrating the conversation. |
| `POST` | `/api/playthroughs/:id/save` | Upload a `.sav` (multipart `save`); adds a version, makes it current, parses metadata, reconciles collectibles on explore orders. |
| `GET` | `/api/playthroughs/:id/saves` | List the playthrough's save versions (newest first). |
| `POST` | `/api/playthroughs/:id/saves/:saveId/activate` | Re-activate an earlier save version as current. |
| `DELETE` | `/api/playthroughs/:id/saves/:saveId` | Delete a save version (promotes the newest remaining if it was current). |
| `POST` | `/api/saves/preview` | Parse an uploaded save's identity and find the caller's matching (same-game) playthroughs. |
| `POST` | `/api/playthroughs/:id/chat` | Send a message; streams the response over SSE. |
| `POST` | `/api/playthroughs/:id/work-orders` | Create a work order (starts in `new`; does not abandon others). |
| `GET` | `/api/playthroughs/:id/work-orders` | Full work-order history. |
| `GET` | `/api/playthroughs/:id/work-orders/active` | The current active order (404 if none). |
| `GET` | `/api/playthroughs/:id/work-orders/:woId` | A single order (also `/children`, `/parent`). |
| `PATCH` | `…/work-orders/:woId/plan` | Foreman plan edit (writes a revision). |
| `POST` | `…/work-orders/:woId/transitions` | Lifecycle action: start/pause/resume/block/unblock/complete/force-complete/cancel/supersede. |
| `PATCH` | `…/work-orders/:woId/steps/:stepId` · `…/steps/:stepId/buildables/:buildableId` | Pioneer execution updates on build orders (check/uncheck a step, set a buildable's built count). |
| `PATCH` | `…/work-orders/:woId/waypoints/:waypointId/collectibles/:collectibleId` | Pioneer execution update on explore orders (mark a collectible collected). |
| `POST` | `…/work-orders/:woId/hours` · `/acknowledge` · `/revert` | Log hours, acknowledge a revision, revert to a revision. |
| `GET` | `…/work-orders/:woId/audit` · `/revisions` · `/revisions/:n` · `/revisions/diff` | Audit trail, revision history, a single revision snapshot, field-level diff. |
| `GET` | `/health` | Liveness + model/MCP/game-version info. |

The full work-order surface (every transition, required fields, and actor rules)
is specified in [`docs/work-orders.md`](../../docs/work-orders.md).

### Chat SSE events

The chat endpoint streams named events: `text` (`{ delta }`), `tool_use`
(`{ name }`), `work_order` (the full order, whenever the foreman creates, revises,
or otherwise changes one), `done` (`{ ok }`), and `error` (`{ message }`).

## Configuration

See the root [`.env.example`](../../.env.example) for the full, commented list.
Key variables: `LLM_PROVIDER` (`anthropic` default, or `openai`), `LLM_API_KEY`
(optional hosted key; `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` honoured too),
`LLM_MODEL` (default `claude-sonnet-4-6`), `LLM_MAX_TOKENS` (default `16000`) — the
maximum output tokens for each model call, tool-call arguments included; lower it
for a model that accepts fewer, `LLM_BASE_URL` (OpenAI-compatible
endpoint), `MCP_URL` (default `http://127.0.0.1:8723/mcp` — the unified sf-mcp
server, whose save-game tools let the foreman read player location and remaining
collectibles), `SAVE_DATA_DIR` (where uploaded playthrough saves are stored,
shared with sf-mcp), `DATABASE_URL` (default `file:./dev.db`;
set a `postgresql://` URL and switch the schema's datasource provider for prod),
`BETTER_AUTH_SECRET` (signs session cookies; auto-generated + persisted if unset —
set it explicitly for multi-instance/Postgres),
`SAVE_DATA_DIR` (where uploaded playthrough saves are stored — `<id>.sav` per
playthrough; defaults next to the database, e.g. `/data/saves`; must be a volume
shared with sf-mcp),
`PORT` (default `8724`), `HISTORY_WINDOW` (default `20`) — the conversation
history window (message count) sent to the model each turn, and the threshold
(2×) at which a playthrough is summarised. This is the server/hosted default; a
**BYOK** request (one supplying its own key via `CLIENT_KEY_HEADER`) may override
it per request with a `historyWindow` field in the chat body (clamped to 2–100).
Subscription/hosted requests always use this default.

## Running

### With Docker Compose (recommended)

From the repo root, the `server` service builds and runs alongside `mcp`:

```bash
docker compose up -d --build
```

The backend listens on `http://localhost:8724`; the MCP server on `:8723`.

### Bare metal

```bash
# from the repo root
npm install
npm run db:migrate -w @foreman/ff-server     # create the local SQLite database
npm run dev:server                         # start with hot reload on :8724
```

The MCP server must be reachable at `MCP_URL` (run `npm run dev:mcp` with
`MCP_TRANSPORT=http`, or the mcp container).

## Database

Prisma + SQLite for local dev (`DATABASE_URL=file:./dev.db`); the same schema
migrates to Postgres for hosted deployment. Complex work-order fields (arrays,
nested objects) are stored as JSON-encoded TEXT so the schema is portable across
both providers without change.

- `npm run db:migrate -w @foreman/ff-server` — create/apply a dev migration.
- `npm run db:deploy -w @foreman/ff-server` — apply pending migrations (used by the
  container at startup).

### Data persistence across upgrades

In Docker, the database lives in the `foreman-db` **named volume** (mounted at
`/data`), which has a lifecycle independent of the container. Your sessions and
work orders therefore survive upgrades:

| Action | Data |
|---|---|
| `git pull` then `docker compose up -d --build` (recreate on a rebuilt image) | safe |
| `docker compose stop` / `start` / `restart` | safe |
| `docker compose down` | safe — named volumes are not removed |
| `docker compose down -v`, or removing the volume | **deleted** |

On startup the container runs `prisma migrate deploy`, which applies only pending
migrations to the existing database in place — additive, never destructive. So a
new release migrates your live data forward without loss; the only way to lose it
is the explicit `-v`.

**Prefer a folder you control?** Swap the named volume for a host bind mount in
`compose.yaml` (`- ./data:/data`); the database then lives in `./data` next to the
compose file.

**Back up** the volume any time:

```bash
docker run --rm -v foreman-db:/data -v "$PWD:/backup" busybox \
  tar czf /backup/foreman-db.tgz /data
```

## LLM providers

The chat loop is provider-agnostic. It speaks the neutral types in
`src/llm/types.ts` and depends only on the `LlmProvider` interface
(`src/llm/provider.ts`); each adapter translates to and from its own wire
format:

- `src/llm/anthropic.ts` — native Anthropic (streaming + tool_use blocks).
- `src/llm/openai.ts` — any OpenAI Chat Completions-compatible API; the base URL
  selects the concrete provider. `consumeOpenAiStream` assembles streamed
  tool-call fragments.
- `src/llm/factory.ts` — `createProvider(config)` picks the adapter.

To add a provider, implement `LlmProvider` and wire it into `createProvider`.
The chat loop, summariser, and routes need no changes.

## Testing

```bash
npm run test -w @foreman/ff-server
```

Tests run against an isolated temporary SQLite database and inject a fake
`LlmProvider` and a fake MCP gateway — no SDKs, live API calls, or network
needed. `test/openai-stream.test.ts` unit-tests the OpenAI tool-call assembly.
