# Live Constructor Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Answer Constructor count and location questions in existing Foreman web chat using one explicitly linked dedicated-server world's observations.

**Architecture:** The independent receiver retains the only live projection and exposes an authenticated read-only HTTPS query. A backend-local tool queries it using trusted playthrough context; the existing MCP and work-order paths remain intact. The native ingestion protocol is unchanged.

**Tech Stack:** Node.js, SQLite via `node:sqlite`, HTTPS, TypeScript, Express, existing provider-neutral tool loop, Node test runner and Vitest. Receiver tests require Node 24.21.0 or newer and OpenSSL.

**Spec:** [Approved design](../specs/2026-10-14-live-constructor-awareness-design.md). Read both documents before execution.

## Global Constraints

- One dedicated-server world, one configured playthrough, existing web chat only.
- Freshness threshold: 15 seconds; stale at age >= 15 seconds.
- Location pages default to 50 rows, maximum 100; exact total count is independent of page size.
- Five-second backend request deadline includes body reading; response cap is 256 KiB.
- Verified HTTPS, no redirects, separate read-only credential, no secrets in browser/model/logs.
- No staged snapshot exposure, second factory database, automatic pairing, new native wire fields, or production rollout.
- Restarted receiver state is last known until synchronization is re-established.
- Preserve the existing 12-iteration chat tool budget.
- Commit only task-owned files; preserve unrelated `.claude/settings.json` changes.
- Create an isolated execution branch/worktree at implementation time using the worktree skill. This planning commit does not start implementation.

## Review Focus

- Clock rollback and receiver restart cannot make old state fresh (Task 2).
- Replacing a snapshot at an unchanged event cursor invalidates pagination (Task 2).
- Delayed candidate traffic and retried old receipts cannot refresh the active projection (Task 2).
- A slow response body, redirect, or excessive payload cannot bypass the backend transport limits (Task 4).
- A deleted/unlinked playthrough or forged model arguments cannot reach another world's observations (Task 5).

## File structure and contract

Receiver files stay under `integrations/foreman-bridge/receiver/`:

- `src/query.mjs`: query validation, cursor encoding, response shape and limits.
- `src/store.mjs`: transactional projection queries, migration and sync metadata.
- `src/freshness.mjs`: injected clock and process-local freshness tracking.
- `src/server.mjs`: query-route authentication and HTTPS dispatch.
- `test/query.test.mjs`, `test/freshness.test.mjs`, `test/query-server.test.mjs`: focused tests alongside existing store/recovery/protocol suites.

Backend files stay under `packages/ff-server/`:

- `src/bridge/types.ts`: binding, query, result, and client interfaces.
- `src/bridge/config.ts`: optional binding configuration validation.
- `src/bridge/client.ts`: bounded HTTPS fetch and response validation.
- `src/tools/liveStateTools.ts`: local tool definition and trusted-playthrough dispatch.
- Existing `src/config.ts`, `src/deps.ts`, `src/index.ts`, `src/routes/chat.ts`, `src/llm/chat.ts`: wiring only.
- New `test/bridge-config.test.ts`, `test/bridge-client.test.ts`, `test/liveStateTools.test.ts`; extend existing chat, route, and provider tests.

New query contract (document in `integrations/foreman-bridge/receiver/docs/query-v1.md`):

```ts
type ConstructorQuery = { includeLocations?: boolean; limit?: number; cursor?: string };
type StateStatus = 'fresh' | 'last_known' | 'unavailable';
type StateReason = 'recent_sync' | 'stale' | 'resynchronizing' | 'receiver_restarted' | 'no_baseline';
type ConstructorState = {
  protocol: 1; serverId: string; worldId: string;
  revision: string | null; epoch: string | null;
  status: StateStatus; reason: StateReason;
  lastSyncAt: number | null; evaluatedAt: number;
  totalCount: number | null;
  locations: Array<{ entityId: string; position: [number, number, number] }>;
  coordinateSystem: 'unreal_cm'; returnedCount: number;
  hasMore: boolean; nextCursor: string | null;
};
```

Expose `POST /query/v1/constructors` with that query body and read-only bearer authentication. The endpoint implicitly selects the receiver's configured world. Unknown fields, invalid limits/cursors, or a cursor with `includeLocations:false` return 400; a changed revision returns 409 `state_changed`. Ordinary no-baseline state is a 200 response with null count/revision/epoch, empty locations and no continuation. Count-only results have empty locations and `hasMore:false` because no list was requested. Query bodies are capped at 8 KiB. Use `Cache-Control: no-store`.

## Task 1: Close the provenance validation gap

**Files:** Modify receiver `src/protocol.mjs`, `fixtures/v1.json`, `test/protocol.test.mjs`; update identical `integrations/foreman-bridge/mod/Tests/fixtures/v1.json`.

