# Implementation decisions

All rulings from the approved inline plan, in order, including costs and review scope. User requested retention of the local ledger.

- Task 1: Ruling: use the explicitly requested independent repository at Mods/ForemanBridge on feature/constructor-bridge as isolation; no additional worktree — preserves Unreal discovery and the approved location — cost if wrong: relocate the plugin checkout.

- Task 1: Ruling: initialise with an ignore-only commit so task-start has a BASE; reuse the existing private checkout's author identity locally — no global Git configuration changed — cost if wrong: amend unpublished author metadata.

- Task 1: Ruling: use installed Wwise integration 2025.1.6.9117.4248; the plan abbreviates it as 2025.1.6.4248 — execution record and installed descriptor establish the exact version — cost if wrong: rebuild matching integration.

- Task 1: Ruling: expose optional Build.ps1 -Plugin SML for the approved matching-source fallback; no automatic install or publication — same pinned packaging workflow — cost if wrong: remove unused option.

- Task 1: Ruling: use an isolated extracted 32-bit loader beside SteamCMD and Debian libraries beneath TEST/tools; bootstrap loader location controls SteamCMD update paths — no root/system package changes — cost if wrong: reprovision isolated installer.

- Task 1: Ruling: combine -UserDir with -SavesUseProjectSavedDir; game save code does not follow -UserDir alone — Linux log proves ServerSettings resolves to TEST/home/FactoryGame/Saved/SaveGames, and disposable autosave exists there — cost if wrong: stop test client/server and strengthen profile isolation before any world work.

- Task 1: Ruling: bundled DedicatedServerAPIDocs omit required GameModeSettings and spell bSkipOnboarding without b; use pinned FGDSGameplayTypes.h and runtime missing_params diagnostics — world creation returned HTTP 202 — cost if wrong: recreate only disposable world.

- Task 1: Ruling: the plan specifies build/game checks but no single task-done command. Use Scripts/Verify-Task1.ps1 to rerun staging checks and verify both archive hashes plus recorded real-game load/join evidence without repeating unchanged successful builds — cost if wrong: stale evidence could pass; mitigate by binding bridge game evidence to the package SHA-256. Initial run correctly failed: dual-target package manifest missing.

- Task 2: Ruling: expose a small Sequence allocator with an initial watermark and configurable maxSequence (default uint64 max); State always starts at zero — directly test real uint64 exhaustion plus State's disabled-emission path without billions of mutations or test-only setters — cost if wrong: adjust internal allocator interface before Delivery integration.

- Task 2: Ruling: Seed is one-shot, ignored after seed or first mutation; retain current projection on sequence exhaustion but require a new epoch and reject snapshot confirmation — prevents silent reset or falsely claiming post-exhaustion evidence is sequenced — cost if wrong: caller must create a new State for reinitialisation.

- Task 2: Ruling: charge conservative escaped-payload capacity plus DTO/container overhead per retained event, dropping oldest entries before enqueue; oversized single events remain reflected in current state but force a gap. ACKs never clear overflow; only matching valid snapshot confirmation does — keeps replay bounded without serialising the queue — cost if wrong: conservative accounting may request snapshots earlier than exact wire sizes.

- Task 3: Ruling: add a focused native automation test for module registration, nonreplicated/non-save defaults and safe absent-object handling; bring forward the generic Test-Unreal runner from Task 4 to execute it — verifies engine contracts test-first without substituting compilation for gameplay — cost if wrong: small runner refactor in Task 4.

- Task 3: Ruling: pinned GetBuiltBy is protected (observed native compiler failure); read reflected BuiltBy only when its FStructProperty matches FPlayerInfoHandle, then resolve matching platform cache without fallback — no SDK header edits or invented identity — cost if wrong: nullable attribution until the adapter is updated.

- Task 4: Ruling: specify missing wire details as typed provenance (gameVersion/smlVersion/bridgeVersion/starterCommit/bridgeSourceSha256), hello mode+cursor/reason, chunk echo snapshotId/index and commit echo snapshotId/watermark; oldestRetainedSeq=0 denotes no retained events — removes ambiguous placeholder envelopes before persistence/transport consume them — cost if wrong: coordinated protocol fixture change before service rollout.

- Task 4: Ruling: add native DecodeRequest alongside required EncodeRequest/DecodeResponse so both languages reject the exact same malformed request fixtures; export encoded requests for independent JS validation — prevents tests merely checking their own serializer — cost if wrong: small unused decoder surface in shipping code.

- Task 4: Ruling: cap strings/nesting and reject unknown fields in protocol revision1 — bounds allocation and ambiguous inputs consistently in both languages — cost if wrong: coordinated versioned schema expansion.

- Task 5: Ruling: add optional beforeCommit hook to openStore for real SQLite rollback injection; normal callers keep openStore(path) — verifies all durable effects fail together without mocked transactions — cost if wrong: remove hook after an alternate disk-failure harness.

- Task 5: Ruling: preserve one MOD ledger while running RX tests directly in WSL; adapt a private copy of task-done to use the explicit ledger path and RX BASE1026dd2 — avoids nested WSL and duplicate ledgers; no installed skill mutation — cost if wrong: task range labels require explicit repository annotation.

- Task 5: Ruling: stale hello retries cannot reactivate a superseded connection; exact retries on active connection remain durable. Snapshot replacement suppresses pending greetings at/below watermark — keeps historical reconciliation silent — cost if wrong: notification policy can be revised without changing current state.

