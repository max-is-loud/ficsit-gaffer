# Live Constructor awareness in Foreman web chat

Date: 2026-10-14

Status: Written spec approved by the user; implementation planning authorized.

## Purpose and success

Connect the independent bridge imported in PR #7 to Foreman's existing web
chat. A player can ask how many Constructor machines exist and where they are
in one dedicated-server world without uploading another save. Answers must
distinguish recently synchronized observations from last-known state and from
information obtained from an uploaded save.

The user approved one world explicitly linked to one Foreman playthrough,
web chat only, an authenticated receiver query API consumed by a Foreman
tool, and the behavior, architecture, freshness rules, and verification
criteria below. This is architectural work. This document specifies the
milestone; it does not authorize production rollout.

## Scope

Included:

- Constructor presence, exact count for the returned committed state, and
  recorded world positions.
- An authenticated read-only receiver API and a backend live-state tool.
- Explicit operator configuration binding one receiver/server/world to one
  existing playthrough.
- Freshness and availability reporting, bounded location results, recovery,
  setup documentation, and isolated end-to-end acceptance.
- The deferred JavaScript provenance hash string-validation fix and shared
  malformed protocol fixtures.

Excluded:

- Other building types, recipes, power, production rates, or verification that
  a machine is operating successfully.
- Automatic work-order progress or completion.
- In-game questions, new outbound chat behavior, map UI, or connection-management UI.
- Multiple world bindings, automatic save/world pairing, or save lineage detection.
- Production deployment and large-factory scalability certification.

Coordinates alone do not establish a named base or the player's current
position. Foreman must not invent descriptions such as "near your base."

## Architecture

The data path is:

```text
Game plugin -> existing receiver ingestion -> committed receiver state
                                                ^
                                                | read-only HTTPS query
Web chat -> authorized playthrough -> Foreman backend live-state tool
```

The receiver remains the sole owner of the live Constructor projection.
Foreman does not mirror that projection in its application database. Existing
conversation persistence continues normally.

Add a small query surface to the independent receiver. It reads committed
state and associated synchronization metadata. Staged snapshot rows are never
visible through this surface. Count, page contents, revision, and freshness
metadata must come from one consistent read.

Add a dedicated tool to the backend's existing chat tool loop. It uses a
focused receiver client rather than making the receiver an MCP server. Keep
receiver transport, playthrough binding, and model-facing tool formatting
separate so each can be tested without a live model or game.

The existing native game-to-receiver wire protocol remains unchanged. Receiver
metadata and the new application query contract can evolve independently.

### Binding and access

Private backend configuration contains the receiver HTTPS address, read-only
credential, expected server ID, expected world ID, and linked playthrough ID.
The integration is disabled when absent. An explicitly configured but
incomplete or invalid binding must produce a clear configuration error.

The existing application authorization checks must run before live-state
access. The backend derives the binding from the authorized playthrough;
the model cannot supply a receiver address, credential, server/world identity,
or alternate playthrough. Unlinked playthroughs have no live-state access.
Validate receiver response identities against the configured binding.

Use a separate read-only receiver credential. It grants access only to query
routes and cannot submit events, stage snapshots, or issue commands. Preserve
the producer credential's existing ingestion role. Neither credential reaches
the browser or model, and neither is logged. Use verified HTTPS and reject
redirects so credentials cannot be forwarded to another endpoint.

Explicit configuration is the pairing authority for this milestone. It does
not prove that a separately uploaded save belongs to the configured world.
Setup documentation must make that operator responsibility clear.

## Query and tool behavior

Support count-only queries without enumerating all machines, and paginated
location queries. Location results need an entity identifier and position;
they do not need creator accounts, raw actor paths, or other internal metadata.
Document the coordinate units and axes; use the protocol's Unreal world
coordinates in centimetres, with any displayed conversion labeled explicitly.

Each successful query describes:

- The bound server/world and committed state revision.
- Exact total Constructor count for that revision.
- Requested location rows, returned count, and whether more rows exist.
- A continuation cursor when more locations exist.
- Availability/freshness status, reason, last successful synchronization time,
  and receiver evaluation time.

Use stable entity ordering. Default to 50 location rows and enforce a maximum
of 100 per request. Continuation cursors are bound to the world and committed
projection revision. If the projection changes between pages, reject the old
cursor with a classified state-changed result and restart pagination when
needed; never silently combine pages from different states. The revision must
also change on snapshot replacement, including replacement at the same event
cursor. Do not retain historical snapshots merely to support pagination.

The tool must preserve total count versus returned row count. A response with
50 positions must not imply that only 50 Constructors exist. Respect the chat
loop's tool-call budget; partial locations remain explicitly partial.

Live observations are labeled separately from save data. Prompt/tool guidance
must require a fresh tool query for claims about current Constructor state and
must not treat earlier conversation text or summaries as current observations.
Tool results describe state known to the receiver, not a guarantee that the
game has not changed since transmission.

## Freshness and recovery

Freshness derives from successful game synchronization, including accepted
empty exchanges. It does not derive from the last placement event, Foreman's
query time, health checks, or merely receiving an authenticated request.

The stale threshold is 15 seconds: at an elapsed age of 15 seconds or more,
report last-known state. Use a controllable clock for deterministic tests.
Within a process, use elapsed-time tracking that cannot become falsely fresh
because the wall clock moves backward; retain UTC timestamps for reporting.

