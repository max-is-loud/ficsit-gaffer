# Live Constructor awareness

Foreman's web chat can answer "how many Constructors do I have, and where?" for
**one dedicated-server world explicitly linked to one playthrough**, without a
save upload. The observations come from the
[Foreman bridge](../integrations/foreman-bridge/README.md): a server-side SML
plugin reports Constructor placement/removal to an independent HTTPS/SQLite
receiver, and Foreman reads the receiver's committed state through a read-only
query.

Design: [`docs/superpowers/specs/2026-10-14-live-constructor-awareness-design.md`](superpowers/specs/2026-10-14-live-constructor-awareness-design.md).
Query contract: [`receiver/docs/query-v1.md`](../integrations/foreman-bridge/receiver/docs/query-v1.md).

```text
Game plugin ──(producer token)──▶ receiver ingestion ──▶ committed state (SQLite)
                                                            ▲
                                     read-only HTTPS query  │ (query token)
Web chat ──▶ owned, linked playthrough ──▶ ff-server get_live_constructor_state
```

The receiver is the **only** store of live state; Foreman keeps no copy.

## What it does and does not cover

- Constructor presence, the exact count for the receiver's committed state, and
  each Constructor's recorded world position.
- Not other buildings, recipes, power, production rates or whether a machine is
  running. Not automatic work-order progress. No in-game questions, map or UI.
- One receiver world ↔ one playthrough. Linking is manual operator
  configuration; it does **not** prove an uploaded save belongs to that world.
  Keep the pairing correct yourself.
- Not a production deployment or large-factory certification.

## Setup

### 1. Receiver: add a separate read-only credential

Give the receiver's private config (mode 0600) a `queryToken` distinct from the
producer `token`; both use 32–256 characters of `A-Z a-z 0-9 _ -`:

```json
{
  "token": "<producer token — game plugin only>",
  "queryToken": "<read-only token — Foreman only>",
  "serverId": "<uuid>",
  "worldId": "<uuid>",
  "host": "0.0.0.0",
  "port": 9443,
  "databasePath": "/absolute/private/receiver.db",
  "certPath": "/absolute/private/server.pem",
  "keyPath": "/absolute/private/server-key.pem"
}
```

| Credential | Can | Cannot |
| --- | --- | --- |
| `token` (producer) | hello, snapshot chunk/commit, exchange | query |
| `queryToken` (read-only) | `POST /query/v1/constructors` | any ingestion route |

Equal tokens fail startup; omitting `queryToken` disables the query route.
Neither token reaches the browser or the model, and neither is logged. Restart
the receiver (`node src/main.mjs --config /absolute/private/receiver.json`) with
this repository's receiver code. Existing receiver databases migrate on open.
The game plugin and its native protocol are unchanged.

### 2. TLS trust

Foreman verifies the receiver certificate (chain **and** hostname/IP SAN) and
never follows redirects. For a private CA such as the one from
`receiver/scripts/make-test-cert.sh`, start ff-server with the public CA file:

```sh
NODE_EXTRA_CA_CERTS=/absolute/path/receiver-ca.pem npm run start -w @foreman/ff-server
```

`NODE_EXTRA_CA_CERTS` is read once at process start (set it in the container
environment and mount the file under Docker). There is no option to disable
verification. `FOREMAN_BRIDGE_URL` must use a host name or IP that appears in
the certificate's SAN.

### 3. Foreman: bind the world to one playthrough

Create the playthrough in the web app first (it must be owned by the account
that will chat), then set all five variables (see `.env.example`):

```sh
FOREMAN_BRIDGE_URL=https://receiver.example:9443
FOREMAN_BRIDGE_QUERY_TOKEN=<receiver queryToken>
FOREMAN_BRIDGE_SERVER_ID=<receiver serverId>
FOREMAN_BRIDGE_WORLD_ID=<receiver worldId>
FOREMAN_BRIDGE_PLAYTHROUGH_ID=<playthrough id>
```

- All unset: disabled. Some set: startup fails naming the missing variables.
- The URL must be a bare HTTPS origin (no credentials, path, query or fragment).
- IDs must match the receiver's lowercase UUIDs; every response's
  `serverId`/`worldId` is checked against them.
- Startup logs a warning if the linked playthrough does not exist or has no
  owner. Clients cannot create a playthrough with the linked id, and nobody
  but its current owner can claim it, so deleting the linked playthrough (or
  binding an unowned one) cannot hand the world to another account: re-link to
  a new, owned playthrough id instead.

## How chat uses it

Only the linked playthrough sees the `get_live_constructor_state` tool, and the
normal session + playthrough-ownership checks run first. The model may pass only
`includeLocations`, `limit` (1–100, default 50) and `cursor`; it cannot choose a
receiver, credential, world or playthrough. Each call is one HTTPS request with a
five-second total deadline and a 256 KiB response cap, with no retries. A failure
is reported to the model as "unavailable" while game-data, save and work-order
tools keep working; the player can simply ask again.

