# Bridge on the live server: design, provenance and sources

This page explains the choices behind [`bridge-runbook.md`](./bridge-runbook.md) (issue #65, tasks 3
to 6). The runbook says what to run. This page says why, and what the evidence is.

## 1. Which package: provenance

The runbook installs two packages for the `LinuxServer` target. Both are pinned by SHA-256 in
[`bridge/packages.sha256`](./bridge/packages.sha256), and `install-mod.sh` refuses any other file.

| Package             | File name used here                   | Size (bytes) | SHA-256                                                            |
| ------------------- | ------------------------------------- | ------------ | ------------------------------------------------------------------ |
| ForemanBridge 0.1.0 | `ForemanBridge-0.1.0-LinuxServer.zip` | 5,578,096    | `4beb1546e135e6bfae9f13a04ba7bcd242a558090b0f0d643d2dcaf29b645f59` |
| SML 3.12.0          | `SML-3.12.0-LinuxServer.zip`          | 6,627,612    | `b44d03b49afbd3757c8566281d0a1a6e250c4b676284774f1c1d11f6e6957b77` |

### ForemanBridge: the evidence

The bridge package is the build of 14 Oct 2026, 16:53 UTC. On the dev machine it is
`/home/max/projects/satisfactory-bridge-test/evidence/final-LinuxServer.zip`. The runbook renames it
when it copies it.

1. **It was built from the source in this repository.** `Build.ps1` writes a SHA-256 over the plugin
   sources into `BridgeBuildInfo.h`, and the plugin reports it in its Hello message. I recomputed that
   hash with the algorithm of `Build.ps1` over `integrations/foreman-bridge/mod/Source` (24 files). It
   is `85f16fc75d9a4ff58fd79c2cbf5661f6802621c9a2b3f584013f1911b0250123`. The same 64 characters are
   embedded in `libFactoryServer-ForemanBridge-Linux-Shipping.so` inside the package. The same
   computation over the Windows build tree of 16 Oct (32 files) gives `f0b0dade…ba23`, which is the
   value embedded in the 16 Oct package. So the method reproduces known values, and the match is not an
   accident.
2. **The source has not changed since.** `git log` shows that `mod/Source` and `ForemanBridge.uplugin`
   changed only in commit `5ef2d33` (14 Oct). The `.uplugin` in the package has the hash that
   `source-manifest.json` records (`142649d2…663f`).
3. **It is the canonical build.** `mod/docs/build-manifest.json` lists this SHA-256 for the
   `LinuxServer` package, with the package log `ForemanBridge-Package-20261014-125222.log`. That log
   (in `D:\Modding\ForemanBridge\Mods\ForemanBridge\out`) ends with `BUILD SUCCESSFUL` and
   `ExitCode=0`. `final-packages.json` names the same log and the same SHA-256. The package passes
   `zipfile.testzip()`.
4. **It ran on the disposable server.** The disposable server loaded this package on 14 Oct at 16:54
   UTC and ran it until 15 Oct 07:52 UTC. It committed a baseline of 6 Constructors (epoch
   `797b65b6…`, one committed snapshot, no events). `mod/docs/final-review.md` says: "Corrected Linux
   package installed and verified byte-for-byte".
5. **The gates passed on this build.** Editor build (4 actions, 29.71 s), shipping packages (18 actions,
   56 s), Unreal automation 7/7, native State 8/8 and Delivery 8/8 (`mod/docs/acceptance.md`).

**One limit.** The player scenarios of Task 8 (placement, outage, snapshot race, save rollback) ran on
the build before it, package SHA-256 `e0585d31…b445`. The source of that build and the final source
differ in one line of `Core/BridgeDelivery.cpp` (`git diff 686e13f cf02906 -- Source` in the Windows
repository): the fix that reports "retrying" during an outage. The bridge version is still 0.1.0.
Nobody replayed the player scenarios on the final package.

### Packages that I rejected

| SHA-256 (start) | Where                                            | Why not                                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `5bf301dc…cda4` | `evidence/ForemanBridge-LinuxServer.zip`, 13 Oct | The first load-baseline skeleton: a 21 KB library with no bridge logic.                                                                                                                                                                                                           |
| `e0585d31…b445` | `evidence/task8-LinuxServer.zip`, 14 Oct 11:49   | The build before the two final-review fixes. Superseded.                                                                                                                                                                                                                          |
| `7027e965…e603` | `D:\…\out\ForemanBridge-LinuxServer.zip`, 16 Oct | **Built from a spike**, not from this source. The Windows repository head is `f842ef1 spike: probe change signals (throwaway)` on `6d85f0d`, a mirror of the `feature/bridge-v2-spec` branch. It has protocol v2 and `BridgeSpikeProbe`. Its embedded source hash is `f0b0dade…`. |

