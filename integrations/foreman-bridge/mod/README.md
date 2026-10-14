# Foreman Bridge

Independent asset-free SML constructor bridge with authoritative server state,
bounded replay, authenticated HTTPS delivery and receiver-backed chat. A Windows
client needs SML only. Cross-machine placement, outage, overflow, interrupted
snapshot recovery and save rollback passed on the disposable dedicated server.
See [acceptance evidence](docs/acceptance.md) for automated versus player results
and remaining review limitations. No Foreman application integration or
production mod deployment is included.

## Native Windows builds

Copy the three absolute paths into ignored `build.local.json`: `engineRoot`,
`starterRoot`, `outputRoot`. The baseline is the custom CSS 5.6.1 engine release
5.6.1-css-83 and starter commit 8eebc9e659f0b2ff4392d2f8cf6e2cff60c8ea49.
Preserve the starter's local Wwise integration and DefaultGame.ini changes.

```powershell
./Scripts/Build.ps1 -Mode Editor -Settings ./build.local.json
./Scripts/Build.ps1 -Mode Package -Settings ./build.local.json
./Scripts/Test-Core.ps1 -Case State
./Scripts/Test-Core.ps1 -Case Delivery
./Scripts/Test-Unreal.ps1 -Filter ForemanBridge.Wire
./Scripts/Test-Unreal.ps1 -Filter ForemanBridge.Transport
./Scripts/Test-Staging.ps1
./Scripts/Stage-Test.ps1 -Manifest ./out/ForemanBridge-packages.json -Destination '\\wsl.localhost\Debian\home\max\projects\satisfactory-bridge-test\server'
```

Package mode records the command, exit status via script failure, build log,
fresh Windows/LinuxServer archives and SHA-256 hashes under outputRoot.
`-Plugin SML` builds matching pinned-source SML if the published binary probe
fails. No deployment is performed by Build.ps1. Stage-Test validates the hash,
archive entries and exact disposable destination; it refuses existing plugins.
Use `-ValidateOnly` to check without copying. The Windows test client accepts
SML only in Task 1. Never stage ExampleMod or copy SDKs/assets into this repo.

`Scripts/Verify-Task1.ps1 -Settings ./build.local.json` verifies staging checks,
tested source hashes, both package hashes, and sanitised actual-game evidence
under the isolated test installation. It cannot replace an actual player join;
the evidence records must come from the server logs and game API after joining.

The private source repository has no publication licence selected. SML and its
derived interfaces retain their GPLv3 attribution; Unreal, Wwise and game
assets retain their own terms. This repository does not relicense them and
contains no FRM code. Foreman application code remains separate.

## Private receiver configuration

Disabled unless the game server is launched with
`-ForemanBridgeConfig=/absolute/private/bridge.json`. Read once at world startup;
place the file outside plugin/save/replicated settings, mode0600 on Linux.
Placeholders below are not runnable credentials:

```json
{
  "enabled": true,
  "url": "https://receiver.example:9443",
  "token": "REPLACE_WITH_RANDOM_SHARED_BEARER_TOKEN",
  "serverId": "REPLACE_WITH_SERVER_UUID",
  "worldId": "REPLACE_WITH_WORLD_UUID",
  "sessionName": "EXACT_DISPOSABLE_SESSION_NAME"
}
```

Only HTTPS DNS/IPv4 authorities and optional ports are accepted; no credentials,
path, query or fragment. Session name must match AFGGameMode's saved session.
Wrong/missing config disables delivery. No secret is logged or saved in-game.
The separate receiver README documents its private config and test-CA setup.

Callbacks capture only DTOs and weak world references. A generation fences late
work; teardown cancels without waiting. State changes remain on the game thread;
JSON and snapshot hashing run on workers. Ordinary exchanges occur every2s,
requests time out after5s, full-jitter backoff caps at30s. Authentication/protocol
and verified TLS failures disable delivery until restart. Current-state replay
and complete snapshots recover gaps; this is not a permanent event-history log.

`/foremanbridge status` reports count, epoch, latest sequence, last receiver ACK,
queue size and history gap. Only receiver-issued, validated, unexpired chat
commands broadcast. No connected players means skipped, never delayed to login.

### Pinned HTTP security boundary

The CSS5.6.1 Windows and Unix HTTP factories construct FCurlHttpRequest. Its
constructor hardcodes redirects on; no public request option overrides that.
This plugin uses its inline native-handle accessor from the engine private
header to disable FOLLOWLOCATION and MAXREDIRS, force peer/hostname verification,
and suppress curl debug output before ProcessRequest. No engine source is
modified/copied. Explicit engine libcurl/OpenSSL/nghttp2/zlib dependencies are
required for installed-engine linking. Re-audit this boundary on engine upgrades.

Native `ForemanBridge.Security` tests require the disposable redirect fixture
on19444, a dummy-token private config and its public CA via Test-Unreal.ps1
`-TransportConfig` and `-TestCa`. They must show HTTP307 returned unchanged,
zero requests at the redirect sink, and wrong-hostname TLS rejection. Tests do
not carry real receiver credentials. Game transport always retains HTTPS/TLS
verification; there is no insecure fallback.

Build.ps1 generates an ignored BridgeBuildInfo.h with a SHA256 over sorted
source paths/file hashes (excluding that generated file) and the starter pin.
Hello reports this provenance; it is diagnostic, not authority.
