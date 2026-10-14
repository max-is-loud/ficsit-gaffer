# Authoritative constructor and existing-client chat probe

Task 3, disposable CL513885 Linux server and SML-only Windows client.
No receiver exists yet. Placement chat in this task is a local probe, not a
receiver round trip. Automated compilation does not prove any gameplay row.

| Case | Expected | Evidence/status |
| --- | --- | --- |
| Existing N constructors | Baseline N; zero placement events/chat | Reloaded saved N=1 at 13:45:56Z: baseline count 1/seq 0, no placement dispatch |
| Cancelled hologram | No event/count change | Supplied post-reload screenshot shows two count 1/seq 0 replies before rebuild; no event until dismantle |
| One placement | One upsert, N+1; visible local-probe chat | Observed: seq 1/count 1, one chat dispatch; supplied screenshot shows chat |
| Removal | One remove, N | Observed: seq 2/count 0, same entity as seq 1 |
| Same-position rebuild | Fresh entity ID; one upsert | Player supplied result of requested foundation-snap test; server removal seq 1 then upsert seq 2/new ID; screenshot count 1/seq 2 and one message |
| Distant area | Constructors stay represented; no false removal | Player reports distance test complete/count 1; no server removal/unresolved warning |
| Player reconnect | Same epoch/count; no repeated placements | Join at 13:44:46Z, unchanged epoch/seq 5/count 1; player reports count 1 |
| World reload | New epoch, baseline only; no duplicate additions | New epoch e32fbe73-6304-4162-841e-8b609dfceb46, count 1/seq 0 observed |
| Teardown | No dismantling events | Old epoch closed at 13:45:35Z with no removal events |
| `/foremanbridge status` | Existing SML reply visible; no client bridge | Supplied screenshot shows ready/count 0/seq 0; client has SML only |

Source evidence and actual results will be recorded separately below.

## Pinned source evidence

- Starter `8eebc9e`: native module discovery reads `bRootModule`; game-world
  construction registers ModSubsystems and initialisation registers chat commands.
- `FGBuildableSubsystem.h` declares dynamic one-actor constructed/removed
  delegates and `GetAllBuildablesRef`. `FGSaveSession.h` documents save loading
  before BeginPlay. Baseline runs next tick after subsystem BeginPlay/readiness,
  with delegates bound before enumeration on the game thread.
- Inspected starter asset `Content/FactoryGame/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.uasset`
  contains `Build_ConstructorMk1_C`; filter uses full generated-class path
  `/Game/FactoryGame/Buildable/Factory/ConstructorMk1/Build_ConstructorMk1.Build_ConstructorMk1_C`
  (including derived classes). No game asset is copied into this repository.
- `GetBuiltBy` is protected: native compilation caught this. Read only its
  reflected `BuiltBy` property after checking FPlayerInfoHandle type, then resolve
  exact platform cache. Missing identity stays null. Account IDs are not logged.
- Registry removal alone is insufficient evidence: require known entity plus
  dismantling flags. Unknown removal keeps evidence and visibly blocks adapter
  acceptance. World pre-teardown closes callbacks before actor EndPlay ordering.
- Source declarations alone were not treated as gameplay proof; observed results are in the table.

## Actual isolated runtime evidence — 2026-10-14

- Package LinuxServer SHA-256: `cbe21ac4f2774fddd207f3251626ee820ed3b08e569416d38798f467109a8c56`.
- Startup baseline 2026-10-14 13:28:49Z: epoch `c5e06163-a394-4512-ae0a-67d1244f55d1`, count 0, seq 0.
- 13:31:02Z upsert seq 1/entity `e5e004d6-f9bc-4de2-ae06-9aa4ccc3ecdc`, count 1, capture 0.040ms.
- 13:31:11Z remove seq 2/same entity, count 0, capture 0.005ms.
- 13:31:21Z upsert seq 3/entity `d5b11aab-0bca-49f7-b582-75e34ca32a0b`, count 1, capture 0.032ms.
- Two local chat dispatches, one per upsert. Supplied screenshot shows both
  messages and status reply; this is actual client visual evidence, not receiver evidence.
- Creator identity was null on this run. No creator ID is invented. Attribution
  is nullable under the contract; diagnostic refinement remains possible.
- Private evidence: TEST/evidence/task3-probe-startup.json (source hashes),
  task3-bridge-sanitised.log, task3-client-chat.png. Saved disposable checkpoint
  `ForemanBridge-Task3-OneConstructor` via API HTTP 204 for the reload check.
- These timings describe three tiny-world events; they do not establish large-world performance.

### Reload and final snapped rebuild

New epoch `e32fbe73-6304-4162-841e-8b609dfceb46` seeded one standing
constructor at seq 0 with no greeting. Supplied screenshot shows two status
replies at count 1/seq 0, consistent with the requested cancelled preview.
At 13:51:11Z removal seq 1 removed baseline entity
`d297efc4-2c27-4a7f-b920-66b7eb3f1684` (count 0, 0.005ms). At 13:51:15Z
upsert seq 2 created `42a3792d-f8d3-4c39-9685-9714e41203a6` (count 1,
0.015ms), with exactly one chat dispatch. Screenshot shows the constructor on
a foundation, one local-probe greeting and final count 1/seq 2. Placement at
the requested snap point/rotation is player-supplied evidence; coordinates
were not independently measured. Screenshot: TEST/evidence/task3-reload-rebuild-chat.png.

All Task 3 probe cases have supporting evidence above. The scope is this
small disposable world; larger-world coverage, receiver response and failure
matrix remain later gates. No custom client bridge was required.

## Task 7 local receiver roundtrip — 2026-10-14

Player reports local tests pass. New epoch `64ab2c3a-ffda-4a87-aae8-64ec1b9d24b6` seeded1 constructor. Placement at15:38:36.378Z produced seq1/count2; receiver ACK and existing-game chat dispatch at15:38:37.514Z:1.136seconds, callback0.031ms. Receiver durable data has exactly one event receipt, count2/cursor1 and one executed command. Player report corroborates visible chat; server timestamps measure dispatch rather than screen rendering. Evidence TEST/evidence/task7-roundtrip.json. Windows remains SML-only. Local TLS verified, redirects disabled, no local-probe greeting. Cross-machine and broader failure matrix remain Task8.