Answers keep sources apart: live observations are labelled separately from
uploaded-save data, and the model is told to query again for every claim about
current Constructors rather than reuse earlier messages or the session summary.

### Counts and locations

`totalConstructors` is the exact count for the receiver's committed state. Pages
of positions are bounded; a page of 50 does not mean 50 exist, and a partial
list is flagged (`locationsComplete: false`) with a `nextCursor`. If the world
changes between pages the cursor is rejected and listing restarts; pages from
different states are never combined.

### Coordinates

Positions are the actor's Unreal world location `[X, Y, Z]` in **centimetres**
as recorded by the plugin; the tool also gives `positionMetres` (÷ 100), the unit
Foreman's game-data world tools such as `describe_location` take. A coordinate
does not identify a base or the player's location, and the foreman is told not
to invent descriptions like "near your base".

## Freshness, restart and recovery

| Receiver state | Chat sees |
| --- | --- |
| No complete baseline yet | Unavailable — count unknown, not zero |
| Committed empty world | Zero, with normal freshness |
| Accepted synchronisation < 15 s ago | Recently synchronised |
| No accepted synchronisation for ≥ 15 s | Last known, with last sync time |
| Game resending a full snapshot | Previous state, last known |
| Receiver restarted, not yet re-synchronised | Persisted state, last known |
| Receiver unreachable or invalid reply | Unavailable; ordinary chat continues |

Synchronisation means the receiver committed a validated snapshot or accepted an
exchange from the active connection — including an idle exchange with no events.
Queries, health checks, hello, staged snapshot chunks, failed transactions and
fenced connections never refresh it. Freshness uses a monotonic clock inside the
receiver process, so a wall-clock change or a restart cannot make old state look
fresh. An accepted exchange proves that batch arrived, not that every queued game
event has; "recently synchronised" is not a promise of instantaneous or
exhaustive real-time state.

Partial snapshots stay invisible and never replace the active world; a validated
snapshot switches state atomically; candidate (delayed or competing) game
sessions cannot take over the active world's status.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Startup error "Live bridge configuration is incomplete" | Set all five `FOREMAN_BRIDGE_*` variables or none |
| Foreman says live observations are unavailable | Receiver running and reachable; `NODE_EXTRA_CA_CERTS` set at ff-server start; URL host in the certificate SAN; `queryToken` matches and differs from `token`; receiver `serverId`/`worldId` match the binding |
| Tool never offered | You are chatting in a playthrough other than `FOREMAN_BRIDGE_PLAYTHROUGH_ID`, or the binding is unset |
| Always "last known" | Game plugin not delivering (check its status command / receiver logs), or receiver restarted and the game has not reconnected yet |
| "Unknown, not zero" | No snapshot committed yet for this world |

Probe the receiver directly (placeholders only):

```sh
curl --cacert receiver-ca.pem -sS https://receiver.example:9443/query/v1/constructors \
  -H "Authorization: Bearer $QUERY_TOKEN" -H 'Content-Type: application/json' -d '{}'
```

## Verification

Automated: receiver `npm test` (Node ≥ 24.21) covers query, freshness, restart,
migration, pagination and the HTTPS route; `npm test -w @foreman/ff-server`
covers configuration, the bounded client, tool authorisation, chat routing and
both provider adapters. `test/bridge-integration.test.ts` drives the real
receiver over HTTPS into the backend client and tool; it needs Node ≥ 24 and is
skipped (visibly) on older Node, so the bridge workflow runs it on Node 24.21.
That is scripted protocol traffic, **not** evidence of the real game/web-chat
path. The integrity of imported bridge files is checked with
`node integrations/foreman-bridge/scripts/update-source-manifest.mjs --check`.

### Real game / web-chat acceptance

**Status: passed (confirmed 2026-10-16).** The user confirmed that all five
checks below were completed with Claude and passed on the isolated dedicated
server with a linked playthrough:

1. Baseline: ask for Constructor counts and positions in web chat without
   uploading a save.
2. Place and remove Constructors; answers match the receiver's committed state.
3. Interrupt game→receiver delivery; after 15 s answers are last known with the
   last sync time.
4. Restore delivery; answers reconcile and become recently synchronised.
5. Interrupt Foreman→receiver access; chat says live data is unavailable and
   ordinary chat still works.

Evidence source: user confirmation in the continuation thread on 2026-10-16.
The detailed counts/positions, measured stale interval and verbatim model
responses were not included in the handoff. This records the reported manual
acceptance result separately from the automated results above; it does not
claim a new test run or reconstruct missing observations.
