# SML companion bridge prototype

A server-only SML plugin observes constructor placement/removal and sends current
state to an independent HTTPS/SQLite receiver. Validated receiver commands reply
through existing game/SML chat replication. Windows clients need SML only.

This directory imports the reviewed standalone components into the private
Foreman repository for code review. It does not connect the receiver to Foreman
application routes, work orders, MCP, databases or UI, and is outside the npm
workspace list. No production deployment is part of this change.

- [Native plugin and build instructions](mod/README.md)
- [Independent receiver and private configuration](receiver/README.md)
- [Wire contract](mod/docs/protocol-v1.md)
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

Recorded verification: receiver71 tests; native State8/Delivery8; Unreal7;
editor and Windows/LinuxServer shipping builds. Real isolated testing covered
separate-machine placement/chat,69.8-second outage, bounded queue overflow,
interrupted snapshot with concurrent placement, reconnect and save rollback.
Normal limits and packages were restored after testing. Performance evidence
covers a small disposable world, not large production factories.

The final review fixed delayed-old-hello epoch takeover and misleading connected
status during outages. One minor remains: JavaScript diagnostic provenance hash
validation accepts singleton arrays by coercion; the native producer sends
strings and rejects such malformed metadata.

## Import policy

Component files are byte-for-byte snapshots of the reviewed commits identified
in `source-manifest.json`; the original independent repositories and native
checkout remain intact. Future changes should update the manifest deliberately.
This import preserves component formatting rather than combining it with an
application-wide style conversion. No SDKs, game assets, binaries, generated
outputs, saves, credentials, TLS keys or raw logs are included.
