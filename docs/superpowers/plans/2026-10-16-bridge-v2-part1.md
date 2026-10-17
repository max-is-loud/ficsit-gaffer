# Bridge v2 Part 0 + Part 1 (protocol v2, live buildables) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Constructor-only bridge with protocol v2: every production building observed with its configuration, kept current by setter hooks, served by the receiver's `/query/v2/buildables` and the foreman's `get_live_buildables` tool.

**Architecture:** The plugin's registry maps native base classes to a category and a capture function; configuration changes queue a deduplicated, per-tick-capped re-capture fed by SML hooks, game delegates and a public `RequestRecapture` API. The wire row gains `category` + a strictly validated per-category `config`. The receiver stores buildables with indexed class/recipe names; ff-server resolves display names through `sf-game-data`.

**Tech Stack:** Unreal 5.6.1-css-83 + SML (starter `8eebc9e659f0b2ff4392d2f8cf6e2cff60c8ea49`), C++20; Node ≥ 24.21 receiver (`node:sqlite`, `node --test`); ff-server TypeScript, zod, vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-bridge-v2-live-world-design.md` (Part 2 — Pioneer position — gets its own plan after this one's spike).

## Global Constraints

- Protocol `2`, hard cut: receiver and ff-server speak v2 only; no v1 route, table or tool remains.
- Unchanged v1 limits: 256 KiB request/response, 128 events per exchange, nesting 32, paths ≤ 4096 UTF-8 bytes, player strings ≤ 1024, query body ≤ 8192 bytes, query `limit` 1..100 default 50, 15 s freshness window, ff-server 5 s deadline, no retries.
- Categories (wire strings): `manufacturer`, `extractor`, `generator`, `storage`. Origins: `placed`, `reconciled`, `reconfigured`. Purity: `impure`, `normal`, `pure`.
- Every `config` field is nullable; unknown fields are rejected in both codecs.
- A class name is the final `.`-separated segment of a class path.
- Code standards (`CONTRIBUTING.md`): header comment on every non-test source file; files ≤ 500 lines (warn > 300); functions ≤ 60 lines, depth 3, complexity 12, ≤ 4 parameters; new kinds as table entries. The `integrations/foreman-bridge/` exemption in `source-limits.json` is removed in Task 12, so every bridge file touched must already comply.
- British English in comments and docs. Conventional Commits with a body; the protocol change commits use `feat(bridge)!:` with a `BREAKING CHANGE:` footer.
- After any change under `integrations/foreman-bridge/`, run `node integrations/foreman-bridge/scripts/update-source-manifest.mjs --write` and commit the manifest with the change (CI runs `--check`).
- C++ is built and tested on the Windows host from WSL via `powershell.exe`; the starter checkout is `D:\Modding\ForemanBridge` (`/mnt/d/Modding/ForemanBridge`), plugin at `Mods\ForemanBridge`, settings in its ignored `build.local.json`.
- Work on branch `feature/bridge-v2-spec` in `/home/max/projects/ficsit-foreman-bridge-v2` (rename to `feature/bridge-v2` when opening the first implementation PR). Nothing is deployed from `main` between this plan's PRs.

## Review Focus

1. **Machine with no recipe set** (fresh Constructor, cleared recipe) — `recipe: null` on the wire, grouped under `key: null`, shown as "no recipe", never dropped. Tests: Task 2 (codec accepts null), Task 8 (`groups recipe includes null key`), Task 11 (`formats null recipe as no recipe`).
2. **Slider dragging fires the potential delegate dozens of times** — one `reconfigured` event per drain, not one per callback. Tests: Task 5 (`RecaptureQueue deduplicates repeated requests`; unchanged row → `Reconfigure` returns nullopt).
3. **Buildable dismantled between enqueue and drain** — the stale request is skipped without a crash or event. Test: Task 5 (`drain skips untracked entity`); the engine side skips stale weak pointers (Task 6).
4. **Display-name collisions in game data** — e.g. recipe "Turbo Rifle Ammo" is both `Recipe_CartridgeChaos_C` and `Recipe_CartridgeChaos_Packaged_C`: ambiguous, tool error listing both, no query sent. Test: Task 10 (`ambiguous recipe lists candidates`).
5. **Modded or newer-build class not in game data** — row kept, shown by class name with `unresolved: true`, counted in totals and groups. Test: Task 10 (`unknown path is unresolved`) and Task 11 (`keeps unresolved rows`).

---

### Task 0: Part 0 — v1 real-game acceptance (manual, with the user)

**Acceptance passed:** the user confirmed on 2026-10-16 that all five checks
were completed with Claude and passed. The acceptance document records this
confirmation; detailed observations were not preserved in the handoff. Do not
repeat the manual checks solely because the original checklist was not updated.

**Files:**
- Modify: `docs/live-constructor-awareness.md` ("Real game / web-chat acceptance" section)

- [x] **Step 1:** With the user, on the isolated dedicated server with the linked playthrough and the current `main` build, run the five steps listed under "Real game / web-chat acceptance" in `docs/live-constructor-awareness.md`.
- [x] **Step 2:** Replace "**Status: outstanding.**" with "**Status: passed (2026-MM-DD).**" and record observed counts/positions, the stale interval, recovery, model wording and the unavailable case, separately from the automated results. If any step fails, stop and raise it with the user before Task 1. *(Status recorded; the detailed observations were not preserved and are deliberately not reconstructed.)*
- [x] **Step 3: Commit** — `docs(bridge): record v1 real-game acceptance`.

### Task 1: Build mirror and Part 1 spike

The spike is throwaway: probe code lives only on a local `spike/bridge-v2` branch of the starter's plugin checkout and is never merged. Its output is a findings document that Tasks 4–6 consume.

**Files:**
- Create: `integrations/foreman-bridge/mod/Scripts/Sync-Starter.ps1`
- Create: `integrations/foreman-bridge/mod/docs/v2-spike.md`
- Modify: `integrations/foreman-bridge/mod/README.md` (Native Windows builds: sync first)

**Interfaces:**
- Produces: `Sync-Starter.ps1 -Settings <build.local.json>` — mirrors this repository's `mod/` (`Source`, `Tests`, `Scripts`, `docs`, `ForemanBridge.uplugin`, `README.md`, `.clang-format`, `.gitignore`) into `<starterRoot>\Mods\ForemanBridge` with `robocopy /MIR` per directory, never touching `.git`, `Binaries`, `Intermediate`, `Saved`, `out` or `build.local.json`. This repository's copy is canonical; the starter checkout is a build mirror.
- Produces: `v2-spike.md` answering each question below with evidence (log line or screenshot reference) and the decision taken.

- [ ] **Step 1:** Write `Sync-Starter.ps1`; run it from WSL: `powershell.exe -File "$(wslpath -w integrations/foreman-bridge/mod/Scripts/Sync-Starter.ps1)" -Settings 'D:\Modding\ForemanBridge\Mods\ForemanBridge\build.local.json'`. Expected: `git -C /mnt/d/Modding/ForemanBridge/Mods/ForemanBridge status --short` shows no source differences from this repository's `mod/` (same files as manifest `sourceCommit` plus this repo's edits).
- [ ] **Step 2:** On `spike/bridge-v2` in the starter checkout, add a probe that logs (category `LogForemanBridgeSpike`) on the dedicated server:
  - `SUBSCRIBE_METHOD_AFTER(AFGBuildableManufacturer::SetRecipe, …)` firing;
  - a hook after `AFGBuildableFactory::SetIsProductionPaused` (record its exact signature);
  - binding `mOnPendingPotentialChanged` and `mOnPendingProductionBoostChanged` on a placed manufacturer (record delegate types/signatures);
  - the potential inventory's item added/removed delegate names (record from `FGInventoryComponent.h`) firing on shard and Somersloop insert/remove;
  - a hook on `AFGBuildable::OnUseStop_Implementation` (or the factory override) — does it fire on the server?
  - recipe/potential read at construction and again 2 s later for a blueprint-placed manufacturer (is config applied after `BeginPlay`?);
  - for one water extractor, one miner and one resource-well extractor: `GetExtractableResource()` validity, resource class, whether it is an `AFGResourceNode` (purity);
  - the generator class hierarchy for Coal, Fuel, Nuclear and Biomass generators (is `AFGBuildableGeneratorFuel` enough?);
  - whether a Power Shard count can be read from `GetPotentialInventory()` by item class (`Desc_CrystalShard_C`) and Somersloops by `Desc_WAT1_C`.
- [ ] **Step 3:** `Build.ps1 -Mode Package`, `Stage-Test.ps1`; the user performs each action in game; collect the log.
- [ ] **Step 4:** Write `v2-spike.md`: one row per question → finding → decision. Decisions must name, for each change path in the spec's "Change detection" table, either the verified hook/delegate or "near-player sweep fallback". If any hook does not fire on the dedicated server, stop and raise it with the user (the fallback becomes primary and Task 5 changes).
- [ ] **Step 5:** Update the mod README build steps (`Sync-Starter.ps1` before `Build.ps1`), manifest `--write`, **commit** — `build(bridge): mirror plugin source into the starter and record the v2 spike`.

### Task 2: Protocol v2 rows and fixture (receiver codec)

**Files:**
- Create: `integrations/foreman-bridge/receiver/src/rows.mjs`
- Modify: `integrations/foreman-bridge/receiver/src/protocol.mjs` (protocol 2, event types/origins, import `validateRow` from `rows.mjs`)
- Create: `integrations/foreman-bridge/receiver/fixtures/v2.json`; delete `fixtures/v1.json`
- Create: `integrations/foreman-bridge/mod/Tests/fixtures/v2.json` (byte-identical copy); delete `mod/Tests/fixtures/v1.json`
- Modify: `integrations/foreman-bridge/receiver/test/protocol.test.mjs`
- Create: `integrations/foreman-bridge/mod/docs/protocol-v2.md`; delete `mod/docs/protocol-v1.md`

**Interfaces:**
- Produces (`rows.mjs`):
  - `export const CATEGORY_SCHEMAS` — frozen table `{ manufacturer: {recipe:'path', clockSpeed:'number', productionBoost:'number', powerShards:'uint32', somersloops:'uint32', paused:'boolean'}, extractor: {resource:'path', purity:'purity', node:'path', clockSpeed:'number', powerShards:'uint32', paused:'boolean'}, generator: {fuel:'path', clockSpeed:'number', powerShards:'uint32', paused:'boolean'}, storage: {} }`; every field required-present and nullable.
  - `export function validateRow(row)` — v1 checks plus `category` ∈ table keys and `config` validated against `CATEGORY_SCHEMAS[row.category]` (exact key set; `path` = nonempty string ≤ 4096 bytes; `number` finite; `uint32` integer 0..4294967295; `purity` ∈ `impure|normal|pure`); throws `ProtocolError('invalid_row')`.
  - `export function className(path)` — final `.`-segment, or the whole string if none.
- `protocol.mjs`: `protocol` must equal `2` (else `unsupported_protocol`, 426); event types `buildable.upsert|buildable.remove`; origins `placed|reconciled|reconfigured`.
- Fixture `v2.json` keeps v1's structure and adds valid rows for all four categories (one manufacturer with `recipe: null`), and invalid cases: unknown category, missing config field, extra config field, `purity: "excellent"`, `powerShards: -1`, `clockSpeed: "1"`, `storage` config with a field, `constructor.upsert` type, `protocol: 1`.

- [ ] **Step 1: Write failing tests** in `protocol.test.mjs`: every `v2.json` valid case decodes; every invalid case throws with the fixture's expected code; `className('/Game/X/Build_SmelterMk1.Build_SmelterMk1_C') === 'Build_SmelterMk1_C'`.
- [ ] **Step 2:** `cd integrations/foreman-bridge/receiver && node --test test/protocol.test.mjs` → FAIL (missing `rows.mjs` / v1 protocol).
- [ ] **Step 3:** Implement `rows.mjs` and the `protocol.mjs` changes; write `protocol-v2.md` (v1 document updated: rows, config table, events, `pioneers` reserved for Part 2 and rejected until then).
- [ ] **Step 4:** Re-run → PASS. Other receiver tests may fail until Task 7; note which.
- [ ] **Step 5:** Manifest `--write`; **commit** — `feat(bridge)!: define protocol v2 rows with per-category configuration` + `BREAKING CHANGE: protocol 1 is no longer accepted`.

### Task 3: Protocol v2 rows in the native codec

**Files:**
- Modify: `mod/Source/ForemanBridge/Private/Core/BridgeTypes.h`
- Create: `mod/Source/ForemanBridge/Private/Wire/JsonFields.h/.cpp` (the generic helpers now at the top of `BridgeWire.cpp`: `Text`, `Fields`, `Uuid`, `Seq`, `Number`, `UInt`, `Parse`, …)
- Create: `mod/Source/ForemanBridge/Private/Wire/RowCodec.h/.cpp` (row + config encode/decode, category schema table)
- Modify: `mod/Source/ForemanBridge/Private/BridgeWire.cpp` (envelope/requests only; uses the two above)
- Modify: `mod/Source/ForemanBridge/Private/Tests/BridgeWireTests.cpp`

**Interfaces:**
- Produces (`BridgeTypes.h`, namespace `foreman`):
  ```cpp
  enum class Category { Manufacturer, Extractor, Generator, Storage };
  enum class Purity { Impure, Normal, Pure };
  struct ManufacturerConfig { std::optional<std::string> recipe; std::optional<double> clockSpeed, productionBoost; std::optional<uint32_t> powerShards, somersloops; std::optional<bool> paused; bool operator==(const ManufacturerConfig&) const = default; };
  struct ExtractorConfig { std::optional<std::string> resource; std::optional<Purity> purity; std::optional<std::string> node; std::optional<double> clockSpeed; std::optional<uint32_t> powerShards; std::optional<bool> paused; bool operator==(const ExtractorConfig&) const = default; };
  struct GeneratorConfig { std::optional<std::string> fuel; std::optional<double> clockSpeed; std::optional<uint32_t> powerShards; std::optional<bool> paused; bool operator==(const GeneratorConfig&) const = default; };
  struct StorageConfig { bool operator==(const StorageConfig&) const = default; };
  using Config = std::variant<ManufacturerConfig, ExtractorConfig, GeneratorConfig, StorageConfig>; // variant index == Category
  Category CategoryOf(const Config& config);
  // Row gains: Config config;  (category is derived, never stored separately)
  enum class Origin { Placed, Reconciled, Reconfigured };
  ```
- Produces (`RowCodec.h`): `TSharedPtr<FJsonObject> RowToJson(const foreman::Row&)`, `bool RowFromJson(const TSharedPtr<FJsonObject>&, foreman::Row&)`; category names and per-category field encoders live in one table indexed by `Category`.
- `BridgeWire` public interface unchanged.

- [ ] **Step 1: Write failing tests** in `BridgeWireTests.cpp`: decode every `v2.json` valid/invalid case (same verdicts as JS); round-trip one row per category through `EncodeRequest`/`DecodeRequest` with `operator==`; the interop export (`out/wire-interop.json`) includes one exchange per category.
- [ ] **Step 2:** Sync, `Build.ps1 -Mode Editor`, `Test-Unreal.ps1 -Filter ForemanBridge.Wire` → FAIL (compile or assertions).
- [ ] **Step 3:** Implement the types, split `BridgeWire.cpp` into the three units, and the row codec table. `Test-Core.ps1 -Case State` and `-Case Delivery` must still compile (State/Delivery are config-agnostic).
- [ ] **Step 4:** `Test-Unreal.ps1 -Filter ForemanBridge.Wire` → PASS; `Test-Core.ps1 -Case State` and `-Case Delivery` → PASS; in WSL `node --test test/protocol.test.mjs` decodes the fresh interop export → PASS.
- [ ] **Step 5:** Manifest `--write`; **commit** — `feat(bridge)!: encode protocol v2 rows in the plugin` + `BREAKING CHANGE` footer.

### Task 4: Buildable registry and capture functions

**Files:**
- Create: `mod/Source/ForemanBridge/Private/Capture/BuildableRegistry.h/.cpp`
- Create: `mod/Source/ForemanBridge/Private/Capture/ManufacturerCapture.cpp`, `ExtractorCapture.cpp`, `GeneratorCapture.cpp`, `StorageCapture.cpp`, `CaptureShared.h/.cpp` (shard/Somersloop counting, paused, clock speed, common row: transform, `BuiltBy` player — moved from `BridgeGameAdapter.cpp`)
- Modify: `mod/Source/ForemanBridge/Private/BridgeGameAdapter.h/.cpp` (keep only `BroadcastPlainChat`)
- Create: `mod/Source/ForemanBridge/Private/Tests/BridgeRegistryTests.cpp`
- Modify: `mod/Source/ForemanBridge/Private/Tests/BridgeProbeTests.cpp` (`CaptureConstructor(nullptr)` → `CaptureBuildable(nullptr)`)

**Interfaces:**
- Consumes: `foreman::Config`, `foreman::Row` (Task 3); spike decisions (Task 1) for the generator bases, extractor resource reads, and shard/Somersloop item classes.
- Produces:
  ```cpp
  using FCaptureConfig = foreman::Config (*)(AFGBuildable& Buildable);
  struct FRegistryEntry { UClass* (*BaseClass)(); foreman::Category Category; FCaptureConfig Capture; };
  TConstArrayView<FRegistryEntry> BuildableRegistry();            // ordered, most specific first
  const FRegistryEntry* FindRegistryEntry(const UClass* Class);   // first entry whose base the class derives from
  TOptional<foreman::Row> CaptureBuildable(AFGBuildable* Buildable); // nullopt: invalid, no authority, unregistered, non-finite transform
  ```
  `CaptureBuildable` assigns a fresh GUID `entityId`; the caller replaces it for already-tracked actors (as v1 did).

- [ ] **Step 1: Write failing tests** (`ForemanBridge.Registry`): `FindRegistryEntry(AFGBuildableManufacturer::StaticClass())->Category == Manufacturer`; same for each registered base; `FindRegistryEntry(AFGBuildableStorage::StaticClass())` is `Storage` even though it derives from `AFGBuildableFactory`; `FindRegistryEntry(AFGBuildableFactory::StaticClass()) == nullptr`; `FindRegistryEntry(AFGBuildable::StaticClass()) == nullptr`; loading `Build_SmelterMk1_C` and `Build_ConstructorMk1_C` by path resolves to `Manufacturer`; `CaptureBuildable(nullptr)` is unset.
- [ ] **Step 2:** Sync, build Editor, `Test-Unreal.ps1 -Filter ForemanBridge.Registry` → FAIL.
- [ ] **Step 3:** Implement the registry and the four capture functions using the accessors named in the spec's "Capture" section and the spike's decisions; unreadable fields stay `std::nullopt`.
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5:** Manifest `--write`; **commit** — `feat(bridge): capture production buildables through a native-class registry`.

### Task 5: Re-capture queue and reconfigure rule (engine-independent core)

All decision logic for re-capture lives here, in code `Test-Core.ps1` can exercise; Task 6 is thin engine glue (the existing Unreal tests spawn no world).

**Files:**
- Create: `mod/Source/ForemanBridge/Private/Core/RecaptureQueue.h/.cpp`
- Modify: `mod/Source/ForemanBridge/Private/Core/BridgeState.h/.cpp` (add `Reconfigure`)
- Modify: `mod/Tests/CoreTests.cpp` (new case `Recapture`; `State` case gains `Reconfigure` tests)
- Modify: `mod/Scripts/Test-Core.ps1` (`ValidateSet` gains `Recapture`; compile `RecaptureQueue.cpp`)

**Interfaces:**
- Produces:
  ```cpp
  namespace foreman {
  class RecaptureQueue {
  public:
      explicit RecaptureQueue(size_t perDrainCap);
      void Request(const std::string& entityId, MonotonicTime dueAt); // keeps the earliest due time per entity
      std::vector<std::string> Drain(MonotonicTime now);              // due entries, earliest first, at most perDrainCap
      void Forget(const std::string& entityId);                       // on removal
      size_t Pending() const;
  };
  constexpr size_t RecapturePerTickCap = 64;
  constexpr MonotonicTime SettleDelay{2000};
  // State gains:
  //   std::optional<Event> Reconfigure(Row row);
  // nullopt when the entity is not in the projection or the row equals the stored row;
  // otherwise an Upsert with Origin::Reconfigured (same sequencing/retention as Upsert).
  }
  ```

- [ ] **Step 1: Write failing tests**: (`Recapture` case) `RecaptureQueue deduplicates repeated requests` (100 requests for one id → `Drain` returns it once, `Pending()==0` after); earliest due wins (request at 5000 then 1000 → due at 1000); not-yet-due entries stay; cap (`perDrainCap=2`, 5 due → 2, then 2, then 1, in due order); `Forget` removes a pending entry. (`State` case) `drain skips untracked entity` — `Reconfigure` of an unknown entity returns nullopt and leaves `Latest()` unchanged; unchanged row → nullopt; changed `ManufacturerConfig::recipe` → one event with `Origin::Reconfigured` and the next sequence.
- [ ] **Step 2:** `powershell.exe -File …\Test-Core.ps1 -Case Recapture` and `-Case State` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `-Case Recapture`, `-Case State`, `-Case Delivery` → PASS.
- [ ] **Step 5:** Manifest `--write`; **commit** — `feat(bridge): add a deduplicating re-capture queue and reconfigure rule`.

### Task 6: Change detection, buildable tracker and `RequestRecapture`

**Files:**
- Create: `mod/Source/ForemanBridge/Private/Tracking/BuildableTracker.h/.cpp` (entity map, baseline, place/remove, drain → upsert)
- Create: `mod/Source/ForemanBridge/Private/Tracking/ChangeSignals.h/.cpp` (process-wide signal + SML hook installation)
- Create: `mod/Source/ForemanBridge/Public/ForemanBridgeLibrary.h`, `Private/ForemanBridgeLibrary.cpp`
- Modify: `mod/Source/ForemanBridge/Public/BridgeSubsystem.h`, `Private/BridgeSubsystem.cpp` (lifecycle only), create `Private/BridgePump.cpp` (pump + command dispatch moved out)
- Modify: `mod/Source/ForemanBridge/Private/ForemanBridgeModule.cpp` (install hooks once at module start-up)
- Create: `mod/Source/ForemanBridge/Private/Tests/BridgeTrackerTests.cpp`
- Modify: `mod/README.md` ("Public API for other mods" section)

**Interfaces:**
- Consumes: `CaptureBuildable` (Task 4), `RecaptureQueue` (Task 5), `foreman::State::Upsert/Remove` (unchanged), spike decisions (Task 1).
- Produces:
  ```cpp
  // ChangeSignals.h — hooks, per-buildable delegates and the public API all funnel here.
  DECLARE_MULTICAST_DELEGATE_OneParam(FOnBuildableConfigChanged, AFGBuildable*);
  FOnBuildableConfigChanged& OnBuildableConfigChanged();
  void InstallChangeHooks(); // idempotent; logs each hook it could not install

  // BuildableTracker.h
  class FBuildableTracker {
  public:
      FBuildableTracker(foreman::State& State, std::function<foreman::MonotonicTime()> Clock);
      std::vector<foreman::Row> Baseline(const TArray<AFGBuildable*>& All); // fills the entity map
      TOptional<foreman::Event> OnPlaced(AFGBuildable* Buildable);          // upsert(placed) + settle request
      TOptional<foreman::Event> OnRemoved(AFGBuildable* Buildable);         // v1 dismantle-evidence rule kept
      void RequestRecapture(AFGBuildable* Buildable);                       // tracked only; else ignored
      std::vector<foreman::Event> Drain();                                  // RecaptureQueue::Drain → CaptureBuildable (stale weak pointers skipped) → State::Reconfigure
      bool HasUnresolvedRemoval() const;
  };

  // ForemanBridgeLibrary.h (Public)
  UCLASS() class FOREMANBRIDGE_API UForemanBridgeLibrary : public UBlueprintFunctionLibrary {
      GENERATED_BODY()
  public:
      UFUNCTION(BlueprintCallable, Category = "Foreman Bridge")
      static void RequestRecapture(AFGBuildable* Buildable); // server only, game thread only; no-op otherwise
  };
  ```
- The subsystem binds `OnBuildableConfigChanged()` → `Tracker->RequestRecapture`, binds per-buildable potential/boost/inventory delegates on track (per the spike) and unbinds on removal, hooks `OnUseStop` only if the spike confirmed it fires on the server, and calls `Tracker->Drain()` from the existing 0.1 s pump timer. Change paths the spike could not verify use the near-player sweep: buildables within 50 m of each player, every 10 pump ticks, through the same queue (implement only if the spike requires it).
- The plugin's chat-command dispatch is unchanged; the placement greeting disappears because the receiver stops issuing it (Task 7).
- `Status()` text: `constructors=` becomes `buildables=`; provenance `bridgeVersion` becomes `"0.2.0"`.

- [ ] **Step 1: Write failing tests** (`ForemanBridge.Tracker`, default objects only, as `BridgeProbeTests.cpp` does): `UForemanBridgeLibrary::RequestRecapture(nullptr)` is a no-op; `OnBuildableConfigChanged()` broadcast with `nullptr` reaches a bound tracker without emitting; `InstallChangeHooks()` called twice installs once. Behaviour with real buildables is covered by Task 5's core tests and Task 13's acceptance.
- [ ] **Step 2:** Sync, build Editor, `Test-Unreal.ps1 -Filter ForemanBridge.Tracker` → FAIL.
- [ ] **Step 3:** Implement; split `BridgeSubsystem.cpp` so each file is ≤ 300 lines and each function ≤ 60 lines.
- [ ] **Step 4:** `Test-Unreal.ps1 -Filter ForemanBridge` (all) → PASS; `Build.ps1 -Mode Package` → success; `Test-Staging.ps1` → PASS. Stage on the test server and confirm in the log: one `placed` upsert per build, one `reconfigured` upsert after dragging the clock slider, none after closing an unchanged machine.
- [ ] **Step 5:** Manifest `--write`; **commit** — `feat(bridge): detect configuration changes and expose RequestRecapture`.

### Task 7: Receiver v2 storage

**Files:**
- Create: `integrations/foreman-bridge/receiver/src/store/schema.mjs` (DDL, `user_version` 2, v1 reset)
- Create: `integrations/foreman-bridge/receiver/src/store/projection.mjs` (put/delete/count buildables)
- Modify: `integrations/foreman-bridge/receiver/src/store.mjs` (ingestion uses `projection.mjs`; no chat generation on placement; `queryConstructors` and `readState`'s location listing removed — Task 8 adds the v2 query)
- Modify: `integrations/foreman-bridge/receiver/src/server.mjs` (remove `QUERY_ROUTE`; the query token is unused until Task 8)
- Delete: `receiver/test/query.test.mjs`, `receiver/test/query-server.test.mjs` (rewritten in Task 8)
- Modify: `receiver/test/store.test.mjs`, `recovery.test.mjs`, `acceptance-gate.test.mjs`, `server.test.mjs`, `test/support.mjs`, `scripts/replay-scenario.mjs`, `scripts/acceptance-receiver.mjs` (v2 rows)

**Interfaces:**
- Produces:
  - `export const SCHEMA_VERSION = 2; export function migrate(db)` — on `user_version` < 2 with existing tables: drop `constructors`, delete from `snapshot_chunks`, `snapshots`, `receipts`, `commands`, `connections`, `epochs`, `sync_metadata`, `worlds`; create v2 tables; set `user_version = 2`. On a fresh database: create and set.
  - Table `buildables(world_id, epoch, entity_id, category, class_name, recipe_name, row_json, PRIMARY KEY(world_id,epoch,entity_id))`, indexes `(world_id,epoch,category)`, `(world_id,epoch,class_name)`, `(world_id,epoch,recipe_name)`.
  - `projection.mjs`: `putBuildable(db, worldId, epoch, row)`, `deleteBuildable(db, worldId, epoch, entityId)`, `clearBuildables(db, worldId, epoch)`.
  - Store method `current(worldId)` keeps its contract over `buildables`.

- [ ] **Step 1: Write failing tests**: opening a database created by the v1 schema (build it in the test with the v1 DDL and one constructor row) yields `user_version === 2` and the world reads `unavailable/no_baseline`; a committed snapshot with one row per category is returned by `current()`; a `reconfigured` upsert replaces the row and changes the revision; an accepted `placed` upsert produces **no** command in the exchange reply.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement; each new file ≤ 300 lines.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Manifest `--write`; **commit** — `feat(bridge)!: store protocol v2 buildables in the receiver` + `BREAKING CHANGE: v1 receiver databases are reset on open`.

### Task 8: Receiver `/query/v2/buildables`

**Files:**
- Modify: `integrations/foreman-bridge/receiver/src/query.mjs` (`validateBuildablesQuery` replaces `validateQuery`)
- Create: `integrations/foreman-bridge/receiver/src/store/buildablesQuery.mjs` (`readBuildables`)
- Modify: `integrations/foreman-bridge/receiver/src/store.mjs` (add `queryBuildables`), `src/server.mjs` (`QUERY_ROUTE = '/query/v2/buildables'`)
- Create: `receiver/test/query.test.mjs`, `receiver/test/query-server.test.mjs` (v2)
- Create: `receiver/scripts/synthetic-world.mjs`
- Create: `receiver/docs/query-v2.md`; delete `receiver/docs/query-v1.md`

**Interfaces:**
- Produces: `validateBuildablesQuery(input) → { filter: {category?, className?, recipeName?}, groupBy?, from?, includeRows, limit, cursor? }` — unknown keys anywhere → `invalid_query`; `cursor` requires `includeRows: true` and no `from`; `from` is three finite numbers.
- Produces: `store.queryBuildables(binding, input)` → the spec's response (`protocol: 2`, status fields as v1, `totalCount`, `groups` only when `groupBy`, `rows` only when `includeRows`, `coordinateSystem`, `returnedCount`, `hasMore`, `nextCursor`). `groups` sorted by count desc then key; `distanceMetres` = Euclidean distance in cm ÷ 100, rounded to 0.1. Cursor format unchanged (`encodeCursor`/`decodeCursor`).
- Produces: `node scripts/synthetic-world.mjs --rows 5000` — builds a temporary database through the real store (snapshot of N generated rows across all categories), prints JSON `{rows, snapshotCommitMs, countQueryMs, groupByRecipeMs, distance100Ms}`.

- [ ] **Step 1: Write failing tests**: filter by `className` and by `recipeName`; `groups recipe includes null key`; distance mode returns ascending `distanceMetres`, `nextCursor: null`, `hasMore` true when more match; `cursor` + `from` → 400 `invalid_query`; stale cursor → 409 `state_changed`; v1 route → 404 for the query token's request; producer token on the v2 route → 401.
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement; write `query-v2.md` from `query-v1.md` with the v2 request/response and an example.
- [ ] **Step 4:** `npm test` → PASS (all receiver tests). `node scripts/synthetic-world.mjs --rows 5000` → prints timings; paste them into the commit body.
- [ ] **Step 5:** Manifest `--write`; **commit** — `feat(bridge)!: serve live buildables over /query/v2/buildables` + `BREAKING CHANGE: /query/v1/constructors is removed`.

### Task 9: ff-server bridge client v2

**Files:**
- Modify: `packages/ff-server/src/bridge/types.ts`, `packages/ff-server/src/bridge/client.ts`
- Create (if `client.ts` would exceed 300 lines): `packages/ff-server/src/bridge/responseSchema.ts` (zod schema of the v2 response)
- Modify: `packages/ff-server/test/bridge-client.test.ts`

**Interfaces:**
- Produces (`types.ts`): `BuildableCategory`, `ManufacturerConfig`, `ExtractorConfig`, `GeneratorConfig`, `StorageConfig` (mirroring Task 2's table, `null`able fields), `BuildableRow { entityId; category; classPath; position: [number,number,number]; config; distanceMetres?: number }`, `BuildablesQuery` (Task 8 request), `BuildablesState` (Task 8 response, `protocol: 2`), `BridgeClient { query(query: BuildablesQuery): Promise<BuildablesState> }`. `ConstructorQuery`/`ConstructorState`/`ConstructorLocation` are deleted.
- Client path `/query/v2/buildables`; response validated against the schema (a config that does not match its category → `invalid_response`).

- [ ] **Step 1: Write failing tests**: a valid v2 response per category parses; `protocol: 1` → `invalid_response`; manufacturer row carrying `fuel` → `invalid_response`; request goes to `/query/v2/buildables`.
- [ ] **Step 2:** `npm test -w @foreman/ff-server -- test/bridge-client.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Re-run → PASS; `npm run lint -w @foreman/ff-server` → clean.
- [ ] **Step 5:** **Commit** — `feat(server)!: query the receiver's v2 buildables contract`.