**Interfaces:** Existing `decodeRequest(kind, bytes)` continues returning the same valid request DTOs; invalid provenance hash types throw `ProtocolError`.

- [ ] Add named malformed fixtures for singleton arrays and nonstring values for both provenance hashes. Assert `assert.throws(() => decodeRequest('hello', bytes), ProtocolError)` for each, while valid strings still decode.
- [ ] Run `node --test test/protocol.test.mjs` in the receiver directory; observe the singleton-array regression fail for validation behavior.
- [ ] Add explicit string guards before the two regex checks and copy canonical fixtures byte-for-byte to the native fixture path.
- [ ] Rerun that test; compare fixture SHA-256 hashes. Run the documented native Wire test when the native toolchain is available, otherwise record it as outstanding.
- [ ] Commit the scoped fix as `fix(bridge): require string provenance hashes`.

## Task 2: Query committed state with trustworthy freshness

**Files:** Create receiver `src/query.mjs`, `src/freshness.mjs`, `test/query.test.mjs`, `test/freshness.test.mjs`; modify `src/store.mjs`, `test/store.test.mjs`, `test/recovery.test.mjs`.

**Interfaces:** Export `validateQuery(input): ConstructorQuery` from `query.mjs`. Extend `openStore(path, options)` with an optional `clock: { utcNow(): number; monotonicNow(): number }`, preserving `beforeCommit`. Add `store.queryConstructors(binding: { serverId: string; worldId: string }, query): ConstructorState` (binding comes from receiver configuration, including before a baseline exists). Export `createFreshness(clock)` with `markSynchronized(worldId)`, `markRecovering(worldId)`, and `evaluate(worldId, lastSyncAt)` returning status/reason/evaluatedAt. Only call freshness mutation methods after successful database commit.

- [ ] Add tests that seed through existing ingestion helpers and assert exact count/positions after placement/removal, no-baseline `totalCount === null`, committed empty `totalCount === 0`, and no staged row exposure.
- [ ] Add controllable-clock tests: age 14999 is fresh, age 15000 is last known; accepted empty exchange refreshes; query/hello/chunk/failed transaction does not; monotonic elapsed time controls freshness despite backward UTC movement.
- [ ] Add restart/legacy-database tests: reopening preserved rows yields last known; successful validated exchange restores freshness; an old database migrates without losing rows or changing ingestion semantics.
- [ ] Add recovery tests: active epoch needing snapshot becomes last known; candidate hello/staging cannot alter active freshness; rejected retired connection and old commit receipts cannot refresh it; successful snapshot atomically replaces state. Assert transaction failure preserves prior rows, revision and persisted last-sync metadata.
- [ ] Add pagination tests for default 50/max 100, deterministic ordering, invalid cursor/limit, exact total and explicit continuation, and `state_changed` after a mutation or snapshot replacement at the same event cursor.
- [ ] Run `node --test test/query.test.mjs test/freshness.test.mjs test/store.test.mjs test/recovery.test.mjs`; observe missing behavior failures before implementation.
- [ ] Implement additive SQLite metadata migration: persist baseline existence separately from readiness, last-sync UTC and opaque projection revision. Generate a new revision on committed projection mutations and each new snapshot installation; accepted empty exchanges leave the revision stable. Distinguish actual installation from idempotent commit-receipt replay.
- [ ] Implement a single consistent count/page/metadata read, selecting only the active committed epoch and fetching at most limit + 1 rows. Cursor binds world/revision/last entity ID; validate decoded types and length, and use SQL parameters. A cursor never grants authority to select a world.
- [ ] Implement process-local monotonic freshness, initialized conservatively on open. Preserve prior baseline during active recovery. Count accepted current-connection exchanges as synchronization, including no-op exchanges; do not describe replay acceptance as guaranteed backlog exhaustion.
- [ ] Rerun the focused command and full receiver `npm test`; commit as `feat(bridge): query committed constructor observations`.

## Task 3: Expose the read-only receiver API

**Files:** Modify receiver `src/server.mjs`; create `test/query-server.test.mjs`, `docs/query-v1.md`; extend `test/server.test.mjs`.

**Interfaces:** `loadConfig()` accepts optional `queryToken` with the existing token format/length constraints, distinct from `token`; omission disables query routes. Existing `createReceiver(config, store)` dispatches query requests to Task 2. Existing producer-only configuration remains valid.

