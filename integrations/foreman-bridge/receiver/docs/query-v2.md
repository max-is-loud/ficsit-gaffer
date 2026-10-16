# Receiver query contract v2

A read-only application query over the receiver's **committed** buildable
projection for its single configured server/world (bridge v2, #10). It is
independent of the native ingestion protocol
([`protocol-v2.md`](../../mod/docs/protocol-v2.md)). Staged snapshot rows are
never visible here. Version 1 (`/query/v1/constructors`) is removed.

## Credentials

| Credential | Config field | May call | May not call |
| --- | --- | --- | --- |
| Producer | `token` | `/v2/hello`, `/v2/snapshot/chunk`, `/v2/snapshot/commit`, `/v2/exchange` | `/query/v2/buildables` |
| Read-only query | `queryToken` (optional) | `/query/v2/buildables` | every ingestion route |

Both use the existing token format (`[A-Za-z0-9_-]{32,256}`) and must differ;
configuring equal values fails startup. Omitting `queryToken` disables the query
route: like any unknown route it then authenticates against the producer
credential, so other credentials get `401` and the producer credential gets
`404`. Credentials are compared by
constant-time SHA-256 digest and authentication happens before any body is read.

## Request

```http
POST /query/v2/buildables
Authorization: Bearer <queryToken>
Content-Type: application/json
```

```ts
type BuildablesQuery = {
  filter?: {                         // exact, AND-combined; unknown keys rejected
    category?: 'manufacturer' | 'extractor' | 'generator' | 'storage';
    className?: string;              // e.g. 'Build_SmelterMk1_C'
    recipeName?: string;             // e.g. 'Recipe_IngotIron_C'
  };
  groupBy?: 'category' | 'class' | 'recipe';
  from?: [number, number, number];   // centimetres; distance mode
  includeRows?: boolean;             // default false: totals (and groups) only
  limit?: number;                    // integer 1..100, default 50
  cursor?: string;                   // only with includeRows: true and no `from`
};
```

A **class name** is the final `.`-separated segment of a class path
(`…/Build_SmelterMk1.Build_SmelterMk1_C` → `Build_SmelterMk1_C`), the key
`sf-game-data` uses. The body is at most 8192 bytes of strict UTF-8 JSON. The
request never names a world: the receiver answers for its own configured
`serverId`/`worldId`, and a cursor cannot select another world.

## Response (`200`, `Cache-Control: no-store`)

```ts
type BuildablesState = {
  protocol: 2;
  serverId: string; worldId: string;   // the receiver's configured binding
  revision: string | null;             // opaque committed projection revision
  epoch: string | null;                // active world-session epoch
  status: 'fresh' | 'last_known' | 'unavailable';
  reason: 'recent_sync' | 'stale' | 'resynchronizing' | 'receiver_restarted' | 'no_baseline';
  lastSyncAt: number | null;           // UTC epoch ms of last accepted synchronization
  evaluatedAt: number;                 // UTC epoch ms when the receiver evaluated status
  totalCount: number | null;           // exact count matching the filter for `revision`
  groups?: Array<{ key: string | null; count: number }>; // only when groupBy is set
  rows: Array<{
    entityId: string; category: string; classPath: string;
    position: [number, number, number]; // centimetres
    config: object;                    // the row's per-category configuration (protocol-v2.md)
    distanceMetres?: number;           // distance mode only, rounded to 0.1 m
  }>;
  coordinateSystem: 'unreal_cm';
  returnedCount: number;               // rows.length
  hasMore: boolean;
  nextCursor: string | null;
};
```

Count, page, revision and status come from one read transaction.
`totalCount` is always the exact total for the revision and filter, independent
of how many rows a page returns: a page of 50 rows does not mean 50 exist.

- **Totals only** (`includeRows` false): `rows` is empty, `returnedCount` 0,
  `hasMore` false, `nextCursor` null.
- **Groups** (`groupBy`): counts per category, class name or recipe name,
  sorted by count (descending) then key; buildables with no recipe group under
  `key: null`.
- **Id-ordered rows** (`includeRows`, no `from`): ordered by `entityId`; at
  most `limit` rows. When `hasMore` is true, pass `nextCursor` with the same
  query to continue.
- **Distance rows** (`includeRows` with `from`): one page of the nearest
  `limit` rows, ascending by distance, each with `distanceMetres`;
  `nextCursor` is null and `hasMore` says whether more rows match.
- **No committed baseline** (first start, or only candidate traffic seen):
  `status: 'unavailable'`, `reason: 'no_baseline'`, `revision`, `epoch`,
  `lastSyncAt` and `totalCount` null. The count is unknown, not zero.
- **Committed empty world**: `totalCount: 0` with ordinary status.

### Coordinates

`position` is the actor's Unreal world location `[X, Y, Z]` in **centimetres**
as recorded by the game plugin (Unreal's left-handed axes, Z up). Divide by 100
for metres and label any conversion. Coordinates do not identify a named base
or the player's position.

### Status

| Condition | `status` / `reason` |
| --- | --- |
| No committed baseline | `unavailable` / `no_baseline` |
| Accepted snapshot commit or exchange in this receiver process less than 15 s ago | `fresh` / `recent_sync` |
| No accepted synchronization for 15 s or more | `last_known` / `stale` |
| The active epoch has been told to send a new snapshot | `last_known` / `resynchronizing` |
| Receiver restarted and has not yet accepted a synchronization | `last_known` / `receiver_restarted` |

Synchronization means a validated snapshot installation or an accepted
exchange on the active connection, including an exchange with no events.
Queries, health checks, hello, staged chunks, failed transactions, fenced
connections and idempotent replays never refresh it. Elapsed time is measured
with a process-local monotonic clock; a persisted `lastSyncAt` is reported but
cannot make state fresh after restart or a wall-clock change.

An accepted exchange means the observations it carried were committed. It does
not prove every queued game event has arrived (replay is batched), nor that the
game has not changed since. `fresh` means "recently synchronized", not
"instantaneous".

### Pagination and revisions

`nextCursor` is opaque and bound to the world, the committed revision and the
last returned entity. Every committed projection change issues a new revision,
including a snapshot replacement at an unchanged event cursor; empty exchanges
do not. A cursor from an older revision returns `409 state_changed`: restart
pagination from the first page. Pages from different revisions are never
combined, and no historical snapshot is retained to serve old cursors.

## Errors

Error bodies are `{"error": "<code>"}` with no internal detail.

| Status | `error` | Meaning |
| --- | --- | --- |
| 400 | `invalid_query` | Malformed JSON, unknown field, bad `limit`/`filter`/`groupBy`/`from`, or a cursor without `includeRows: true` or with `from` |
| 400 | `invalid_cursor` | Cursor is not one this receiver issued for its world |
| 401 | `unauthorized` | Missing or wrong credential (including the producer credential) |
| 404 | `not_found` | Query route disabled (no `queryToken`) and the producer credential was sent; any other credential gets 401 |
| 405 | `method_not_allowed` | Not `POST` |
| 408 | `request_timeout` | Body not received within `requestTimeoutMs` |
| 409 | `state_changed` | Cursor's revision is no longer current |
| 413 | `payload_too_large` | Body over 8192 bytes |
| 415 | `unsupported_media_type` | Not `application/json` or content-encoded |
| 503 | `storage_unavailable` | Receiver database could not be read |
| 503 | `response_too_large` | Serialised result would exceed 256 KiB (not expected within the 100-row limit) |

## Example

```sh
curl --cacert ca.pem -sS https://receiver.example:9443/query/v2/buildables \
  -H "Authorization: Bearer $FOREMAN_BRIDGE_QUERY_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"filter":{"className":"Build_SmelterMk1_C"},"groupBy":"recipe"}'
```

```json
{"protocol":2,"serverId":"…","worldId":"…","revision":"…","epoch":"…",
 "status":"fresh","reason":"recent_sync","lastSyncAt":1760450000000,
 "evaluatedAt":1760450004200,"totalCount":14,
 "groups":[{"key":"Recipe_IngotIron_C","count":12},{"key":null,"count":2}],
 "rows":[],"coordinateSystem":"unreal_cm","returnedCount":0,"hasMore":false,"nextCursor":null}
```