### Task 10: Game-data names for live tools

**Files:**
- Create: `packages/ff-server/src/bridge/gameNames.ts`
- Modify: `packages/ff-server/src/index.ts` (when the bridge is configured, `loadGameData()` from `@foreman/sf-game-data`, log its warning, build `GameNames`)
- Create: `packages/ff-server/test/gameNames.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type NameResolution =
    | { ok: true; className: string }
    | { ok: false; reason: 'unknown' | 'ambiguous'; candidates: string[] }; // display names (ambiguous) or up to 5 closest display names (unknown)
  export interface DisplayName { name: string; unresolved: boolean }
  export interface GameNames {
    resolveBuilding(name: string): NameResolution;   // exact, case-insensitive, display name or class name
    resolveRecipe(name: string): NameResolution;
    displayName(pathOrClassName: string): DisplayName; // buildings, recipes, items and resources; unknown → class name, unresolved: true
  }
  export function createGameNames(gameData: GameData): GameNames;
  ```
  "Closest" for unknown names = display names containing the query as a case-insensitive substring, first 5 alphabetically; no fuzzy matching beyond that.

- [ ] **Step 1: Write failing tests** (against the bundled stable dataset via `loadGameData`): `resolveBuilding('Smelter')` → `Build_SmelterMk1_C`; `resolveBuilding('build_smeltermk1_c')` → same; `resolveRecipe('Alternate: Pure Iron Ingot')` → `Recipe_Alternate_PureIronIngot_C`; `ambiguous recipe lists candidates` (`'Turbo Rifle Ammo'` → `ambiguous`, both class names' display entries); `resolveRecipe('Iron')` → `unknown` with candidates containing `'Iron Ingot'`; `displayName('/Game/…/Build_SmelterMk1.Build_SmelterMk1_C')` → `{name:'Smelter', unresolved:false}`; `unknown path is unresolved` (`'/Game/Mod/Build_Thing.Build_Thing_C'` → `{name:'Build_Thing_C', unresolved:true}`).
- [ ] **Step 2:** `npm test -w @foreman/ff-server -- test/gameNames.test.ts` → FAIL.
- [ ] **Step 3:** Implement (indexes built once in `createGameNames`).
- [ ] **Step 4:** Re-run → PASS; lint clean.
- [ ] **Step 5:** **Commit** — `feat(server): resolve live building and recipe names from game data`.

### Task 11: `get_live_buildables` tool and prompt

**Files:**
- Modify: `packages/ff-server/src/tools/liveStateTools.ts` (becomes the live-tool registry: binding check, advertising, dispatch; keeps exports `liveStateToolDefinitions`, `isLiveStateTool`, `handleLiveStateTool`, `LiveStateService`)
- Create: `packages/ff-server/src/tools/live/freshness.ts` (status/freshness wording moved from `liveStateTools.ts`)
- Create: `packages/ff-server/src/tools/live/buildablesTool.ts`
- Modify: `packages/ff-server/src/index.ts` (`LiveStateService` gains `names: GameNames`)
- Modify: `packages/ff-server/SYSTEM_PROMPT.md` ("Live Constructor Observations" → "Live Factory Observations")
- Modify: `packages/ff-server/test/liveStateTools.test.ts`, `test/bridge-integration.test.ts`, `test/chat.test.ts` / `test/anthropic.test.ts` where they name the old tool
- Modify: `.github/workflows/foreman-bridge.yml` (paths add `packages/ff-server/src/tools/live/**`)

**Interfaces:**
- Consumes: `BridgeClient` (Task 9), `GameNames` (Task 10).
- Produces:
  ```ts
  export interface LiveTool {
    definition: ToolDefinition;
    handle(args: unknown, service: LiveStateService): Promise<ToolInvocationResult>;
  }
  export const LIVE_TOOLS: readonly LiveTool[]; // Part 2 appends get_my_live_position here
  export const LIVE_BUILDABLES_TOOL = 'get_live_buildables';
  ```
- Model arguments exactly as the spec's `get_live_buildables` block (zod `strictObject`; `limit` 1..100; `cursor` requires `includeRows: true` and no `nearestTo`). `nearestTo` metres × 100 → `from`. `building`/`recipe` resolve through `GameNames`; on failure return a tool error naming the candidates and do not call the client.
- Output text: freshness line (as v1), total, groups as `display name: count` (`null` recipe → "no recipe"), and rows with building, recipe, configuration (clock speed as a percentage, shards, Somersloops, paused), `positionMetres`, `distanceMetres`; unresolved names marked "(not in game data)".
- Prompt rules as listed in the spec's "System prompt" section (Part 1 rules only; the Pioneer rule arrives with Part 2).

- [ ] **Step 1: Write failing tests** (`liveStateTools.test.ts`): tool advertised only to the linked playthrough; model cannot pass identities (unknown key rejected); `building: 'Smelter'` sends `filter.className: 'Build_SmelterMk1_C'`; ambiguous recipe → error, client not called; `nearestTo {x:1,y:2,z:3}` sends `from [100,200,300]`; `formats null recipe as no recipe`; `keeps unresolved rows`; unavailable client → "unavailable" result while other tools keep working; old tool name `get_live_constructor_state` is no longer advertised.
- [ ] **Step 2:** `npm test -w @foreman/ff-server -- test/liveStateTools.test.ts` → FAIL.
- [ ] **Step 3:** Implement; update the prompt; update `bridge-integration.test.ts` to drive the real receiver with a v2 snapshot and assert one tool answer per category.
- [ ] **Step 4:** `npm test -w @foreman/ff-server` → PASS (integration test runs on local Node 24.21); `npm run lint -w @foreman/ff-server` → clean.
- [ ] **Step 5:** **Commit** — `feat(server)!: answer live factory questions with get_live_buildables` + `BREAKING CHANGE: get_live_constructor_state is removed`.

### Task 12: Docs, ratchet and roadmap housekeeping

**Files:**
- Rename/modify: `docs/live-constructor-awareness.md` → `docs/live-world-awareness.md` (v2 scope, setup, tool, supported remote-management mods, "unsupported" list); update links in `AGENTS.md` table, `integrations/foreman-bridge/README.md`, `receiver/README.md`, `mod/README.md`, `.env.example` comments if they name constructors
- Modify: `source-limits.json` (remove the `integrations/foreman-bridge/` exemption)
- Modify: `integrations/foreman-bridge/source-manifest.json` (`--write`)

- [ ] **Step 1:** Remove the exemption; run `npm run check:source`. Expected: no failure for any bridge file (fix any over-limit or header-less file in the task that owns it, not by re-adding the exemption).
- [ ] **Step 2:** Write the docs; `grep -rn "get_live_constructor_state\|query/v1\|protocol-v1\|constructor.upsert" --exclude-dir=node_modules --exclude-dir=.git .` → only historical specs/plans under `docs/superpowers/` match.
- [ ] **Step 3:** `npm run lint` and `npm run check:source` at the root → clean; manifest `--check` → clean.
- [ ] **Step 4: Commit** — `docs(bridge): document live-world awareness and lift the bridge exemption` (`Refs #10`).
- [ ] **Step 5:** Edit #14's body: remove "clock speed, Somersloop boost" from machine status and note they ship in bridge v2 (`gh issue edit 14 -R max-is-loud/ficsit-foreman --body-file …`). Move #10 to In Progress on the board if not already.

### Task 13: Part 1 real-game acceptance (manual, with the user)

**Files:**
- Modify: `docs/live-world-awareness.md` (new "Part 1 acceptance" section)

- [ ] **Step 1:** Package, stage and deploy plugin, receiver and ff-server together on the isolated server (hard cut).
- [ ] **Step 2:** With the user, record: baseline counts per category vs in-game; place/remove; recipe, clock speed, shard, Somersloop and pause changes each observed (time from action to `fresh` answer); FicsIt-Networks recipe change via setter hook if installed, else "untested"; delivery interruption and recovery; per-buildable capture cost and snapshot timings from the plugin log at the world's size; the Task 8 synthetic timings.
- [ ] **Step 3:** Ask the foreman in web chat: "How many Smelters do I have and what are they making?", "Which machines are paused?", "Where are my Miners and on what purity?" — record answers.
- [ ] **Step 4: Commit** — `docs(bridge): record bridge v2 Part 1 acceptance` (`Closes #10` goes on the final PR only after Part 2 also ships; use `Refs #10` here).
