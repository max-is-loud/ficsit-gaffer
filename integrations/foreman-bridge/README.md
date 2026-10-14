# SML companion bridge prototype

A server-only SML plugin observes constructor placement/removal and sends current
state to an independent HTTPS/SQLite receiver. Validated receiver commands reply
through existing game/SML chat replication. Windows clients need SML only.

This directory imports the reviewed standalone components into the private
Foreman repository. The receiver now also serves an authenticated, read-only
[Constructor query](receiver/docs/query-v1.md) that ff-server's
`get_live_constructor_state` chat tool consumes for one operator-linked
playthrough ([setup and behaviour](../../docs/live-constructor-awareness.md)).
The receiver remains the only live-state store: Foreman work orders, MCP,
databases and UI are unchanged. It is outside the npm workspace list. No
production deployment is part of this change.

- [Native plugin and build instructions](mod/README.md)
- [Independent receiver and private configuration](receiver/README.md)
- [Wire contract](mod/docs/protocol-v1.md)
- [Read-only query contract](receiver/docs/query-v1.md)
- [Acceptance evidence](mod/docs/acceptance.md)
- [Final review and deferred minor](mod/docs/final-review.md)
- [Implementation decisions and costs](mod/docs/implementation-decisions.md)
- [Component provenance and exact file hashes](source-manifest.json)
- [Attribution and licensing boundary](NOTICE.md)

## Validation

Run receiver tests independently with Node24.21.0 or later and OpenSSL:

```sh
cd integrations/foreman-bridge/receiver
npm test
```

The separate CI workflow runs this suite, including a real60-second HTTPS outage.
It requires no game install or private configuration. Native builds/tests require
the pinned custom CSS Unreal engine and native Windows toolchain documented by
the plugin; root npm commands do not build the plugin. Stage the plugin under
`Mods/ForemanBridge` in that native starter before using its build scripts.

Recorded verification at import: receiver71 tests; native State8/Delivery8; Unreal7;
editor and Windows/LinuxServer shipping builds. Real isolated testing covered
separate-machine placement/chat,69.8-second outage, bounded queue overflow,
interrupted snapshot with concurrent placement, reconnect and save rollback.
Normal limits and packages were restored after testing. Performance evidence
covers a small disposable world, not large production factories.

The final review fixed delayed-old-hello epoch takeover and misleading connected
status during outages. Its deferred minor — JavaScript provenance hash validation
accepting singleton arrays by coercion — is fixed in this repository, with shared
malformed fixtures in both fixture copies. The native Wire test has not been
re-run on those fixtures here (it needs the Windows/Unreal toolchain).

The live-query additions (receiver query, freshness and migration, plus the
backend client/tool) are covered by the receiver suite and ff-server tests. They
were not part of the import-time acceptance above: that evidence describes the
original prototype, and real game/web-chat acceptance of the live integration is
recorded separately in [live-constructor-awareness.md](../../docs/live-constructor-awareness.md).

## Import policy

`source-manifest.json` keeps each component's upstream `sourceCommit` and the
byte-for-byte `files` hashes imported from it as the provenance baseline. Files
have since been modified or added in this repository; the manifest's `current`
section lists those paths and today's hashes, so the baseline is no longer a
description of the working tree. The original independent repositories and
native checkout remain intact. After changing component files, review and run:

```sh
node integrations/foreman-bridge/scripts/update-source-manifest.mjs --write
node integrations/foreman-bridge/scripts/update-source-manifest.mjs --check
```

The check also fails if the two protocol fixture copies differ.
This import preserves component formatting rather than combining it with an
application-wide style conversion. No SDKs, game assets, binaries, generated
outputs, saves, credentials, TLS keys or raw logs are included.
