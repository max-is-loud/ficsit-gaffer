# Receiver query contract v1

A read-only application query over the receiver's **committed** Constructor
projection for its single configured server/world. It is independent of the
native ingestion protocol ([`protocol-v1.md`](../../mod/docs/protocol-v1.md)),
which is unchanged. Staged snapshot rows are never visible here.

## Credentials

| Credential | Config field | May call | May not call |
| --- | --- | --- | --- |
| Producer | `token` | `/v1/hello`, `/v1/snapshot/chunk`, `/v1/snapshot/commit`, `/v1/exchange` | `/query/v1/constructors` |
| Read-only query | `queryToken` (optional) | `/query/v1/constructors` | every ingestion route |

Both use the existing token format (`[A-Za-z0-9_-]{32,256}`) and must differ;
configuring equal values fails startup. Omitting `queryToken` disables the query
route (it answers `404` like any unknown route). Credentials are compared by
constant-time SHA-256 digest and authentication happens before any body is read.

## Request

```http
POST /query/v1/constructors
Authorization: Bearer <queryToken>
Content-Type: application/json
```

```ts
type ConstructorQuery = {
  includeLocations?: boolean; // default false: count only
  limit?: number;             // integer 1..100, default 50; ignored for count-only
  cursor?: string;            // only with includeLocations: true
};
```

The body is at most 8192 bytes of strict UTF-8 JSON. Unknown fields are
rejected. The request never names a world: the receiver answers for its own
configured `serverId`/`worldId`, and a cursor cannot select another world.

## Response (`200`, `Cache-Control: no-store`)

```ts
type ConstructorState = {
  protocol: 1;
  serverId: string; worldId: string;   // the receiver's configured binding
  revision: string | null;             // opaque committed projection revision
  epoch: string | null;                // active world-session epoch
  status: 'fresh' | 'last_known' | 'unavailable';
  reason: 'recent_sync' | 'stale' | 'resynchronizing' | 'receiver_restarted' | 'no_baseline';
  lastSyncAt: number | null;           // UTC epoch ms of last accepted synchronization
  evaluatedAt: number;                 // UTC epoch ms when the receiver evaluated status
  totalCount: number | null;           // exact count for `revision`
  locations: Array<{ entityId: string; position: [number, number, number] }>;
  coordinateSystem: 'unreal_cm';
  returnedCount: number;               // locations.length
  hasMore: boolean;
  nextCursor: string | null;
};
```

Count, page, revision and status come from one read transaction.
`totalCount` is always the exact total for the revision, independent of how
many locations a page returns: a page of 50 positions does not mean 50 exist.

- **Count only** (`includeLocations` false): `locations` is empty,
  `returnedCount` 0, `hasMore` false, `nextCursor` null.
- **Locations**: ordered by `entityId`; at most `limit` rows. When `hasMore`
  is true, pass `nextCursor` with the same `includeLocations: true` to continue.
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
| 400 | `invalid_query` | Malformed JSON, unknown field, bad `limit`, or a cursor without `includeLocations: true` |
| 400 | `invalid_cursor` | Cursor is not one this receiver issued for its world |
| 401 | `unauthorized` | Missing or wrong credential (including the producer credential) |
| 404 | `not_found` | Query route disabled (no `queryToken`) |
| 405 | `method_not_allowed` | Not `POST` |
| 408 | `request_timeout` | Body not received within `requestTimeoutMs` |
| 409 | `state_changed` | Cursor's revision is no longer current |
| 413 | `payload_too_large` | Body over 8192 bytes |
| 415 | `unsupported_media_type` | Not `application/json` or content-encoded |
| 503 | `storage_unavailable` | Receiver database could not be read |
| 503 | `response_too_large` | Serialised result would exceed 256 KiB (not expected within the 100-row limit) |

## Example

```sh
curl --cacert ca.pem -sS https://receiver.example:9443/query/v1/constructors \
  -H "Authorization: Bearer $FOREMAN_BRIDGE_QUERY_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"includeLocations":true,"limit":2}'
```

```json
{"protocol":1,"serverId":"…","worldId":"…","revision":"…","epoch":"…",
 "status":"fresh","reason":"recent_sync","lastSyncAt":1760450000000,
 "evaluatedAt":1760450004200,"totalCount":7,
 "locations":[{"entityId":"…","position":[12000,-34050.5,800]},
              {"entityId":"…","position":[12600,-34050.5,800]}],
 "coordinateSystem":"unreal_cm","returnedCount":2,"hasMore":true,"nextCursor":"…"}
```
