# Runbook: install the bridge on the live server

This runbook installs SML 3.12.0, the ForemanBridge plugin and its receiver on the live dedicated
server (SSH alias `openclaw`). It then connects a Gaffer `ff-server` on the dev machine to the
receiver over Tailscale. It belongs to issue #65, tasks 3 to 6. The backup that it needs is in
[`README.md`](./README.md). The reasons for each choice, and the evidence for the packages, are in
[`bridge-design.md`](./bridge-design.md).

**Nothing in this runbook runs on the server until the user approves that step.** Each step that
changes the server says **needs user approval**. Each read-only check says that it needs no approval.
Run one step at a time, and read the result before the next step.

All commands run from the root of a checkout of this repository, at the merged commit, on the dev
machine. `sudo -n` works for the user `ubuntu` on `openclaw`. The commands do not depend on shell
variables from an earlier step. A step that writes to a file on the server uses a `sudo -n bash -es`
script on standard input.

## The plan

| Step   | What happens                                                                          | Changes the server?                 |
| ------ | ------------------------------------------------------------------------------------- | ----------------------------------- |
| 0      | Test the scripts, get the two packages, check their SHA-256, build the staging folder | No                                  |
| P      | Read-only checks of the server                                                        | No                                  |
| a      | Install the save backup, take the pre-install archive, restore it into a copy         | **Needs user approval** (each part) |
| b      | Install SML 3.12.0, ForemanBridge and the receiver. The game keeps running.           | **Needs user approval** (each part) |
| c      | The user saves in the game. Restart `satisfactory.service`.                           | **Needs user approval**             |
| d      | The user installs SML 3.12.0 on the game client                                       | Not the server                      |
| e      | Check the bridge. Connect `ff-server` from the dev machine. Ask a live question.      | Reads only, except e3 and e6        |
| M      | Watch memory                                                                          | No                                  |
| U      | After a game update: start without mods, switch on again                              | **Needs user approval**             |
| R1, R2 | Rollback                                                                              | **Needs user approval**             |
| X      | Full removal                                                                          | **Needs user approval**             |

What the user sees: the game restarts in step c (players disconnect, the game does not save on
shutdown). From step c until step d, the user's client cannot join. SML 3.9 and later make a client refuse a server that has mods the client lacks. The server then runs SML. The server also starts
without mods after a game update (step U). A client that has SML cannot join then; see step U.

## The packages

[`bridge/packages.sha256`](./bridge/packages.sha256) pins the two packages.

| Package                               | SHA-256                                                            | Where it comes from                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ForemanBridge-0.1.0-LinuxServer.zip` | `4beb1546e135e6bfae9f13a04ba7bcd242a558090b0f0d643d2dcaf29b645f59` | `/home/max/projects/satisfactory-bridge-test/evidence/final-LinuxServer.zip` on the dev machine. Evidence: [`bridge-design.md`](./bridge-design.md), section 1. |
| `SML-3.12.0-LinuxServer.zip`          | `b44d03b49afbd3757c8566281d0a1a6e250c4b676284774f1c1d11f6e6957b77` | The public download in step 0.                                                                                                                                  |

**Do not use** the bridge files in `satisfactory-bridge-test/server/FactoryGame/Mods`: that folder holds
a spike build (`7027e965…`), not this one.

## Step 0: prepare on the dev machine (read-only for the server, no approval needed)

**0.1 Test the scripts.** They use temporary folders only. Each one ends with `all N checks passed`.

```bash
(cd tools/testbed && npm ci --omit=dev --ignore-scripts)
for t in tools/testbed/test-save-backup.sh tools/testbed/test-save-validation.sh \
         tools/testbed/bridge/test-bridge-install.sh tools/testbed/bridge/test-bridge-config.sh \
         tools/testbed/bridge/test-bridge-cert.sh tools/testbed/bridge/test-bridge-mods.sh \
         tools/testbed/bridge/test-bridge-units.sh tools/testbed/bridge/test-bridge-runbook.sh; do "$t" | tail -1; done
