# Foreman bridge receiver prototype

Independent private Node.js HTTPS receiver with durable SQLite state. Use Node
24.21.0 or newer and OpenSSL. No runtime npm dependencies or Foreman application
routes/database changes. The process binds one configured game server/world.

```sh
npm test
FOREMAN_INTEROP=/path/to/mod/out/wire-interop.json npm test
node src/main.mjs --config /absolute/private/receiver.json
```

Private configuration (mode 0600):

```json
{
  "host": "127.0.0.1",
  "port": 9443,
  "serverId": "operator-generated-uuid",
  "worldId": "operator-generated-uuid",
  "token": "at-least-32-random-alphanumeric-characters",
  "queryToken": "optional-different-read-only-token",
  "databasePath": "/absolute/private/receiver.db",
  "certPath": "/absolute/private/server.pem",
  "keyPath": "/absolute/private/server-key.pem",
  "requestTimeoutMs": 5000
}
```

Host defaults to loopback; a separate-machine test requires an explicitly
reachable binding and endpoint. Keep configuration/database/key directories
private. The key must be mode 0600. Health `GET /healthz` exposes readiness only.
All four `/v1/` POST routes require `Authorization: Bearer TOKEN` and
`Content-Type: application/json`. Tokens/bodies are never logged. Error replies
contain classified codes, never exceptions or secrets. Authentication precedes
body buffering; bodies are limited to 256 KiB, headers to 8 KiB, and uploads to
5 seconds by default. Database errors return 503 without an ACK.

The receiver uses SQLite WAL, foreign keys and synchronous FULL. Projection,
receipts, cursor and chat changes commit together. Only a verified complete
snapshot becomes live. Retired epochs remain archived and old connections cannot
write. Accurate current state is promised; complete crash-spanning event history
is not. The service has no unauthenticated state/query endpoint.

## Read-only query

With the optional `queryToken` (same format, must differ from `token`),
`POST /query/v1/constructors` returns the committed Constructor count, paginated
positions and freshness for the configured world. The query token cannot call
ingestion routes and the producer token cannot query; without `queryToken` the
route is disabled. Staged snapshot rows are never visible. Freshness is
process-local: after a restart persisted state is reported as last known until
the game synchronises again. Existing databases gain sync metadata on open. See
[`docs/query-v1.md`](docs/query-v1.md) for the exact contract.

## Disposable TLS setup

```sh
bash scripts/make-test-cert.sh /absolute/private/test-config/receiver-tls 127.0.0.1
```

Supply the actual endpoint IPv4 or DNS name: it becomes the certificate SAN.
The script refuses to overwrite existing material, creates a 30-day local CA
and 7-day server certificate, and verifies the chain. Only the public `ca.pem`
goes to clients; keep both private keys on the receiver host. Test HTTPS clients
must explicitly trust that CA and retain hostname verification. No insecure TLS
flag is part of this workflow.

Pinned custom engine source `SslCertificateManager.cpp` supports
`[SSL] DebuggingCertificatePath=/absolute/private/receiver-tls/ca.pem` in the
game's isolated Engine.ini, including Shipping. This adds the test CA to the
existing trust roots. `OverrideCertificateBundlePath` is non-Shipping only and
must not be used for the dedicated game. Retain
`[/Script/Engine.NetworkSettings] n.VerifyPeer=true` and
`[SSL] bValidateRootCertificates=true`. Do not overwrite distributed CA bundles
or system trust. Source inspection proves this hook; actual mod HTTP TLS
validation is a Task 7 runtime gate, not established by Node tests.

## Protocol fixtures

`fixtures/v1.json` is canonical. Copy unchanged to the plugin's
`Tests/fixtures/v1.json` and compare SHA-256. Native automation exports request
bytes for the optional interop run. The plugin's `docs/protocol-v1.md` records
revision 1 field definitions and responsibilities.

Do not commit private configuration, TLS keys, bearer tokens, SQLite databases,
or raw game login/travel logs. No remote/publication licence is selected.
No copied FRM, SML, Unreal or game assets are included.

Unknown epochs initially remain candidates. Hello and chunk staging preserve the
current projection and its connection. A validated snapshot commit atomically
promotes the candidate, retires the previously current epoch and fences all
other issued connections. Never-current candidates may negotiate a fresh
connection after losing a race; their old connections cannot commit. This avoids
letting an old world's delayed first hello displace the live world.