- [ ] Add real HTTPS tests asserting query token receives the contract response; absent/wrong/producer token cannot query; query token cannot ingest; equal configured credentials fail validation. Assert existing ingestion still works with query support disabled.
- [ ] Add tests asserting 400 for malformed fields, 409 for changed cursor, 413 beyond 8192 request bytes, no-store response header, bounded response, and classified 503 storage errors without internal text. Unauthenticated requests must fail before body buffering.
- [ ] Run `node --test test/query-server.test.mjs test/server.test.mjs` and observe the missing route/auth failures.
- [ ] Implement route-specific credential checks before body collection, preserving ingestion authentication and limits. Map query validation/state errors separately from storage failures. Bound query response serialization to 256 KiB.
- [ ] Write the exact request/response/error contract in `docs/query-v1.md`, including count-only and unavailable semantics, cursor invalidation, coordinate units, and the two credentials' distinct permissions.
- [ ] Run the focused command and full receiver `npm test`; commit as `feat(bridge): expose authenticated read-only queries`.

## Task 4: Add the bounded backend receiver client

**Files:** Create backend `src/bridge/types.ts`, `src/bridge/config.ts`, `src/bridge/client.ts`, `test/bridge-config.test.ts`, `test/bridge-client.test.ts`; modify `src/config.ts`, `test/config.test.ts`, `.env.example`.

**Interfaces:** `BridgeBinding = { url: string; queryToken: string; serverId: string; worldId: string; playthroughId: string }`. `resolveBridgeBinding(env): BridgeBinding | undefined`. `BridgeClient.query(query: ConstructorQuery): Promise<ConstructorState>`; `createBridgeClient(binding): BridgeClient`. Transport/validation failures reject a classified `BridgeQueryError` with code `unavailable`, `invalid_response`, or `state_changed`, never raw remote text. Reproduce Task 3's contract in runtime schemas; do not import receiver internals into the workspace.

- [ ] Add config tests: all absent disables; partial config fails; valid binding succeeds; HTTP URL, userinfo, non-root path, query or fragment, malformed IDs/token fail without echoing secrets. Environment names are `FOREMAN_BRIDGE_URL`, `FOREMAN_BRIDGE_QUERY_TOKEN`, `FOREMAN_BRIDGE_SERVER_ID`, `FOREMAN_BRIDGE_WORLD_ID`, `FOREMAN_BRIDGE_PLAYTHROUGH_ID`.
- [ ] Add client tests using a local HTTPS fixture with a test CA: valid contract succeeds; wrong hostname fails; redirects make zero sink requests; identity mismatch, nonfinite coordinates, inconsistent count/page flags, invalid status/null combinations and oversized bodies are rejected.
- [ ] Add tests asserting one 5000 ms deadline covers both headers and slow body, with body cancellation on timeout/size failure and no automatic retries. Assert sanitized error codes contain no token or server exception text. Include multibyte payloads in byte-limit tests.
- [ ] Run `npm test -w @foreman/ff-server -- test/bridge-config.test.ts test/bridge-client.test.ts test/config.test.ts` and observe missing behavior failures.
- [ ] Implement the configuration resolver and fetch client with verified TLS, `redirect:'error'`, AbortController deadline, streamed 262144-byte cap, strict response validation, and binding identity check. Use an isolated child-process HTTPS test fixture if custom CA trust requires `NODE_EXTRA_CA_CERTS` at startup; never disable TLS verification.
- [ ] Add optional `bridge` to server configuration and placeholder-only environment documentation. Ensure public health/config responses never serialize this private binding.
- [ ] Rerun focused tests; run `npm run build -w @foreman/ff-server`; commit as `feat(server): add live bridge query client`.

## Task 5: Wire the playthrough-scoped live tool into chat

**Files:** Create backend `src/tools/liveStateTools.ts`, `test/liveStateTools.test.ts`; modify `src/deps.ts`, `src/index.ts`, `src/routes/chat.ts`, `src/llm/chat.ts`, `SYSTEM_PROMPT.md`, `test/chat.test.ts`, `test/routes.test.ts`, `test/systemPrompt.test.ts`, `test/anthropic.test.ts`, `test/openai-stream.test.ts`.

**Interfaces:** `LiveStateService = { binding: BridgeBinding; client: BridgeClient }`; optional `liveState` on `AppDeps` and `ChatDeps`. Export `liveStateToolDefinitions(playthroughId, service?): ToolDefinition[]` and `handleLiveStateTool(playthroughId, args, service?): Promise<ToolInvocationResult>`. Tool name is `get_live_constructor_state`; arguments use `ConstructorQuery` only. Both advertisement and invocation enforce the trusted playthrough binding.