- Task 6: Ruling: use Shipping-supported SSL DebuggingCertificatePath to add private test CA; OverrideCertificateBundlePath is #if !UE_BUILD_SHIPPING — verified pinned engine source; retain n.VerifyPeer and root validation — cost if wrong: runtime TLS gate remains blocked, never disable verification.

- Task 7: Ruling: add TakeSnapshot/OnPrepared/PreparedSnapshot DTO handoff to Delivery — freeze current state on game thread, serialize/hash only on workers — cost if wrong: small internal API adjustment. State exposes constant-time cursor/queue/gap metadata and bounded ReplayAfter to avoid copying10000 entries each poll.

- Task 7: Ruling: pinned Windows/Unix HTTP factories both construct FCurlHttpRequest, whose constructor hardcodes FOLLOWLOCATION=1 and public IHttpRequest exposes no redirect option. Use its inline GetEasyHandle via private engine include, set FOLLOWLOCATION/MAXREDIRS=0, peer/hostname verification on, verbose off before ProcessRequest. Link exact engine libcurl/OpenSSL/nghttp2/zlib, no engine edits/copied code — required to stop bearer redirects — cost if wrong: engine upgrades require re-audit; native redirect probe is an acceptance gate.

- Task 7: Ruling: config accepts DNS/IPv4 HTTPS authority with optional port only; no credentials/path/query, default disabled, exact session binding. Optional IPv6 support deferred — smaller auditable endpoint parser — cost if wrong: IPv6-only host needs parser extension. Build.ps1 generates ignored source-hash header from exact Source input hashes, excluding itself, for hello provenance.

- Task 8: Ruling: replay-scenario owns a temporary SQLite database and loopback HTTPS receiver, never config.databasePath — safe repeatable fault injection without mutating an active world; separate genuine game-to-remote receiver checks remain mandatory. Cost if wrong: protocol harness does not model game-side scheduling, explicitly covered separately.

- Task 8: Ruling: user's explicit VPS selection authorises an isolated receiver on the existing host, not production game/Foreman changes. Read-only audit verified user SSH, Node24.21, freeport19443, production PID2223596; WSL TCP routing works. Cost if wrong: shared host resource contention; use transient resource-capped unit.

- Task8: Ruling: live queue-overflow probe uses a temporary uncommitted source overlay changing only State maxEvents10000→2; exact release source is backed up and restored after packaging. No runtime override or test behavior is added to release code. Existing reduced-limit State/Delivery tests are green. Separate acceptance-only receiver entrypoint holds snapshot commits with503 while allowing staging, never enabled by normal main.mjs; its focused regression was observed RED missing module then GREEN. Cost if wrong: test package could be mistaken for release; archive separately, record distinct hash, and restore exact prior release package at probe end.

- Final: Ruling: preserve the existing ignored ledger/review workspace despite skill cleanup default — user explicitly requested preserving this ledger and restart identity; user direction takes precedence. Cost if wrong: local ignored evidence remains, no product runtime effect.

- Final: Ruling: keep both feature branches as-is for implementation review handoff — approved plan explicitly excludes merge/publication, so do not re-ask the finishing-skill integration menu. Cost if wrong: integration waits for a later explicit request.

- Final: Ruling: promote new epochs only on validated snapshotcommit; hello/staging are candidate-only — prevents unseen delayed hello replacing current world. Fence all other issued connections on promotion, retire only previously current epoch, not never-current candidates — retiring every competing candidate would wedge a legitimate live candidate losing a concurrent commit race; fresh handshake must permit retry, old connection remains rejected. Cost if wrong: candidate metadata persists until operational cleanup; authenticated producer must not create unlimited epochs.

- Final: Ruling: large-world copy/memory latency remains unproven — accepted small disposable-map scope, not a production scalability claim. Cost if wrong: large-world deployment requires profiling and potential streaming changes.

- Final: Ruling: permanent crash history and proof a human saw chat remain excluded — durable current state and server dispatch/explicit player reports are the measured contract. Cost if wrong: stronger delivery/history requires a separately designed protocol.

- Final: Ruling: automatic save lineage/copy pairing stays deferred — exact configured world/session binding is the prototype boundary. Cost if wrong: operators must assign world identity deliberately.

- Final: Ruling: Steam/Epic creator attribution remains nullable — pinned reflected adapter and actual creator=null are documented, no invented identity. Cost if wrong: attribution-specific features need a new verified adapter.

- Final: Ruling: other engine/game versions, building types and IPv6 remain outside tested matrix — pinned prototype only. Cost if wrong: compatibility requires porting and fresh acceptance.

- Final: Ruling: production deployment/publication/backups/long-term archives remain outside this handoff — isolated authorised tests only, no deployment licence selected. Cost if wrong: operational readiness work remains before production use.

- Final: Ruling: malicious authorised-producer aggregate disk exhaustion and hostile local staging-filesystem races are not solved by bounded requests — this isolated prototype trusts local administration and its bearer holder. Cost if wrong: storage quotas/retention and stronger local filesystem hardening needed before hostile multi-tenant use.

- Final: Ruling: review's runtime claims rely on supplied actor/server/player evidence; injected SQLite failures do not prove physical disk-failure behavior — fresh reviewer was read-only and barred from private live state. Cost if wrong: hardware failure/deployment acceptance remains separate from verified transaction rollback semantics.

## Deferred minor

Require explicit string types for JavaScript provenance hashes and shared malformed fixtures. The native producer sends valid strings; malformed authenticated metadata can currently differ between codecs.