```

The eight last lines must all start with `all`. The config test starts the real receiver, so it needs
Node 24 or later. Without it, the test prints `skip` and tests the rest.

**0.2 Get the two packages.** The SML download is public. It does not touch the server.

```bash
mkdir -p ~/gaffer-bridge-packages
cp /home/max/projects/satisfactory-bridge-test/evidence/final-LinuxServer.zip ~/gaffer-bridge-packages/ForemanBridge-0.1.0-LinuxServer.zip
curl -fsSL https://api.ficsit.app/v1/version/74YqQBq2KJKN77/LinuxServer/download -o ~/gaffer-bridge-packages/SML-3.12.0-LinuxServer.zip
(cd ~/gaffer-bridge-packages && sha256sum -c "$OLDPWD/tools/testbed/bridge/packages.sha256")
```

Expected output: `ForemanBridge-0.1.0-LinuxServer.zip: OK` and `SML-3.12.0-LinuxServer.zip: OK`. If one says
`FAILED`, stop. Do not copy it.

**0.3 Build the staging folder.** It holds exactly the committed receiver code, scripts and units, and
the two packages. It is outside the repository.

```bash
rm -rf ~/gaffer-bridge-stage && mkdir -p ~/gaffer-bridge-stage/pkg
git archive HEAD integrations/foreman-bridge/receiver/src integrations/foreman-bridge/receiver/package.json tools/testbed/bridge | tar -x -C ~/gaffer-bridge-stage
cp ~/gaffer-bridge-packages/*.zip ~/gaffer-bridge-stage/pkg/
git rev-parse HEAD
```

Write the commit hash in the install record.

## Step P: read-only checks of the server (no approval needed)

Run this before step a, and again before step c. Every line is a read.

```bash
ssh openclaw 'bash -s' <<'REMOTE'
echo "game: $(systemctl is-active satisfactory.service)"
echo "receiver: $(systemctl is-active gaffer-bridge-receiver.service)"
echo "build: $(sudo -n -u satisfactory awk '$1 == "\"buildid\"" { gsub(/"/, "", $2); print $2; exit }' /home/satisfactory/server/steamapps/appmanifest_1690800.acf)"
echo "node: $(/usr/bin/node --version)"
echo "listeners on 9443: $(ss -ltnH 'sport = :9443' | wc -l)"
echo "gaffer-bridge user: $(getent passwd gaffer-bridge | wc -l)"
for path in /opt/gaffer-bridge /etc/gaffer-bridge /etc/gaffer-bridge-game /home/satisfactory/server/FactoryGame/Mods; do echo "exists $path: $([ -e $path ] && echo yes || echo no)"; done
echo "name: $(sudo -n -u satisfactory getent hosts openclaw-1.tail35a28.ts.net)"
echo "cert domain: $(tailscale status --self --json | jq -r '.CertDomains[]')"
REMOTE
```

Expected before step b (this is the output of 5 Nov 2026):

```text
game: active
receiver: inactive
build: 25782485
node: v24.21.0
listeners on 9443: 0
gaffer-bridge user: 0
exists /opt/gaffer-bridge: no
exists /etc/gaffer-bridge: no
exists /etc/gaffer-bridge-game: no
exists /home/satisfactory/server/FactoryGame/Mods: no
name: 100.71.187.3    openclaw-1.tail35a28.ts.net
cert domain: openclaw-1.tail35a28.ts.net
```

The receiver needs Node 24.21 or later. If the build is not `25782485`, stop: the guard in step b7 would
start the game without mods. Ask the user (step U). After step b, the four `exists` lines say `yes`
(for `Mods`, after b7), the receiver is `active` and port 9443 has one listener.

## Step a: backup (needs user approval)

Do these parts in this order. Each part needs user approval, because each one writes to the server.

1. [`README.md`](./README.md), steps 1.1, 1.2, 1.2a, 1.3 and 1.4: install the backup scripts and the
   daily timer. Follow its expected results.
2. [`README.md`](./README.md), step 3, with the label `before-bridge-install`:

   ```bash
   ssh openclaw 'sudo -n -u satisfactory /opt/gaffer-testbed/backup-saves.sh pre-install before-bridge-install'
   ```

   The last line is the path of the archive. Write it in the install record.

3. [`README.md`](./README.md), step 4: restore that archive into `/home/satisfactory/save-restore-test/check1`,
   and compare it with the live saves.

Step a changes no game file, and the game keeps running. If the backup fails, stop. Do not install
the bridge without an archive.

## Step b: install (the game keeps running)

**Each part of this step needs user approval.** The game does not load anything until step c. A game
crash restart between b7 and c would start the game with the mods on build `25782485`. To avoid that,
do b7 just before c.

**b1. Copy the staging folder to the server.** **Needs user approval.**

```bash
ssh openclaw 'install -d -m 0700 /tmp/gaffer-bridge-stage'
scp -r ~/gaffer-bridge-stage/. openclaw:/tmp/gaffer-bridge-stage/
ssh openclaw 'cd /tmp/gaffer-bridge-stage/pkg && sha256sum -c ../tools/testbed/bridge/packages.sha256'
```

Expected: two `OK` lines. (`install-mod.sh` checks the hash again on a private copy.)

**b2. Create the receiver user and install the files.** **Needs user approval.**

```bash
ssh openclaw 'sudo -n bash -es' <<'REMOTE'
S=/tmp/gaffer-bridge-stage
B=$S/tools/testbed/bridge
getent passwd gaffer-bridge >/dev/null || useradd --system --user-group --home-dir /var/lib/gaffer-bridge --no-create-home --shell /usr/sbin/nologin --comment "Gaffer bridge receiver" gaffer-bridge
install -d -m 0755 -o root -g root /opt/gaffer-bridge /opt/gaffer-bridge/bin /opt/gaffer-bridge/receiver /opt/gaffer-bridge/receiver/src
install -m 0644 -o root -g root $S/integrations/foreman-bridge/receiver/src/*.mjs /opt/gaffer-bridge/receiver/src/
install -m 0644 -o root -g root $S/integrations/foreman-bridge/receiver/package.json /opt/gaffer-bridge/receiver/
install -m 0755 -o root -g root $B/install-mod.sh $B/make-bridge-config.sh $B/renew-bridge-cert.sh $B/mods-control.sh /opt/gaffer-bridge/bin/
install -m 0644 -o root -g root $B/packages.sha256 /opt/gaffer-bridge/bin/
install -m 0644 -o root -g root $B/systemd/gaffer-bridge-receiver.service $B/systemd/gaffer-bridge-cert-renew.service $B/systemd/gaffer-bridge-cert-renew.timer /etc/systemd/system/
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/gaffer-bridge-receiver.service /etc/systemd/system/gaffer-bridge-cert-renew.service /etc/systemd/system/gaffer-bridge-cert-renew.timer
id gaffer-bridge
REMOTE
```

`systemd-analyze verify` must print nothing. `id` shows a system user and group `gaffer-bridge`.

**b3. Make the private configuration.** **Needs user approval.** The session name must be the exact
name of the saved session (`Codex`: the saves are `Codex_autosave_*`). The script prints no secret.

```bash
ssh openclaw 'sudo -n /opt/gaffer-bridge/bin/make-bridge-config.sh Codex'
ssh openclaw 'sudo -n stat -c "%a %U:%G %n" /etc/gaffer-bridge /etc/gaffer-bridge/receiver.json /etc/gaffer-bridge/dev.env /etc/gaffer-bridge/tls /etc/gaffer-bridge-game /etc/gaffer-bridge-game/bridge.json'
```

The second command only reads. Expected:

```text
700 root:root /etc/gaffer-bridge
600 root:root /etc/gaffer-bridge/receiver.json
600 root:root /etc/gaffer-bridge/dev.env
700 root:root /etc/gaffer-bridge/tls
750 root:satisfactory /etc/gaffer-bridge-game
600 satisfactory:satisfactory /etc/gaffer-bridge-game/bridge.json
```

Never print these files in a log or in chat. The next step reads them with a program that shows no value.

**b4. Get the TLS certificate from Tailscale.** **Needs user approval.** This asks Let's Encrypt for a
certificate for `openclaw-1.tail35a28.ts.net` (the cached one expired on 15 Sep). Certificates go in the public Certificate Transparency log, which shows the machine name.

That name is already in the log from the June certificate. The command can take up to a minute.

```bash
ssh openclaw 'sudo -n /opt/gaffer-bridge/bin/renew-bridge-cert.sh'
ssh openclaw 'sudo -n openssl x509 -in /etc/gaffer-bridge/tls/server.pem -noout -issuer -enddate -ext subjectAltName; sudo -n stat -c "%a %U:%G %n" /etc/gaffer-bridge/tls/server.pem /etc/gaffer-bridge/tls/server-key.pem'
```

Expected from the first command: `installed a certificate that expires <a date about 90 days away>`, then
`gaffer-bridge-receiver.service is not running; it will use the new certificate when it starts`.
The second command only reads. It must show issuer `Let's Encrypt`, `DNS:openclaw-1.tail35a28.ts.net`, mode `644` for
`server.pem` and `600` for `server-key.pem`, both owned by `root`.

If `tailscale cert` fails with a rate-limit message (HTTP 429), wait and run it again. If it fails
because HTTPS is off for the tailnet, the user must switch it on in the admin console (DNS page). Do
not continue without a certificate.

**b5. Start the receiver.** **Needs user approval.**

```bash
ssh openclaw 'sudo -n systemctl enable --now gaffer-bridge-receiver.service; sleep 3; systemctl status gaffer-bridge-receiver.service --no-pager | head -12; ss -ltnH "sport = :9443"'
```

Expected: `active (running)`, the journal line `Receiver ready on 100.71.187.3:9443`, and one `ss` line, on
`100.71.187.3:9443` only. If the unit fails, read `journalctl -u gaffer-bridge-receiver.service -n 30
--no-pager` and do not continue. A start failure with `EADDRNOTAVAIL` means Tailscale was not up: the
unit retries every 10 seconds.

Then check it (read-only, no approval needed). None of these commands uses `-k`. So each one proves that the client trusts the certificate chain and the name:

```bash
ssh openclaw 'curl -fsS https://openclaw-1.tail35a28.ts.net:9443/healthz; echo; curl -sS -o /dev/null -w "%{http_code}\n" -X POST -H "content-type: application/json" -d "{}" https://openclaw-1.tail35a28.ts.net:9443/v1/hello'
curl -fsS https://openclaw-1.tail35a28.ts.net:9443/healthz; echo
node -e 'fetch("https://openclaw-1.tail35a28.ts.net:9443/healthz").then(r => r.text()).then(console.log)'
```

Expected: `{"ready":true}` and then `401` from the server; `{"ready":true}` from the dev machine with
`curl`; `{"ready":true}` from Node (the trust store that `ff-server` uses). If the dev machine cannot
connect, the Tailscale access controls may block port 9443: ask the user. Nothing here shows a secret.

**b6. Enable the weekly certificate check.** **Needs user approval.** Run the job by hand first, to
prove that its sandbox works, then enable the timer.

```bash
ssh openclaw 'sudo -n systemctl start gaffer-bridge-cert-renew.service; systemctl status gaffer-bridge-cert-renew.service --no-pager | head -12; journalctl -u gaffer-bridge-cert-renew.service -n 5 --no-pager -o cat'
ssh openclaw 'sudo -n systemctl enable --now gaffer-bridge-cert-renew.timer; systemctl list-timers gaffer-bridge-cert-renew.timer --no-pager'
```

Expected: `status=0/SUCCESS`, the message `the installed certificate is current; nothing changed`, and the
receiver stays `active` with no restart. The timer's `NEXT` is a Monday near 03:30. If the job fails
inside its sandbox, read the journal, do **not** enable the timer, and report it.

**b7. Install SML and ForemanBridge, the approved build, and the drop-in.** **Needs user approval.**

```bash
ssh openclaw 'sudo -n bash -es' <<'REMOTE'
S=/tmp/gaffer-bridge-stage
B=$S/tools/testbed/bridge
MODS=/home/satisfactory/server/FactoryGame/Mods
/opt/gaffer-bridge/bin/install-mod.sh $S/pkg/SML-3.12.0-LinuxServer.zip $MODS
/opt/gaffer-bridge/bin/install-mod.sh $S/pkg/ForemanBridge-0.1.0-LinuxServer.zip $MODS
printf '%s\n' '# Steam build ids that SML 3.12.0 and ForemanBridge 0.1.0 are approved for.' \
  '# Add a build only after SML and the bridge support it (tools/testbed/bridge-runbook.md, step U).' \
  '25782485  # game 1.2.4.1, changelist 513885; ran on the disposable server on 14 Oct 2026' >/etc/gaffer-bridge-game/supported-builds
chown root:satisfactory /etc/gaffer-bridge-game/supported-builds
chmod 640 /etc/gaffer-bridge-game/supported-builds
install -d -m 0755 -o root -g root /etc/systemd/system/satisfactory.service.d
install -m 0644 -o root -g root $B/systemd/satisfactory-bridge.conf /etc/systemd/system/satisfactory.service.d/bridge.conf
systemctl daemon-reload
REMOTE
```

Expected: two lines `install-mod: installed SML (…) in …/Mods` and `install-mod: installed ForemanBridge (…)`. This does
not restart the game. Then check (read-only, no approval needed):

```bash
ssh openclaw 'systemctl show satisfactory.service -p ExecStartPre -p ExecStart -p Wants -p NeedDaemonReload | cut -c1-400'
ssh openclaw 'sudo -n -u satisfactory /opt/gaffer-bridge/bin/mods-control.sh status; sudo -n -u satisfactory test -r /etc/gaffer-bridge-game/bridge.json && echo "the game user can read bridge.json"; sudo -n -u satisfactory test -w /etc/gaffer-bridge-game/bridge.json -a -w /etc/gaffer-bridge-game || echo "the game user cannot replace bridge.json"'
ssh openclaw 'cd /home/satisfactory/server/FactoryGame/Mods/ForemanBridge && sha256sum -c /tmp/gaffer-bridge-stage/tools/testbed/bridge/foreman-bridge-files.sha256'
```

Expected:

- `ExecStartPre` lists the `steamcmd` line first and `mods-control.sh guard` second. `ExecStart` ends
  with `-Port=7777 -ReliablePort=8888 -ForemanBridgeConfig=/etc/gaffer-bridge-game/bridge.json`. `Wants` includes
  `gaffer-bridge-receiver.service`. `NeedDaemonReload=no`.
- `game build: 25782485`, `this build is approved for mods`, `mods are ON`.
- `the game user can read bridge.json`.
- Eight `OK` lines, one for each plugin file. The list is `bridge/foreman-bridge-files.sha256`: the SHA-256 of every file in the package.

**b8. Remove the staging copy.** **Needs user approval.**

```bash
ssh openclaw 'rm -rf /tmp/gaffer-bridge-stage'
```

## Step c: the first start with mods

**c1. The user saves in the game** (menu, Save) and waits until it finishes. The game does not save on
shutdown. The restart loses everything since the last save. Check that no one else plays.

**c2. Take a backup of this moment.** **Needs user approval.** It is the restore point for the first
save that SML makes.

```bash
ssh openclaw 'sudo -n -u satisfactory /opt/gaffer-testbed/backup-saves.sh pre-install before-first-modded-start'
```

The last line is the archive path. Write it in the install record. Run step P again, and write the
build id and the memory numbers (step M) in the install record.

**c3. Restart the game.** **Needs user approval.**

```bash
ssh openclaw 'sudo -n systemctl restart satisfactory.service'
```

The stop takes up to 60 seconds. Then `steamcmd` runs (it can download a game update: minutes), then
the guard runs, then the game loads the world. The start can take up to 20 minutes
(`TimeoutStartSec`).

**c4. Read the result (read-only, no approval needed).** Repeat until the game is `active` and the
log shows the world.

```bash
ssh openclaw 'systemctl is-active satisfactory.service; sudo -n journalctl -u satisfactory.service --since "-30min" --no-pager -o cat | grep -E "mods-control|Mounting Mod plugin|SatisfactoryModLoader: Display: (SML|ForemanBridge)|LogForemanBridge|Bridge baseline|Bridge receiver failure|Bridge stopped" | cut -c1-220'
```

Two outcomes are possible.

- **The build did not change.** The guard line says `game build 25782485 is approved; mods stay on`.
  Then expect: `Mounting Mod plugin SML` and `Mounting Mod plugin ForemanBridge`, a
  `ForemanBridge: 0.1.0` line from the mod loader, `ForemanBridge 0.1.0 authoritative constructor bridge`,
  and `Bridge baseline epoch=<uuid> count=<N> seq=0`. `N` is the number of Constructors in the real
  factory. Go to step d.
- **The build changed.** The guard line says `game build '<id>' is not in … moved Mods to Mods.off. The server
starts WITHOUT mods.` There is no `ForemanBridge` line. This is the user's rule of 28 Oct. Go to
  step U. The server is healthy and plain.

If the journal shows `REFUSING TO START THE GAME`, go to "If the guard refuses the start". If the game does not come up in any other way (repeated restarts, `failed`), go to R1 at once, and report the log.

If you see `Bridge receiver failure`, read the TLS section ("If the game rejects the certificate") and
the line `category=`. A connection failure (`http=0`) while the receiver does not run is normal. The plugin retries. A TLS rejection stops delivery until the next restart.

## Step d: the user installs SML on the game client

The player's client needs **SML 3.12.0 only**. The bridge is server-only (`RequiredOnRemote` is false).
This step changes the user's Windows machine, not the server.

1. In Satisfactory Mod Manager (3.0.0 or later), make a profile for this server, add SML, and select
   version **3.12.0**. Keep the same version as the server.
2. Start the game from that profile and join the server.
3. Expected: the join works. A mod mismatch message means that the SML versions differ. Check
   that both are 3.12.0.

I could not check the SMM screens. The steps follow the Satisfactory modding documentation on
[installing mods on dedicated servers](https://docs.ficsit.app/satisfactory-modding/latest/ForUsers/DedicatedServerSetup.html).
For a game without mods, start Satisfactory from Steam directly, or from an SMM profile with no mods.

## Step e: check the bridge, then connect `ff-server`

**e1. Server side (read-only, no approval needed).**

```bash
ssh openclaw 'systemctl status gaffer-bridge-receiver.service --no-pager | head -8; journalctl -u gaffer-bridge-receiver.service -n 10 --no-pager -o cat'
ssh openclaw 'systemctl show satisfactory.service gaffer-bridge-receiver.service -p MemoryCurrent -p MemoryPeak -p NRestarts -p Result'
```

The receiver is `active`, and it shows no error. The receiver does not log requests, tokens or
bodies, so a quiet journal is normal.

**e2. In the game.** The user joins and types `/foremanbridge status` in the game chat. Expected: it reports the Constructor count (the same `N` as in step c4), an epoch and a latest sequence. It also reports a recent receiver ACK, a queue size of 0 and no history gap. Ask the user to place one Constructor and
run it again: the count goes up by one.

**e3. Move the query secrets to the dev machine.** _Reads the server's secret file, writes only on the
dev machine._ **Needs user approval.** The values travel inside the SSH session and go into a `0600` file outside the repository. Nothing prints them.

Never run `cat` on the file.

```bash
tools/testbed/bridge/fetch-bridge-env.sh openclaw
```

Expected: `wrote /home/<you>/.config/gaffer/bridge.env (mode 0600) with: FOREMAN_BRIDGE_URL
FOREMAN_BRIDGE_QUERY_TOKEN FOREMAN_BRIDGE_SERVER_ID FOREMAN_BRIDGE_WORLD_ID. Values not shown.` The file has only
the query token. The producer token never leaves the server.

**e4. Ask the receiver directly (no model call, no approval needed).** This needs the file from e3.

```bash
( . ~/.config/gaffer/bridge.env
  printf 'header = "Authorization: Bearer %s"\n' "$FOREMAN_BRIDGE_QUERY_TOKEN" |
    curl -fsS --config - -X POST "$FOREMAN_BRIDGE_URL/query/v1/constructors" -H 'Content-Type: application/json' -d '{"includeLocations":true,"limit":2}' ) | python3 -m json.tool
```

The token goes to `curl` on standard input, through `printf` (a shell built-in). It is not in the
command line, so `ps` and the shell history never show it. The subshell keeps the values out of the
environment of the next command. Never put the token in a `-H` option.

Expected: `"status": "fresh"`, `"reason": "recent_sync"`, `"totalCount"` equal to `N`, and two
`locations` in centimetres. A `last_known` status with reason `stale` means that the game has not
synchronised for 15 seconds or more.

**e5. Start `ff-server` against the receiver.** Start `sf-mcp` and `ff-server` as you do for development
(`npm run dev:mcp`, then `npm run dev:server`), but load the file first. `ff-server` reads the `FOREMAN_BRIDGE_*` variables when it starts. Do not set `NODE_EXTRA_CA_CERTS`: Node trusts the public
chain by itself (see `bridge-design.md`, section 3).

1. Start `ff-server` without the playthrough id. Make a playthrough in the web app (`npm run dev:web`),
   with the account that will chat. Its id is the `:playthroughId` in the `/api/playthroughs/<id>`
   requests.
2. Add the id (it is not a secret) and restart `ff-server` with all five variables:

   ```bash
   printf 'FOREMAN_BRIDGE_PLAYTHROUGH_ID=%s\n' '<playthrough id>' >> ~/.config/gaffer/bridge.env
   set -a; . ~/.config/gaffer/bridge.env; set +a
   npm run dev:server
   ```

Expected: `ff-server` starts with no `Live bridge configuration is incomplete` error and no warning about
the playthrough. If it fails, [`docs/live-constructor-awareness.md`](../../docs/live-constructor-awareness.md)
has a troubleshooting table.

**e6. Ask a live question.** **Needs user approval, because it makes a paid model call.** In the linked
playthrough, ask: "How many Constructors do I have, and where?" Expected: the answer uses
`get_live_constructor_state`, says that the observation is live, and gives the count `N` from e2 and e4.
Check the unavailable case too.

Stop the receiver for a minute (`ssh openclaw 'sudo -n systemctl stop gaffer-bridge-receiver.service'`, **needs user approval**). Ask again: the answer says that live data is unavailable, and normal chat works. Then start the receiver again. The game
retries, and the status returns to `fresh` within seconds.

In a later change, record the counts, the stale interval and the wording of the answer in [`docs/live-constructor-awareness.md`](../../docs/live-constructor-awareness.md), section "Real game / web-chat acceptance".

## If the game rejects the certificate

Use this only if step c4 or e2 shows that the game cannot connect over TLS. The signs are a `Bridge receiver failure` line that is not a plain connection failure, or `/foremanbridge status` with no ACK while e4 works.
A TLS rejection disables delivery until the game restarts. **Needs user approval, and the user's decision.** The documentation describes the setting for a test CA only.

The fallback adds the public root `ISRG Root X1`, which is in the server's system store, to the game's
trust. The game keeps the host name check and the peer check.

```bash
ssh openclaw 'sudo -n -u satisfactory cat /home/satisfactory/server/FactoryGame/Saved/Config/LinuxServer/Engine.ini 2>&1 | grep -nE "^\[(SSL|/Script/Engine.NetworkSettings)\]|DebuggingCertificatePath|VerifyPeer|bValidateRootCertificates"'
```

The command only reads. If it shows no `[SSL]` section, add this block as the game user, with the game stopped. Then start the game:

```bash
ssh openclaw 'sudo -n systemctl stop satisfactory.service && sudo -n -u satisfactory tee -a /home/satisfactory/server/FactoryGame/Saved/Config/LinuxServer/Engine.ini >/dev/null <<EOF

[SSL]
DebuggingCertificatePath=/etc/ssl/certs/ISRG_Root_X1.pem
bValidateRootCertificates=true

[/Script/Engine.NetworkSettings]
n.VerifyPeer=true
EOF
sudo -n systemctl start satisfactory.service'
```

If the file already has an `[SSL]` section, edit it by hand instead of appending a second one. Then
repeat step c4. If this also fails, stop and report. The next option is the private CA of `integrations/foreman-bridge/receiver/scripts/make-test-cert.sh`. It is a short-lived test CA and does not suit a long run.

## Step M: watch memory (read-only, no approval needed)

`satisfactory.service` has `MemoryMax=6G` and `MemorySwapMax=1G`. On 5 Nov it showed `MemoryCurrent`
about 4.1 GB and `MemoryPeak` 5.32 GB (since 27 Oct), with 3.9 GB available on the host. SML and the
bridge add memory. The receiver has its own cap (256 MB) and is a separate cgroup.

```bash
ssh openclaw 'systemctl show satisfactory.service -p MemoryCurrent -p MemoryPeak -p MemoryMax -p MemorySwapCurrent -p NRestarts -p Result; systemctl show gaffer-bridge-receiver.service -p MemoryCurrent -p MemoryPeak; free -m | sed -n "1,2p"'
ssh openclaw 'sudo -n journalctl -k --since "-1day" --no-pager -o cat | grep -iE "out of memory|oom-kill|Killed process" | tail -5'
```

`MemoryPeak` restarts from 0 at each start. Look at it:

| When                                                            | Why                              |
| --------------------------------------------------------------- | -------------------------------- |
| Before step c (write it down: 5.32 GB)                          | The baseline without mods        |
| 10 minutes after the modded start, and after the first autosave | The autosave spikes by 2 to 4 GB |
| After one day of play                                           | A full day, with autosaves       |

| Reading                                                       | Action                                                                                  |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `MemoryPeak` below 5.6 GB, `NRestarts=0`, no `oom-kill` line  | Fine.                                                                                   |
| `MemoryPeak` above 5.6 GB (93% of the cap)                    | Report it to the user. Check again after the next autosave.                             |
| `Result=oom-kill`, `NRestarts` goes up, or an `oom-kill` line | The limit was hit. **Do R1 now** (start without mods), report the numbers, and compare. |

Do not raise `MemoryMax` to cure it. The host has 7.6 GiB in total, and it also runs Pi-hole, Caddy and Foreman. The user decides on a change of the cap.

## Step U: after a game update

The restart in step c, and every later restart, runs `steamcmd … validate` first. The guard (in the
drop-in) then compares the installed Steam build with `/etc/gaffer-bridge-game/supported-builds`.

**What happens by itself.** The build is not in the list, so the server starts **without mods** and the
journal says so (`WITHOUT mods`). The bridge stops. The receiver keeps running. The saves stay as the
game wrote them. This is the user's decision of 28 Oct.

**What the player must do.** A client with SML installed cannot join a server that lacks SML. Since SML 3.9, a client refuses a server that is missing a mod that the client has. Start Satisfactory from Steam
directly, or from an SMM profile with no mods. The client updates itself through Steam, so it already
runs the new build.

**Check the state (read-only, no approval needed):**

```bash
ssh openclaw 'sudo -n -u satisfactory /opt/gaffer-bridge/bin/mods-control.sh status; sudo -n journalctl -u satisfactory.service --since "-1day" --no-pager -o cat | grep mods-control | tail -3'
```

**To start without mods on purpose** (for example, to test whether a problem comes from the mods),
**needs user approval**. Save in the game first. Run the command of R1. It works in every state of the
mods.

**To switch mods on again after an update** **needs user approval and a test first**:

1. Find out whether SML supports the new build. List the SML releases:

   ```bash
   curl -fsS https://api.ficsit.app/v2/query -H 'Content-Type: application/json' -d '{"query":"{ getSMLVersions(filter:{limit:3, order_by: created_at, order: desc}) { sml_versions { version satisfactory_version created_at } } }"}'
   ```

   `satisfactory_version` is the minimum build. It does not promise that the version works on a newer
   build. SML 3.12.0 has 491125.

2. Check that the bridge works on the new build. The library links against game code. The user built it for changelist 513885. Test it on the disposable server (`satisfactory-bridge-test`). If the test fails, the user must make a new Windows build. A new build is the user's decision.
3. Install the packages that passed. Change `bridge/packages.sha256` in a pull request if they are new.
   Move the old mod folders away first, because `install-mod.sh` never replaces one. With the game stopped, run `mods-control.sh off`. Then delete the `Mods.off*` folder that it makes. Then install the new ones as in step b7.
4. Add the build id to `/etc/gaffer-bridge-game/supported-builds` (one number per line; `#` starts a
   comment). Then, with the game stopped:

   ```bash
   ssh openclaw 'sudo -n systemctl stop satisfactory.service && sudo -n -u satisfactory /opt/gaffer-bridge/bin/mods-control.sh on && sudo -n systemctl start satisfactory.service'
   ```

   `on` refuses a build that is not in the list, and it refuses while the game runs.

5. Update SML on the client to the same version (step d).

## R1: start without mods (rollback, level 1)

Use it when the modded server does not start or memory hits the limit. Use it also when the mods might
cause a problem. The receiver, the files and the drop-in stay. **Needs user approval.** If the server
is healthy, save in the game first.

```bash
ssh openclaw 'sudo -n systemctl stop satisfactory.service && sudo -n -u satisfactory /opt/gaffer-bridge/bin/mods-control.sh off && sudo -n systemctl start satisfactory.service'
```

The command works in every state of the mods. `mods-control.sh off` succeeds when the mods are already off. It also succeeds when there never were mods. When `Mods` and `Mods.off` both exist, it moves `Mods` to `Mods.off-<stamp>`. The game starts again each time.

If `off` itself fails because it cannot move the folder, the game stays stopped and the error is on the screen. Then see "If the guard refuses the start".

Expected: `mods are OFF` or `mods are already off`, and the server starts as a plain server (read the
journal as in step c4: no `ForemanBridge` line). The player starts the game without SML (see step U).
If the world does not load, go to R2 and R3.

## If the guard refuses the start

The guard (`mods-control.sh guard`, in the drop-in) stops the game from starting in **one case only**. Three things are true together. The mods are present. The build is not on the approved list, or the guard cannot read it. The guard cannot move the mods away.

The reason is the user's rule of 28 Oct. SML on an unapproved build can
crash the game or write mod data into the save, and a stopped server protects the save. In every
other case the guard exits 0. With no `Mods` folder, it exits 0 whatever else fails.

The journal then has one line: `mods-control: REFUSING TO START THE GAME: build '<id>' is not approved for mods, and … cannot be moved away`. systemd retries every 60 seconds, and each try runs `steamcmd`
again.

1. Stop the retries. **Needs user approval.**

   ```bash
   ssh openclaw 'sudo -n systemctl stop satisfactory.service'
   ```

2. Find the reason (read-only, no approval needed). The move needs write access to the
   `FactoryGame` folder, which the game user owns (mode `775` on 5 Nov).

   ```bash
   ssh openclaw 'sudo -n journalctl -u satisfactory.service --since "-1h" --no-pager -o cat | grep mods-control | tail -3; ls -ld /home/satisfactory/server/FactoryGame /home/satisfactory/server/FactoryGame/Mods*'
   ```

3. Repair the folder. **Needs user approval.**

   ```bash
   ssh openclaw 'sudo -n chown satisfactory:satisfactory /home/satisfactory/server/FactoryGame && sudo -n chmod 775 /home/satisfactory/server/FactoryGame'
   ```

4. Run the command of R1. It moves the mods away and starts the game without mods. Then follow step U.

## R2: back to the state before the bridge (rollback, level 2)

This removes the bridge from the running system: the receiver stops, the drop-in goes, and every mods
folder leaves the game folder. The backup and the files under `/opt` and `/etc` stay, so a new try is
easy. **Needs user approval.** The game does not save on shutdown, so save first if it is healthy.

The script works after a half-finished install, at any point from b1 to b7. It does not use `set -e`,
and it tolerates a missing unit, a missing drop-in and a missing folder.

It stops and starts the game only if the drop-in or a mods folder exists (then step b7 has started). If it stops the game, it starts the game again. The one exception is a mods folder that it cannot move. Then the game stays stopped and the script says so, because a start would load the mods. With nothing to roll back in the game, it leaves the game
running.

Every folder that the guard and `mods-control.sh` can make (`Mods`, `Mods.off`, `Mods.off-<stamp>`)
moves into one new folder, `Mods.removed-<stamp>`. Step X deletes it.

```bash
ssh openclaw 'sudo -n bash -s' <<'REMOTE'
FG=/home/satisfactory/server/FactoryGame
DROPIN=/etc/systemd/system/satisfactory.service.d/bridge.conf
HOLD=$FG/Mods.removed-$(date -u +%Y%m%dT%H%M%SZ)
CHANGE=no
for path in $DROPIN $FG/Mods $FG/Mods.off*; do
  if [ -e "$path" ]; then CHANGE=yes; fi
done
if [ $CHANGE = yes ]; then
  systemctl stop satisfactory.service || { echo "R2 stopped: the game did not stop"; exit 1; }
fi
for unit in gaffer-bridge-cert-renew.timer gaffer-bridge-receiver.service; do
  systemctl disable --now $unit 2>/dev/null || echo "note: $unit is not installed or not enabled"
done
rm -f $DROPIN
rmdir /etc/systemd/system/satisfactory.service.d 2>/dev/null
systemctl daemon-reload
if [ $CHANGE = yes ]; then
  FAILED=no
  for path in $FG/Mods $FG/Mods.off*; do
    [ -e "$path" ] || continue
    sudo -u satisfactory mkdir -p "$HOLD" && sudo -u satisfactory mv -T -- "$path" "$HOLD/$(basename "$path")" || FAILED=yes
  done
  if [ $FAILED = yes ]; then echo "R2 stopped: a mods folder could not be moved; the game stays stopped"; exit 1; fi
  systemctl start satisfactory.service
fi
echo "R2 done"
REMOTE
```

Then check (read-only, no approval needed):

```bash
ssh openclaw 'bash -s' <<'REMOTE'
echo "bridge lines in the unit: $(systemctl cat satisfactory.service --no-pager | grep -cE 'bridge|ForemanBridge|mods-control')"
echo "listeners on 9443: $(ss -ltnH 'sport = :9443' | wc -l)"
echo "game: $(systemctl is-active satisfactory.service)"
echo "Mods folder: $([ -e /home/satisfactory/server/FactoryGame/Mods ] && echo present || echo absent)"
ls -d /home/satisfactory/server/FactoryGame/Mods*
REMOTE
```

Expected: `bridge lines in the unit: 0`, `listeners on 9443: 0`, `game: active` (after the load time), `Mods folder: absent`,
and the `Mods.removed-<stamp>` folder in the listing (it holds the moved folders). The journal has no `ForemanBridge` line. The unit has its
original `ExecStart`.

## R3: restore the saves (rollback, level 3)

Use it only if the world does not load without SML. The game log says why. **Needs user approval.**

The restore loses what the players did since the archive. Follow [`README.md`](./README.md), step 5, with the archive
from step c2 (`before-first-modded-start`). If the game still cannot load that archive, use the archive of step a
(`before-bridge-install`). Step 5 of the README archives the current saves first, so a restore can be undone.

## X: remove everything

Do R2 first. The script refuses to run while the drop-in or a `Mods` folder exists. **Needs user
approval.** It works after a half-finished install. It deletes the receiver database (the live state
history of the bridge; nothing else uses it) and every `Mods.removed-*` and `Mods.off*` folder. It
leaves the save backups in place; delete those by the README, step 6, when you no longer need them.

```bash
ssh openclaw 'sudo -n bash -s' <<'REMOTE'
FG=/home/satisfactory/server/FactoryGame
if [ -e /etc/systemd/system/satisfactory.service.d/bridge.conf ] || [ -e $FG/Mods ]; then
  echo "X stopped: the drop-in or the Mods folder still exists. Do R2 first."
  exit 1
fi
systemctl disable --now gaffer-bridge-cert-renew.timer gaffer-bridge-receiver.service 2>/dev/null
rm -f /etc/systemd/system/gaffer-bridge-receiver.service /etc/systemd/system/gaffer-bridge-cert-renew.service /etc/systemd/system/gaffer-bridge-cert-renew.timer
systemctl daemon-reload
rm -rf /opt/gaffer-bridge /etc/gaffer-bridge /etc/gaffer-bridge-game /var/lib/gaffer-bridge /tmp/gaffer-bridge-stage
if getent passwd gaffer-bridge >/dev/null; then userdel gaffer-bridge; fi
rm -rf $FG/Mods.removed-* $FG/Mods.off*
echo "X done"
REMOTE
```

Leftovers that the removal does not touch, and that do no harm:

- Files that SML or the game wrote: look for `/home/satisfactory/server/FactoryGame/Configs` and a
  `[Core.System] Paths=…/Mods/SML/Content` line in
  `/home/satisfactory/server/FactoryGame/Saved/Config/LinuxServer/Engine.ini` (the disposable server
  shows that SML adds it). The game ignores a path to a missing folder.
- The cached certificate under `/var/lib/tailscale/certs`, which belongs to Tailscale. The Certificate
  Transparency log keeps the certificate entry for ever.
- On the dev machine: `~/.config/gaffer/bridge.env`, `~/gaffer-bridge-packages` and
  `~/gaffer-bridge-stage`. Delete them when you finish.
- On the player's machine: the SMM profile with SML.
- An `Engine.ini` change from "If the game rejects the certificate". Remove the `[SSL]` block by hand.

## Files in `bridge/`

| File                                                                                 | Job                                                                                                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `packages.sha256`                                                                    | The SHA-256 of the two pinned packages.                                                                                        |
| `foreman-bridge-files.sha256`                                                        | The SHA-256 of each file inside the ForemanBridge package. Step b7 checks the installed files with it.                         |
| `install-mod.sh`                                                                     | Installs one pinned package into `FactoryGame/Mods`: checks the hash, the entry names and the layout. Never replaces a folder. |
| `make-bridge-config.sh`                                                              | Writes `receiver.json`, `bridge.json` and `dev.env` with fresh random secrets. Never overwrites.                               |
| `renew-bridge-cert.sh`                                                               | Gets the Tailscale certificate, checks it, installs it if it changed, and restarts the receiver.                               |
| `mods-control.sh`                                                                    | `guard` (run by the drop-in at each game start), `status`, `on`, `off`.                                                        |
| `fetch-bridge-env.sh`                                                                | Dev machine: copies `dev.env` from the server into a private file without showing it.                                          |
| `systemd/gaffer-bridge-receiver.service`                                             | The receiver. Tailscale address only. Own user. Hardened.                                                                      |
| `systemd/gaffer-bridge-cert-renew.service`, `systemd/gaffer-bridge-cert-renew.timer` | The weekly certificate check.                                                                                                  |
| `systemd/satisfactory-bridge.conf`                                                   | The drop-in for `satisfactory.service`: starts the receiver first, runs the guard, adds the config flag.                       |
| `test-bridge-*.sh`                                                                   | Local tests for the scripts, the units and the runbook's own R1, R2, X and e4 commands. No server is involved.                 |
