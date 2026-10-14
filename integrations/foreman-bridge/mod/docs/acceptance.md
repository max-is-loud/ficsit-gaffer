# Prototype acceptance — 2026-10-14

Task8 gameplay and automated gates passed. Normal release package restored and verified byte-for-byte; fresh whole-branch review completed; two important findings fixed with RED→GREEN regressions. One minor deferred; see [final review](final-review.md).

| Area | Evidence | Status |
| --- | --- | --- |
| Build/load | Pinned custom engine; editor and both shipping targets; Windows SML-only joins Linux bridge server | Task8 editor and both shipping packages passed |
| Baseline/reload | Actual server reload seeds constructor without placement greeting; prior epoch archived | Cross-machine rollback2→1→2 passed; epochs archived, no events/chat |
| Main loop | Player reports local pass; server count2/cursor1, one receipt/executed command, 1.136s capture-to-chat dispatch | Passed remote: count3/seq1/ack1; player confirmed one greeting within5s, server dispatch0.773s |
| Removal/same position/cancel | Task3 snapped rebuild and cancelled preview screenshots, authoritative events; count stable across travel/rejoin | Passed local |
| Duplicate/reorder/restart/storage loss | Receiver HTTPS scenarios + durable store suite, native stale ACK and command cache tests | Automated passed |
| Outage | Real60-second stopped HTTPS receiver converges; retention-gap requests snapshot | Passed remote69.8s outage:2placements/1removal →4/4/4, no duplicates; player confirmed responsive |
| Snapshot race | Partial snapshot invisible, committed replacement then post-watermark replay, stale commit rejected; core overflow while frozen | Passed live: held snapshot5@seq3 survives receiver restart; placementduringhold replaysseq4 once →6/4/4 |
| Bounds | State10k/16MiB tests, reduced-cap Delivery recovery; response limits; bounded command cache | Passed live cap2: queue2/gapyes after3events, fullsnapshot+replay clearsgap; release source restored |
| Security/failure | Token/world/protocol/schema/size/storage failure tests; actual curl redirect refused and wrong hostname rejected | Automated passed; startup-unavailable game check passed |
| Teardown | Forced worker boundary cancellation first failed (HTTP started after cancel); final dispatch serialized on game thread, regression passes | Fixed, native test passed |
| Timing | Ordinary event max0.041ms, snapshotcopy max0.017ms during recorded Task8 probes (baseline enumeration max0.062ms) | Passed tiny world; not large-world evidence |
| Separate machine | WSL validates HTTPS CA/hostname to isolated VPS receiver100.71.187.3:19443 | Passed routing, zero-player baseline, gameplay and outage |

Verification: receiver71 tests; native State8, Delivery8; Unreal7 checks. RX82b5af4, MODcf02906 (transport fix686e13f retained). Native RED report8810f5f01f0549008f934c99db2701d3; GREEN70c696d42e134df8be97e8a5c21026bf. Private evidence lives outside Git in the isolated test environment.

The replay helper owns temporary storage and an actual loopback HTTPS listener; it never opens the configured database. Supply a private0600 receiver config with `caPath` and a certificate valid for127.0.0.1: `node scripts/replay-scenario.mjs --config /absolute/private.json --scenario duplicate|outage|snapshot-race|receiver-restart`. It models protocol recovery, not Unreal gameplay. The outage scenario takes60seconds.

Production game/Foreman services and saves are excluded. The authorised VPS runs only a separate transient receiver user unit, capped at256MiB and25%CPU. Source and private state are under `/home/ubuntu/foreman-bridge-test`; stop with `systemctl --user stop foreman-bridge-isolated-receiver`. No production mods installed or services restarted. Player screenshots/reports and receiver evidence agree for cross-machine main loop and outage.

Live snapshot recovery: baseline4/seq0; temporary cap2 then2placements/1removal →5/seq3/queue2/gapyes. Held commit kept VPScurrent4/cursor0 despite staged5-row snapshot atwatermark3. Receiver stop/start preserved staged bytes and old projection. One player placement duringhold produced6/seq4. Releasegate yieldedACK3 thenACK4; onlyevent4 had a receipt/chatcommand, executedonce. Player confirmed6/4/4/queue0/gapno and exactlyevent4greeting; no fabricated greetings for snapshot-covered1–3.

Evidence outside Git: task8-vps-main-loop.json, task8-vps-outage-recovered.json, task8-vps-rollback.json, task8-held-snapshot-before-restart.json, task8-held-snapshot-after-restart.json, task8-snapshot-recovered.json. Screenshots and player confirmation are recorded in workspace SML Bridge Test Results. Current-state convergence is promised; crash-proof lifetime history and large-world performance are not claimed.

Release restoration: Linux files match archived releaseSHA e0585d31e125bfe96ba4fb473dc4ea212974b33546e308b5504c1f88f164b445. Normal receiver restored; six-constructor baseline atseq0/cursor0 in newepochc5d59d68-e421-4f97-9338-95ee5df17770, no synthetic events or commands. Production gamePID2223596 remained unchanged.

Final review-fix validation: editor4actions29.71s; dualshipping18actions/UAT0/56s; Unreal7/7 reportf0ffdf85ecc24b5fbe86bcab155c323f. Current archive hashes are canonical in build-manifest.json; earlier hashes above identify historical acceptance runs. Final review fixes preserve wire schema.