| Condition | Result |
| --- | --- |
| No complete committed baseline | Unavailable; count is unknown, not zero |
| Valid committed empty world | Count zero, with ordinary freshness metadata |
| Complete state, successful sync less than 15 seconds ago, no known recovery pending | Recently synchronized observations |
| No successful sync for at least 15 seconds | Last-known state with last-sync time |
| Known resynchronization pending | Previous committed state marked last known |
| Receiver restarted | Persisted state marked last known until synchronization is re-established |
| Receiver unreachable or response invalid | Tool reports unavailable; ordinary chat continues |

Persist last-sync metadata with the corresponding accepted state changes, but
do not let persisted timestamps alone establish freshness after process
restart. A hello or staged snapshot chunk does not establish fresh state.
Only validated committed synchronization may restore it. Failed transactions,
rejected traffic, and retired connections cannot refresh timestamps.

Preserve PR #7's candidate-epoch fencing: an unknown candidate hello or partial
snapshot must not replace the active world or make candidate data visible.
Track known recovery for the active state without allowing a delayed candidate
hello to take over its status. A valid snapshot commit switches the projection
atomically; later exchanges apply subsequent events.

The existing protocol can deliver bounded replay batches. A successful exchange
means those observations were accepted, not proof that every queued game event
has arrived. User-facing wording must preserve this limitation. No new claim
of instantaneous or exhaustive real-time synchronization is introduced.

Bound each Foreman receiver request to five seconds, including body reading,
and cap response size. Do not add background retry loops to chat. Return
classified unavailable/error results without exposing credentials or internal
exceptions. A subsequent user request can try again. Receiver outages must not
disable unrelated game-data or save tools.

## Existing code and compatibility

The receiver currently exposes committed Constructor rows internally through
`openStore().current(worldId)`, but has no authenticated application query API
or sufficient persisted synchronization metadata. Add the query and freshness
support without changing current ingestion transaction and epoch guarantees.
Provide a migration path for existing receiver SQLite databases; old rows with
no synchronization timestamp start as last known or unavailable as appropriate.

Foreman's chat route already resolves a playthrough and its save context.
Extend the chat integration with trusted playthrough context and the live tool
while preserving existing provider, save, and work-order behavior. Verify
authorization at the route/middleware boundary rather than assuming that a
playthrough lookup alone authorizes its use.

Fix provenance hash validation by requiring strings before regex checks. Add
the malformed cases to both identical fixture copies and verify their parity.

The imported components have a source manifest recording upstream provenance
and file hashes. Preserve the original import commit references as provenance;
document subsequent in-repository modifications and update current file hashes
deliberately. Adjust the import documentation so modified files are not still
described as byte-identical upstream snapshots. Do not rewrite historical
acceptance evidence as if it validated the new integration.

## Verification

Automated receiver and backend tests must cover:

- Placement, removal, exact counts, recorded positions, snapshot replacement,
  and a valid empty world.
- First-start unavailability, the exact freshness boundary, idle exchanges,
  restart, active resynchronization, and restoration of freshness.
- No staged-data exposure or timestamp refresh from failed transactions,
  rejected connections, or delayed candidate traffic.
- Read-only authentication and rejection of ingestion with the query token.
- Existing playthrough permissions, unlinked playthroughs, identity mismatch,
  and attempts to override binding through model arguments.
- Timeout, malformed response, and unreachable receiver behavior while
  unrelated chat tools remain usable.
- Pagination bounds, exact totals, partial-result labels, and revision changes
  between pages, including snapshot replacement at an unchanged event cursor.
- Existing receiver database upgrade behavior and provenance fixture parity.
- Deterministic provider-driven tool routing for the existing supported chat
  provider paths. Real-model wording is checked separately in acceptance.

Run the existing receiver suite and relevant backend checks. Shared malformed
fixtures must also be checked with the native codec when its documented
toolchain is available. Record unavailable native checks explicitly; a Node
test is not evidence of a native test run.

### Isolated end-to-end acceptance

Use the isolated dedicated server and a linked Foreman playthrough:

1. Establish the baseline and ask for Constructor counts and positions in web
   chat without uploading a save.
2. Place and remove Constructors and verify subsequent answers match the
   receiver's committed observations.
3. Interrupt game-to-receiver delivery. After the stale threshold, verify
   last-known answers with the last-sync time.
4. Restore delivery and verify reconciliation and renewed fresh observations.
5. Interrupt Foreman-to-receiver access and verify a clear unavailable answer
   while ordinary chat remains usable.

Record actual player/server/model evidence separately from automated tests.
Do not claim that scripted protocol traffic proves the real game/web-chat path.
If the test environment or player participation is unavailable, report that
acceptance remains outstanding rather than claiming milestone completion.

## Delivery and completion

Deliver the receiver query surface, backend tool integration, focused regression
fix, tests, updated source manifest, and reproducible setup documentation.
Documentation must explain credential separation, explicit world/playthrough
binding, coordinate conventions, freshness, restart/recovery, and limitations.

The milestone is complete when the automated checks and isolated end-to-end
acceptance pass and setup is reproducible. Broader observation and production
rollout are separate work.

## Design review and next stage

Self-review checks: no unresolved placeholders; one world and web chat
throughout; no second factory-state database; explicit baseline, pagination,
freshness, recovery, and authorization semantics; no claims beyond protocol
evidence. The concrete limits and interface semantics here make the approved
scope implementable and remain subject to written-spec review.

After the user reviews and approves this written spec, use the Superpowers
writing-plans workflow to prepare the implementation plan. Product-code
implementation has not started.