**The disposable server now holds the spike build.** `server/FactoryGame/Mods/ForemanBridge` there has
the `7027e965…` library (dated 16 Oct 11:47). Never copy the bridge from that folder. Use the
`evidence/final-LinuxServer.zip` file, and the runbook checks its SHA-256.

`plugin-archive/ForemanBridge-v1-20261016-211134/` holds the unpacked final build (a 21:11 local copy of
the same files that are in the zip). It is not a different build.

### SML 3.12.0

The `SML-3.12.0-LinuxServer.zip` package is the file that `https://api.ficsit.app/v1/version/74YqQBq2KJKN77/LinuxServer/download` serves. The lock file
`FactoryGame/Mods/bridge-sml-only-lock.json` on the disposable server records the same link and the same
SHA-256. I downloaded it on 5 Nov 2026 and got `b44d03b4…7b77` (6,627,612 bytes). All 15 files in it are
byte-identical to `server/FactoryGame/Mods/SML` on the disposable server. That folder also has a `.smm`
marker folder, which the mod manager wrote and the game does not read. Its `SML.uplugin` says
`GameVersion >=491125`. I also ran `install-mod.sh` on both real packages in a temporary folder:
every file of the bridge package matches `bridge/foreman-bridge-files.sha256`.

## 2. What the documentation says (Context7 and upstream)

I looked these up before I wrote the install steps.

| Source                                                                                          | Fact I used                                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Context7 `/websites/ficsit_app_satisfactory-modding`, _Manual Installation_                     | SML goes in `<game root>/FactoryGame/Mods`, in a folder named exactly `SML`. There are "no current manual installation directions for SML 3 on Linux" and the docs recommend a mod manager.                                                                                                                                      |
| Same library, _Dedicated Server Setup_                                                          | A mod manager (SMM 3.0.0 or later, or `ficsit-cli`) manages a remote server by SFTP or a network file system; `ficsit-cli` can also run on the server. SML 3.7.0 or later supports mods on dedicated servers. A client needs the same mods as the server.                                                                        |
| Context7 `/websites/ficsit_app_satisfactory-modding_development`, _Updating from SML 3.8 → 3.9_ | Since SML 3.9, a client refuses to join a server that lacks a mod that the client has installed. `RequiredOnRemote` and `RemoteVersionRange` in the `.uplugin` control it. `ForemanBridge.uplugin` has `"RequiredOnRemote": false`, so the player needs SML only.                                                                |
| Same library, _Release a mod_                                                                   | `GameVersion` in a `.uplugin` is checked by SML at runtime. A mismatch stops the game from launching.                                                                                                                                                                                                                            |
| Upstream, `https://api.ficsit.app/v2/query` (`getSMLVersions`)                                  | Context7 has nothing on which builds SML 3.12.0 supports. The registry lists 3.12.0 (created 2026-06-06) as the newest release, with `satisfactory_version` 491125. That is a minimum build, not a range. The live server runs build 513885 (changelist). The disposable server ran SML 3.12.0 on the same Steam build 25782485. |

**Why I did not use `ficsit-cli`.** Its profile and lock-file model needs a network call and a
Satisfactory install to resolve. `install-mod.sh` unpacks the same registry package after it checks its
SHA-256, and it makes the file layout identical to the disposable server (verified above). A later
change can move to `ficsit-cli` if the user wants.

## 3. TLS: the receiver certificate

| Source                                                                             | Fact I used                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Context7 `/websites/tailscale`, _Provision TLS certificates for your devices_      | Let's Encrypt certificates have a 90-day lifetime. For a certificate that `tailscale cert` writes to files, "you are responsible for renewing" it. `tailscaled` does not know where the files are.                                                                                   |
| Same library, _tailscale CLI → cert_                                               | Flags `--cert-file`, `--key-file`, `--min-validity`. A `--min-validity` longer than the Let's Encrypt lifetime uses the maximum lifetime.                                                                                                                                            |
| Same library, _Enabling HTTPS_                                                     | The tailnet needs MagicDNS and "HTTPS Certificates" switched on. Certificates go in the public Certificate Transparency log, which publishes the machine names. Only machines that run `tailscale cert` appear.                                                                      |
| Context7 `/tailscale/tailscale`, `feature/acme/cert.go` and `client/local/cert.go` | A cached certificate is returned while it is valid. With `min_validity` set, a certificate with less than that left is renewed at once. The renewal point is two thirds of the lifetime. The private key is reused from the cached pair. The domain must equal one of `CertDomains`. |
| Not in what Context7 returned                                                      | The file modes that `tailscale cert` writes. The cache under `/var/lib/tailscale/certs` on the server has the key at `0600` and the certificate at `0644`. `renew-bridge-cert.sh` does not depend on this: it sets the modes itself.                                                 |

**What the server shows (read only, 5 Nov 2026).**