- [ ] Add tool tests asserting linked playthrough gets the tool, unlinked/disabled gets none, and direct forged invocation makes zero receiver calls. Unknown arguments including URL/world/playthrough overrides fail validation. Results preserve exact total, partial locations, units, status and timestamps; no private binding credential appears.
- [ ] Add route tests with two users: non-owner and deleted playthrough cannot call the receiver; linked owner's request succeeds. Check the real `buildApp` middleware path, which already uses `requirePlaythroughOwnership`.
- [ ] Add provider-neutral chat tests for live tool dispatch and receiver failure followed by successful unrelated tool use. Preserve the 12-iteration cap. Add provider serialization tests ensuring both supported adapters carry the tool definition and result/error through their existing continuation formats.
- [ ] Add prompt tests for current observations requiring a query, last-known/unavailable wording guidance, save-data separation, partial-location disclosure and no invented landmarks. Earlier messages/summaries are not fresh measurements.
- [ ] Run `npm test -w @foreman/ff-server -- test/liveStateTools.test.ts test/chat.test.ts test/routes.test.ts test/systemPrompt.test.ts test/anthropic.test.ts test/openai-stream.test.ts` and observe new assertions fail.
- [ ] Instantiate optional service in `index.ts`, pass it through dependencies and route, and add local tool dispatch before the MCP fallback. Reserve the tool name so an MCP name collision cannot change its authority. Reject direct calls even when the tool was not advertised.
- [ ] Implement compact validated JSON tool results; classify unavailable/state-changed errors without retry loops. Add prompt guidance without claiming freshness beyond receiver observations. Preserve save and work-order behavior and require no frontend code changes.
- [ ] Rerun focused tests and full backend suite; commit as `feat(server): answer live constructor questions in web chat`.

## Task 6: Verify the integration and document reproducible operation

**Files:** Create `docs/live-constructor-awareness.md`, `packages/ff-server/test/bridge-integration.test.ts`, `integrations/foreman-bridge/scripts/update-source-manifest.mjs`; modify `integrations/foreman-bridge/README.md`, `integrations/foreman-bridge/receiver/README.md`, `integrations/foreman-bridge/source-manifest.json`, root `README.md`, and relevant CI workflows `.github/workflows/ci.yml` and `.github/workflows/foreman-bridge.yml` only as needed to execute new checks.

**Interfaces:** A real receiver HTTPS fixture feeds the Task 4 client and Task 5 tool. Manifest script supports `--check` and `--write`, preserves upstream `sourceCommit` provenance, retains original imported hashes as a baseline, and records current hashes plus explicit locally modified/added/deleted paths. Hash generation excludes the manifest itself and generated/private artifacts.

- [ ] Write integration assertions using actual receiver ingestion/query and backend client/tool: seed count N, place -> N+1, remove -> N, stale at 15000 ms, restore -> fresh, backend disconnection -> unavailable. Assert a real receiver error produces the documented tool classification.
- [ ] Run `npm test -w @foreman/ff-server -- test/bridge-integration.test.ts`; fix integration mismatches, rerun until passing. Test setup uses a disposable SQLite database and TLS fixture, never production/private config.
- [ ] Document exact setup, distinct tokens, world/playthrough binding, TLS trust including custom CA startup configuration, separate receiver launch/runtime, query examples, coordinate conventions, restart/recovery and troubleshooting. Keep secrets as placeholders. Explain that save pairing is manual.
- [ ] Implement the manifest updater/checker, preserve historical provenance, regenerate hashes, and update import wording to distinguish original snapshots from local modifications. Check both fixture copies remain byte-identical.
- [ ] Run `npm run build`, `npm test -w @foreman/ff-server`, `npm run lint -w @foreman/ff-server`, receiver `npm test`, manifest `--check`, and `git diff --check`. Inspect every result; run required CI-equivalent checks for changed files. Record native codec verification independently.
- [ ] Perform the spec's five-step isolated real-game/web-chat acceptance using the collaborative preview tools when available. Record observed counts/positions, stale interval, recovery, model wording and receiver unavailability in the operations document. If access/player participation is missing, mark acceptance outstanding and request the exact missing input; do not substitute simulated evidence or declare the milestone complete.
- [ ] Commit validated code/docs as `test(bridge): verify and document live chat integration`. Preserve any outstanding acceptance item explicitly in the handoff.

## Self-review and execution handoff

Spec coverage: scope/access and explicit binding in Tasks 3–5; atomic state,
freshness, restart, migration and pagination in Task 2; transport/error limits
in Tasks 3–4; protocol fix in Task 1; provider behavior in Task 5; reproducible
setup, manifest integrity and real acceptance in Task 6. All five Review Focus
conditions have owning test steps. No native protocol extension or frontend
feature is required.

The written spec is approved. This plan awaits user review and execution-method
selection. Recommended method: native/inline implementation, since the six
tasks share a small evolving query contract and build sequentially. Follow the
selected execution skill and finish with an independent whole-branch review.
Do not merge, publish, or deploy production as part of this plan.
