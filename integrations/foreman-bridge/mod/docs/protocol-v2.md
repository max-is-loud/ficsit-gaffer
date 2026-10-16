# Foreman bridge protocol v2

Revision 2 (bridge v2, #10). A hard cut from revision 1: `protocol:1` is
rejected with `unsupported_protocol`. The canonical executable fixture is
`receiver/fixtures/v2.json`; its byte-identical copy lives at
`Tests/fixtures/v2.json`. Envelope, sequences, snapshots, epochs and command
rules are unchanged from revision 1; rows gain a category and a per-category
configuration, and events gain the `reconfigured` origin.

## Encoding and common envelope

All four endpoints accept POST with UTF-8 JSON, authenticated before body
processing by the later HTTPS adapter. Maximum request and response: 256 KiB.
Reject invalid UTF-8, unpaired Unicode surrogates, unknown object fields,
unknown protocol/type, non-finite numeric transforms and malformed identities.
Maximum JSON nesting is 32. UUIDs are canonical lowercase hyphenated strings.

Every request/reply carries `protocol:2`, `serverId`, `worldId`, `epoch` and
UUID `requestId`. Requests after hello and all replies carry UUID `connectionId`.
Replies must match expected server/world/epoch/request and, except hello,
connection. A stale reply is rejected before it reaches State. Hello supplies
a fresh connection generation; persistence owns idempotent retry semantics.

Sequences are unsigned 64-bit decimal **strings**, no sign, leading zeroes or
fraction: `0` through `18446744073709551615`. Event and command causal sequences
start at 1; cursors/watermarks may be 0. Neither JSON numbers nor JavaScript
Number represents these sequences. Counts/indices are nonnegative uint32
JSON integers. UTC expiry is a nonnegative safe-integer millisecond timestamp.

## Requests and replies

The common fields above are omitted here for readability.

| Endpoint | Request fields | Reply fields |
| --- | --- | --- |
| `/v2/hello` | `latestSeq`, `oldestRetainedSeq`, `provenance` | `mode:"resume",cursor` or `mode:"snapshotRequired",reason` |
| `/v2/snapshot/chunk` | `snapshotId`, `chunkIndex`, `data` | `snapshotId`, `chunkIndex` |
| `/v2/snapshot/commit` | `snapshotId`, `watermark`, `chunkCount`, `rowCount`, `sha256` | `snapshotId`, `watermark` |
| `/v2/exchange` | `events`, `commandResults` | `ackSeq`, `commands`, optional `resyncRequired` reason |

`oldestRetainedSeq:"0"` means no retained events; otherwise it cannot exceed
latestSeq. Provenance has `gameVersion`, `smlVersion`, `bridgeVersion` (nonempty,
at most 128 UTF-8 bytes each), `starterCommit` (40 lowercase hex) and
`bridgeSourceSha256` (64 lowercase hex). These are diagnostics, not authority.

A hello or exchange ACK beyond locally emitted latestSeq is rejected by the
state/delivery layer. Codec validation proves representation only; it does not
know the server's live cursor. Snapshot replies must additionally match the
in-flight snapshot/index/watermark in Delivery. Snapshot confirmation must
not clear loss of events newer than the frozen watermark.

## Rows, events and snapshots

Rows have exactly:

```
entityId, actorPath, classPath, category, config,
transform: {position:[x,y,z], rotation:[pitch,yaw,roll], scale:[x,y,z]},
player: null | {platform, accountId, displayName}
```

Position uses UE centimetres, rotation degrees. Paths are nonempty and at most
4096 UTF-8 bytes. Player strings are nonempty and at most 1024 UTF-8 bytes each.
Unknown creator identity is null; display name is never an account key.

`category` is one of `manufacturer`, `extractor`, `generator`, `storage`.
`config` has exactly the fields of its category — every field present, each
either `null` (the game could not say) or a value of the listed type. Unknown
or missing fields are rejected (`invalid_row`).

| Category | `config` fields |
| --- | --- |
| `manufacturer` | `recipe` path, `clockSpeed` number, `productionBoost` number, `powerShards` uint32, `somersloops` uint32, `paused` boolean |
| `extractor` | `resource` path, `purity` (`impure`/`normal`/`pure`), `node` path, `clockSpeed` number, `powerShards` uint32, `paused` boolean |
| `generator` | `fuel` path, `clockSpeed` number, `powerShards` uint32, `paused` boolean |
| `storage` | none (`{}`) |

Numbers are finite JSON numbers; `clockSpeed` is the current potential (1 =
100 %). Paths follow the path rules above. A class *name* is the final
`.`-separated segment of a class path; the receiver indexes class and recipe
names for queries.

Events have `seq`, `type`, `entityId`, `origin`; upserts additionally require
`row` with matching entityId. Types are `buildable.upsert` / `buildable.remove`;
origins are `placed` / `reconciled` / `reconfigured` (a configuration change on
an existing buildable). Maximum 128 events per exchange. The entire batch is
validated before persistence; sequence continuity/duplicate equality are store
responsibilities. No event creates chat.

The `pioneers` exchange field is reserved for Part 2 (Pioneer position) and is
rejected as an unknown field until then.

A frozen snapshot is sorted by entityId. Each compact row is encoded once as
UTF-8 JSON followed by LF. Chunks split on row boundaries and carry these exact
bytes as decoded JSON string `data`. Every chunk is nonempty, LF-terminated,
and has strictly increasing row IDs. SHA-256 covers the concatenated decoded
UTF-8 bytes, **not** reserialised rows or outer envelopes. Whitespace/escape
spellings inside data therefore affect the digest. Across-chunk duplicate IDs,
retry consistency, completeness and atomic installation belong to the store.
Empty snapshot: zero chunks, zero rows, SHA-256 of empty bytes.

## Chat commands

Commands have exactly `commandId`, `causalSeq`, `type:"chat.send"`, `text`,
`expiresAt`. ID is `worldId/epoch/causalSeq/chat` and must match the envelope
and causalSeq. Maximum 128 per reply, further bounded by complete response size.
Text is nonempty, at most 512 Unicode scalars and 2048 UTF-8 bytes; reject
Unicode control/format characters and `<`/`>` markup delimiters. No arbitrary
console, building or RCON commands exist in this protocol.

Command results have `commandId` and status `executed`, `skipped`, `expired` or
`rejected`; maximum 128 per exchange. Results describe dispatch, not receipt by
a human. Store generates the fixed response with 30-second lifetime. Delivery
owns expiry, monotonic/UTC divergence, epoch scoping and bounded deduplication.

## Validation errors and evidence

JavaScript throws ProtocolError with code/status: unsupported_protocol (426),
payload_too_large (413), otherwise invalid_json/unicode/schema/identity/sequence/
row/event/snapshot/command/type (400). Stale response uses stale_reply. C++ returns
an unset optional (or empty bytes when encoding fails). Auth, binding, sequence
conflict and storage errors belong to subsequent HTTP/store tasks.

Tests feed identical fixture bytes to both decoders, including invalid raw UTF-8
hex. Unreal exports encoded valid requests to ignored `out/wire-interop.json`;
JavaScript independently decodes those bytes and compares exact fields, including
snapshot data. Separate digest fixtures require byte-exact SHA-256 agreement.

## Candidate epoch activation

An unseen epoch hello issues a candidate connection without replacing current
state or fencing the current writer. Snapshot chunks remain staged. Only a
validated snapshot commit promotes that candidate, atomically retiring the
previously current epoch and fencing other issued connections. Never-current
candidates may negotiate a fresh connection after a competing promotion; stale
connections cannot commit. Retired active epochs remain fenced, including when
retrying an old successful commit receipt. This handles reversed first-hello
arrival without relying on UUID ordering or wall clocks.