- The tailnet has MagicDNS on. `CertDomains` is `['openclaw-1.tail35a28.ts.net']`.
- `/var/lib/tailscale/certs` already holds a certificate from an earlier `tailscale cert` (June). It
  expired on 15 Sep 2026. Nothing renewed it, which confirms the documented rule above.
- That certificate: issuer Let's Encrypt `YE1`; valid 17 Jun 02:45:46 to 15 Sep 02:45:45 2026 UTC (90
  days); one DNS name; ECDSA P-256; key usage `serverAuth`. The file holds four certificates: the leaf,
  `YE1`, `ISRG Root YE` (cross-signed by `ISRG Root X2`) and `ISRG Root X2` (cross-signed by
  `ISRG Root X1`). Caddy does not use it.
- **ff-server trusts this chain with no custom CA.** On the dev machine I verified the chain at 1 Jul
  2026 (inside its validity) against Node's bundled root list (121 roots, which include `ISRG Root X1`
  and `X2`) and against the system roots, with the host name check. Both gave `OK`. The server's own
  system roots also include `ISRG Root X1` and `X2`, so `curl` on the server trusts it as well.
- **The game is not proven.** The plugin sets the host name check and peer check on, and it has no
  insecure option. I could not find the root list that the game's HTTP stack uses at runtime, because
  the dedicated server ships no `cacert.pem` file that I can see. The disposable tests used a private CA
  through `[SSL] DebuggingCertificatePath` (receiver README). No test used a public CA. The chain that
  Tailscale serves ends in `ISRG Root X1` through the cross-signs, which is in every common root list,
  so I expect it to work. Step c of the runbook is the first real test. **A TLS failure disables
  delivery until the game restarts**, so the runbook gives a ready fallback that does not need a custom
  CA: add the public `ISRG_Root_X1.pem` from the system store to the game's trust with the same
  `DebuggingCertificatePath` hook (runbook, "If the game rejects the certificate"). That hook is
  documented for a test CA only; it is untested with a public root, and it is the user's decision to
  accept it. The last resort is the private CA of `receiver/scripts/make-test-cert.sh`.
- **The name resolves where it must.** On the server, the `satisfactory` user resolves
  `openclaw-1.tail35a28.ts.net` to `100.71.187.3` through the system resolver (`127.0.0.53`, with
  `tailscale0` as the DNS link for the tailnet domain). The game unit allows `AF_INET` and `AF_UNIX`.
  The dev machine (WSL) resolves the same name. So no fallback to an IP certificate is needed.
- **Renewal.** `renew-bridge-cert.sh` runs weekly. `tailscale cert --min-validity 720h` returns the
  cached certificate while it has more than 30 days left, so most runs issue nothing. The receiver reads
  its certificate once at start, so a new certificate restarts it (a few seconds; the game retries with
  backoff).

## 4. Choices

### Receiver: user and directories

| Item        | Choice                                                                                                      | Reason                                                                                                                                                                                                                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User        | New system user `gaffer-bridge`, no login, no home                                                          | The game user faces the internet on ports 7777 and 8888. If the game is compromised, it must not reach the database, the key or the query token. The upstream user `foreman` is left alone (user decision of 28 Oct).                                                                                                                   |
| Code        | `/opt/gaffer-bridge/receiver` (root-owned, `0755`): `src/*.mjs` and `package.json` of this repository       | The receiver has no npm dependencies (`node:sqlite` is built into Node 24.21). The user cannot change its own code.                                                                                                                                                                                                                     |
| Secrets     | `/etc/gaffer-bridge/` (`0700`, root): `receiver.json`, `dev.env`, `tls/`                                    | Root owns them. systemd copies the three the receiver needs into `/run/credentials/gaffer-bridge-receiver.service` (`LoadCredential`, in memory, mode `0400`, owned by the service user). The receiver can read them and cannot change them. I ran the unit this way in user mode: the receiver accepts the mode-`0400` key and config. |
| Data        | `/var/lib/gaffer-bridge/receiver.db` (`StateDirectory`, `0700`)                                             | The one place the receiver writes.                                                                                                                                                                                                                                                                                                      |
| Game config | `/etc/gaffer-bridge-game/bridge.json` (`0600`, owned by `satisfactory`; directory `0750 root:satisfactory`) | Outside the plugin, save and replicated-settings folders, as the plugin requires. The game can read it but cannot replace it. It holds the producer token only.                                                                                                                                                                         |

Two tokens, as `docs/live-constructor-awareness.md` requires: the producer token (game) cannot query,
and the query token (ff-server) cannot ingest. `make-bridge-config.sh` writes each secret with shell
built-ins only, so no secret appears in a process list, a log or the output.

### Receiver: hardening

`gaffer-bridge-receiver.service` uses `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`,
`PrivateTmp`, `PrivateDevices`, the `Protect*` options, `RestrictNamespaces`, `RestrictAddressFamilies=AF_INET AF_UNIX`, an empty `CapabilityBoundingSet`,
`SystemCallFilter=@system-service`, and `IPAddressDeny=any` with `IPAddressAllow=100.64.0.0/10 127.0.0.0/8`.
It also has `MemoryMax=256M` and `OOMScoreAdjust=500`, so the kernel stops the receiver before the game.
`MemoryDenyWriteExecute` stays off, because V8 needs executable memory. `ProcSubset=pid` is not set,
because Node can read other `/proc` files.

`systemd-analyze security --offline` rates the unit **1.4 OK**.

**Tolerance test.** On 5 Nov I ran the real unit file, changed only for user mode (no `User=`, no `StateDirectory`,
local paths, no `ProtectHome`), with the real receiver (Node 24.21.0) and a config that
`make-bridge-config.sh` wrote. The properties were applied (`systemctl --user show`): `ProtectSystem=strict`, `NoNewPrivileges`,
`MemoryMax=256M`, the address filter, the system call filter and the empty capability set. The receiver
started, answered `/healthz`, refused an unauthenticated call (401), accepted the query token on
`/query/v1/constructors`, refused the producer token there (401), and kept its database files at `0600`.
It used 17 MB. **Not covered** (they need the system manager on the server): `User=gaffer-bridge`,
`StateDirectory`, `ProtectHome=true`, and the IP filter against a real tailnet peer. The runbook starts
the unit by hand and reads the result before it enables anything.

### The certificate renewal job

`gaffer-bridge-cert-renew.service` runs as root, because `tailscale cert` needs it. It can write one
directory (`/etc/gaffer-bridge/tls`) and it talks to `tailscaled` and systemd through Unix sockets
only. It has the same `Protect*` options and an empty capability set. The runbook runs it by hand
first. The weekly timer is enabled only after that run succeeds.

### Game: the drop-in and the build guard

`/etc/systemd/system/satisfactory.service.d/bridge.conf` adds to the unit and edits nothing in it:

- `Wants=` and `After=gaffer-bridge-receiver.service`. The receiver starts first. It is a soft link,
  so a stopped receiver never stops the game.
- `ExecStartPre=` for the **build guard**. systemd keeps the unit's lines before a drop-in's lines, so
  the `steamcmd` update runs first, with its `-` prefix intact. Then the guard runs.
- `ExecStart=` reset and set again with `-ForemanBridgeConfig=/etc/gaffer-bridge-game/bridge.json`. A
  drop-in cannot append to `ExecStart`. The line repeats the unit's ports. The runbook compares the
  result with the unit.

**The guard implements the user's decision of 28 Oct.** The game updates at each restart, and the
client must match. The guard reads the Steam build id from `steamapps/appmanifest_1690800.acf`, which
`steamcmd` has just written. If the id is not in `/etc/gaffer-bridge-game/supported-builds`, it renames
`FactoryGame/Mods` to `Mods.off`, so the server starts without mods. This also protects an unplanned
restart (a crash restart or a reboot after Steam published an update). It fails closed: if the rename
fails, the start fails, because SML must not start on an unapproved build. An unreadable manifest or
list counts as "not approved". The build `25782485` is approved by the runbook. A new build needs a
manual decision, after a test on the disposable server (SML's `GameVersion` is only a lower bound, and
the bridge library links against game code).

### Network

`ufw` already allows all traffic on `tailscale0`, and the game connects to the host's own Tailscale
address, so no firewall change is needed. The receiver does not listen on the public interface. Tailscale
access controls (ACLs) could still block the dev machine from reaching port 9443. I could not check
that, so step e covers it.

## 5. What I did not verify, and the open points

- **The game's trust of the public certificate** (section 3). Fallback is ready.
- **Memory.** `satisfactory.service` peaked at 5.32 GB against its 6 GB cap since 27 Oct, and 4.1 GB is
  in use now. SML and the bridge add memory that I could not measure without the live world. The
  runbook has a watch plan and a rule. It does not raise the cap.
- **Saves made with SML.** The first save after a modded start may contain mod data. The runbook takes a
  backup right before that start, and the rollback says how to restore it. I did not find a statement
  in the docs that a world saved with SML loads without SML.
- **Game updates and the bridge library.** The library links against game code (changelist 513885). A
  new build may need a rebuild on the Windows toolchain. That is a user decision.
- **The leftover receiver.** `foreman-bridge-isolated-receiver.service` (a user unit of `ubuntu`) still
  listens on `100.71.187.3:19443` since the isolated tests of 14 Oct. It is not part of this install.
  The runbook leaves it alone and asks for a decision.
- **Windows client steps** are only as detailed as the docs. I could not check the Satisfactory Mod
  Manager screens.
