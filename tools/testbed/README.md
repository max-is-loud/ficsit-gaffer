# Test bed: save backup for the dedicated server

This folder holds the backup tooling for the live Satisfactory dedicated server (SSH alias
`openclaw`). The server is the future test bed for the Gaffer bridge. It belongs to
issue #65, task 1. Back up the real save before each bridge install.

**Nothing in this folder runs on the server until the user approves it.** Every step that
changes the server is marked **needs user approval**. Read-only checks need no approval.

## Files

| File | Job |
|---|---|
| `backup-saves.sh` | Archives the whole `SaveGames` directory. Modes: `daily`, `pre-install <label>`. |
| `restore-saves.sh` | Restores an archive into a **new** directory. It never writes into the live saves. |
| `systemd/gaffer-save-backup.service` | Runs `backup-saves.sh daily` as the user `satisfactory`. |
| `systemd/gaffer-save-backup.timer` | Starts the service every day at 04:30 server time. |
| `validate-saves.mjs` | Node.js. Parses every save in a directory with the pinned parser library. Fails if one is incomplete. |
| `package.json`, `package-lock.json` | Pin the parser library (`@etothepii/satisfactory-file-parser` 4.1.2, the version of `packages/sf-save-data`). |
| `test-save-backup.sh` | Tests the backup and restore scripts with a fake save tree. No server is involved. |
| `test-save-validation.sh` | Tests the validation step. Some tests need one real save (see step 0). |
| `test-common.sh`, `cut-save.mjs` | Test helpers: shared setup, and a tool that cuts a real save in two ways. |

## Design decisions

### Where the archives go, and who runs the backup

- **User:** `satisfactory`. It owns the saves (mode `750`), so it needs no extra group or `sudo` rule. The task does not touch `foreman-save-sync`, which uses a different user.
- **Archive location:** `/home/satisfactory/save-backups/`. This path is outside `Saved/` and
  outside `server/`. A game update (`app_update … validate`) or a save-folder change cannot
  touch it. The game unit already has `ReadWritePaths=/home/satisfactory`, so the home is
  the one tree that the game and the backup both use.
- **Limit:** the archives sit on the same disk (`/`, about 30 GB free) as the saves. They
  protect against a bad save, a bad restore and a bad bridge install. They do not protect
  against a lost disk. Copy the `pre-install` folder off the host if that matters.
- **Layout:**

```text
/home/satisfactory/save-backups/
  daily/        saves-20261029T083000Z.tar  + .sha256     rotated
  pre-install/  saves-20261029T150000Z-before-bridge-v1.tar  + .sha256     never rotated
```

The rotation reads only `daily/`. It cannot delete a `pre-install` archive, whatever the
label is. The script also makes each `pre-install` file read-only.

### Retention

- `daily/`: keep the newest **14** archives (`GAFFER_KEEP_DAILY`). That gives two weeks to
  notice a problem. One archive is about 6 MB, so 14 archives use about 85 MB.
- `pre-install/`: keep **all**. One archive is about 6 MB. Even 100 archives use about
  600 MB. Delete one by hand when you no longer need it.
- Archives are plain `.tar`. The game compresses its saves already, so `gzip` gives almost
  no gain.
- A run rotates only after it has written a new archive. A failed run deletes nothing.

### How the backup avoids a save that is being written

A copy of a half-written file is useless. A quiet period cannot prove that a save is
complete, because a writer can stop for any length of time. Two reviews found two gaps:
a writer that keeps a half-written file open and pauses, and a writer that closes it and
reopens it later to append. The script therefore uses two guards that do not depend on a
time threshold. The second one decides.

**Guard 1: wait while a writer may be active.** On every scan, the script treats each of
these as "busy":

- A process holds a save open for write. The script scans `/proc/*/fd` for a descriptor that
  points into `SaveGames`, and reads the access mode from `/proc/<pid>/fdinfo/<fd>`. A
  write or read-write mode is busy. A read-only holder (for example `foreman-save-sync`) is
  not.
- The script cannot look. This is any process of the saves' owner whose `fd` directory is
  unreadable (for example a process that marks itself non-dumpable), or a descriptor whose
  access mode is unreadable. A failed look is "busy", never "idle". The script does this on
  **every** scan, so a writer that hides after an earlier scan still blocks the backup.
  `GAFFER_UNINSPECTABLE_OK_COMMS` names processes that the scan may skip (empty on the
  server). The tests use it for the helpers of a login machine.

The script waits up to 120 seconds (`GAFFER_MAX_WAIT_SECONDS`), then exits with an error
and makes **no archive**. A 15-second quiet period (`GAFFER_QUIET_SECONDS`) is a cheap extra
check. It does not decide alone.

**Guard 2: prove that every save is complete.** After the copy, the script runs
`validate-saves.mjs` on the **staged copy**. The validator parses every `.sav` with the
pinned parser library, with `throwErrors` on. A save fails if any of these is true:

- the file is empty or does not parse;
- the compressed data ends inside a chunk (the library cannot inflate it);
- the compressed data ends exactly between two chunks (the library compares the size that
  the save declares with the size that it holds, and reports `Possibly corrupt`);
- bytes follow the end of the data;
- the parser reports a corrupt or unreadable object.

The validator checks the save itself. It does not look at timing or at open files, so it
catches a writer that closed a half-written file. If the validator fails, the script waits
5 seconds (`GAFFER_VALIDATE_RETRY_SECONDS`) and copies again, up to `GAFFER_MAX_WAIT_SECONDS`.
If the save is still not complete, the script exits with an error and makes **no archive**.
If the validator cannot run at all (exit code 2, for example the library is missing), the
script fails at once. `ServerSettings.*.sav` is not a game save, so the validator skips it
(`GAFFER_VALIDATE_SKIP`). Only guard 1 and the checks below protect that file. It is small
and changes rarely.

**Checks around the copy.** The script copies the whole directory to a private staging
directory with `cp -a`. It accepts the copy only if all three conditions are true:

- no guard-1 reason exists after the copy,
- no file in the source changed after the copy began, and
- `diff -r` shows that every copied file equals its source. This also catches a file that
  the game created or renamed during the copy.

If the saves change during the copy, it retries up to 5 times (`GAFFER_COPY_ATTEMPTS`).

**Publish last.** The script builds the `.tar` and the `.sha256` file in the staging
directory. It moves them into `daily/` or `pre-install/` only after every step has
succeeded. A failure at any step leaves nothing in those directories.

On `openclaw` (read-only checks): the game runs as `satisfactory`, as does the backup. Run
as that user, the scan sees the game's open files (it found the game's open log file), and
no process of that user is hidden. `ProtectProc=invisible` in the unit hides only the
processes of **other** users, so the sandbox does not blind the scan.

**What a real save showed.** On 28 Oct 2026 the validator accepted a real `Codex_autosave`
from `openclaw` (1.3 MB, 13.9 MB after inflate; 0.7 s and about 250 MB of memory). A copy cut
in the middle of a chunk, a copy cut exactly between two chunks, and a copy with extra bytes
at the end were each rejected.

**Residual risk.** The validator proves that a save is complete in itself. It cannot prove
that it is the **latest** state. A backup made while the game is between two saves holds the
older, complete save. Nothing else is open. The validator also depends on the parser. After a
game update the parser may not read the new format; then every backup fails (see "After a game
update" in the runbook). I could not confirm whether the game writes a save atomically.

A lock file stops the timer and a manual run from running at the same time. The script
also refuses to start if less than 1 GiB is free (`GAFFER_MIN_FREE_MB`).

An archive holds what is **on disk**. It does not hold the state of the running game. The
game does not save on shutdown. For a fresh point, save in the game first (or wait for an
autosave), then run the backup.

### The systemd units

The service copies the hardening of `satisfactory.service`: `NoNewPrivileges`,
`ProtectSystem=strict`, `PrivateTmp`, `PrivateDevices`, the `Protect*` and `Restrict*`
options, an empty `CapabilityBoundingSet`, and a `MemoryMax`. It differs in four ways:

- `ProtectHome=read-only` with `ReadWritePaths=/home/satisfactory/save-backups`. The backup
  needs to read the saves under `/home` but write in one directory only. The game unit
  cannot use `ProtectHome=true`. This unit does not need to write in the home, so
  read-only is correct.
- `RestrictAddressFamilies=AF_UNIX`. The job does no network I/O. It needs only the
  journal socket.
- `Nice=10` and `IOSchedulingClass=idle`, so the backup does not slow the game.
- `MemoryMax=1G` (the game unit uses 6G). The validator runs Node.js and uses about 250 MB
  for one save. Node also gets `--max-old-space-size=768`, so a garbage file fails fast. Node
  needs to read `/opt/gaffer-testbed` (read-only is enough) and to use the staging copy under
  the one read-write path. It needs no network, no write access outside that path, and no
  executable memory rule: the unit does not set `MemoryDenyWriteExecute`, which V8 cannot use.

`systemd-analyze security --offline` rates the service **2.9 OK** (checked on this machine). I could not run the sandbox itself on this machine, so step 1.3 is its first real test.

## Runbook

All commands run from a checkout of this repository on your machine, in this folder
(`tools/testbed/`), unless the text says otherwise. `openclaw` is the SSH alias.

### 0. Test the scripts locally (no approval needed)

Install the pinned library once, then run both test scripts:

```bash
(cd tools/testbed && npm ci --omit=dev --ignore-scripts)
tools/testbed/test-save-backup.sh
tools/testbed/test-save-validation.sh
```

Each script ends with `all N checks passed`. They use only temporary directories. The
tests in the second group of `test-save-validation.sh` need one real save. Point
`GAFFER_TEST_REAL_SAVE` at a copy of a `.sav` file. Without it the script prints a `skip`
message and runs the other tests only:

```bash
GAFFER_TEST_REAL_SAVE=/path/to/copy-of-a-real.sav tools/testbed/test-save-validation.sh
```

Keep the copy outside the repository, and delete it when you finish. Never commit a save.

### 1. Install (needs user approval, every step)

**1.1 Copy the files to `/tmp` on the server.** *Needs user approval.*

```bash
scp backup-saves.sh restore-saves.sh validate-saves.mjs package.json package-lock.json \
  systemd/gaffer-save-backup.service systemd/gaffer-save-backup.timer openclaw:/tmp/
```

**1.2 Install the scripts, the units and the backup directory.** *Needs user approval.* This does not use the network.

```bash
ssh openclaw '
  set -e
  sudo install -d -m 0755 -o root -g root /opt/gaffer-testbed
  sudo install -m 0755 -o root -g root /tmp/backup-saves.sh /tmp/restore-saves.sh /tmp/validate-saves.mjs /opt/gaffer-testbed/
  sudo install -m 0644 -o root -g root /tmp/package.json /tmp/package-lock.json /opt/gaffer-testbed/
  sudo install -m 0644 -o root -g root /tmp/gaffer-save-backup.service /tmp/gaffer-save-backup.timer /etc/systemd/system/
  sudo install -d -m 0700 -o satisfactory -g satisfactory /home/satisfactory/save-backups
  rm /tmp/backup-saves.sh /tmp/restore-saves.sh /tmp/validate-saves.mjs /tmp/package.json /tmp/package-lock.json /tmp/gaffer-save-backup.service /tmp/gaffer-save-backup.timer
  sudo systemctl daemon-reload
  systemd-analyze verify /etc/systemd/system/gaffer-save-backup.service /etc/systemd/system/gaffer-save-backup.timer
'
```

`systemd-analyze verify` must print nothing.

**1.2a Install the pinned parser library.** *Needs user approval.* This step uses the
network: `npm ci` downloads the library and its one dependency (`pako`) from the npm
registry. The lock file pins exact versions and their hashes, and `--ignore-scripts` stops
any install script. The library goes under `/opt/gaffer-testbed/node_modules`. Do **not** use
the copy under `/opt/foreman`: that deployment will be replaced.

```bash
ssh openclaw 'cd /opt/gaffer-testbed && sudo npm ci --omit=dev --ignore-scripts --no-audit --no-fund && node --version && sudo -n -u satisfactory node -e "import(\"/opt/gaffer-testbed/node_modules/@etothepii/satisfactory-file-parser/build/index.js\").then(() => console.log(\"parser loads as satisfactory\"))"'
```

The output must end with `parser loads as satisfactory`. This proves that the game's user can load the library.

**1.3 Run the first backup by hand.** *Needs user approval.* It writes one archive and
changes nothing else.

```bash
ssh openclaw 'sudo systemctl start gaffer-save-backup.service; systemctl status gaffer-save-backup.service --no-pager; sudo -n -u satisfactory ls -l /home/satisfactory/save-backups/daily'
```

The status must show `status=0/SUCCESS`. The journal must show an `ok` line for each
`Codex_autosave*.sav`. The listing must show one `.tar` and one `.tar.sha256`. If the unit fails, do not enable the timer. Read
`journalctl -u gaffer-save-backup.service`.

**1.4 Enable the timer.** *Needs user approval.*

```bash
ssh openclaw 'sudo systemctl enable --now gaffer-save-backup.timer'
```

### 2. Check that the timer runs (read-only, no approval needed)

```bash
ssh openclaw 'systemctl list-timers gaffer-save-backup.timer --no-pager'
ssh openclaw 'journalctl -u gaffer-save-backup.service -n 20 --no-pager'
ssh openclaw 'sudo -n -u satisfactory ls -l /home/satisfactory/save-backups/daily /home/satisfactory/save-backups/pre-install'
```

The `NEXT` column must show a time near 04:30. After a night, `daily/` must hold a new
archive. A `Result: exit-code` line in the journal means the run failed. The journal
message names the cause.

### 3. Pre-install backup (before each bridge install)

*Needs user approval each time, because it writes to the server.* Run it **before** the
install step, and use a label that names the install.

```bash
ssh openclaw 'sudo -n -u satisfactory /opt/gaffer-testbed/backup-saves.sh pre-install before-bridge-v1'
```

The last output line is the path of the archive. Write it in the install record. The
rotation never deletes this archive. The label may use letters, digits, `.`, `_` and `-`.

### 4. Restore to a copy, and check it

*Needs user approval, because it writes a directory on the server.* This step does not
touch the live saves and does not need the server stopped.

```bash
ARCHIVE=/home/satisfactory/save-backups/pre-install/saves-<stamp>-<label>.tar
ssh openclaw "sudo -n -u satisfactory /opt/gaffer-testbed/restore-saves.sh $ARCHIVE /home/satisfactory/save-restore-test/check1"
```

The script checks the `.sha256` file first, and it refuses a non-empty destination or a
destination that overlaps the live saves. The restored files keep the modes of the live saves (`640` and `750`),
so `foreman-save-sync` can still read them through the group. It prints the `sha256` of each restored file.
Compare the copy with the live saves:

```bash
ssh openclaw 'sudo -n -u satisfactory diff -r /home/satisfactory/.config/Epic/FactoryGame/Saved/SaveGames /home/satisfactory/save-restore-test/check1/SaveGames && echo identical'
```

`identical` is expected only if the game has not saved since the backup. A difference in
the autosave files is normal when it has. Compare the hashes with the ones from the backup
if you need to be sure.

### 5. Real restore (needs user approval; stops the game)

A real restore replaces the live saves. **Stop the server first.** The game does **not**
save on shutdown (`satisfactory.service` sends `SIGINT` and says so). Everything played
since the last autosave is lost. Check the players first.

*Needs user approval.* Do step 4 first and check the copy.

```bash
ssh openclaw '
  set -e
  SAVES=/home/satisfactory/.config/Epic/FactoryGame/Saved/SaveGames
  COPY=/home/satisfactory/save-restore-test/check1/SaveGames
  sudo -n -u satisfactory /opt/gaffer-testbed/backup-saves.sh pre-install before-restore
  sudo systemctl stop satisfactory.service
  sudo -n -u satisfactory mv "$SAVES" /home/satisfactory/save-backups/replaced-by-restore-$(date -u +%Y%m%dT%H%M%SZ)
  sudo -n -u satisfactory cp -a "$COPY" "$SAVES"
  sudo systemctl start satisfactory.service
'
```

- The first command archives the current saves, so the restore can be undone.
- The start runs `steamcmd` first (the unit's `ExecStartPre`), so a game update may install.
- `foreman-save-sync` may import the restored autosave within a minute of the start.

### After a game update (the parser cannot read the new format)

The server updates the game at restart. A new save format can make the parser fail. The
backup then **fails loudly and makes no archive**. The journal says
`a save is incomplete or unreadable … the parser may not read the new format`, and the
service shows `failed`. Old archives stay. The same message appears when a save really is
damaged, so check the reason first.

1. Read the reason: `journalctl -u gaffer-save-backup.service -n 30 --no-pager`. The line
   that starts with `FAIL` names the file and the parser error.
2. Check the game: the saves load, and the game log shows no save error. If they do not,
   the save is damaged and the parser is not the cause.
3. If only the parser fails, raise the pinned version in `tools/testbed/package.json` and
   `package-lock.json` (a new change in this repository, tested with step 0), then repeat
   step 1.2a with the new files. `packages/sf-save-data` follows the same version.
4. Until then, make a manual unvalidated copy before any bridge install. It is the user's
   decision, because nothing proves that the copy is complete. Save in the game, wait until
   it is idle, then run:
   `ssh openclaw 'sudo -n -u satisfactory cp -a /home/satisfactory/.config/Epic/FactoryGame/Saved/SaveGames /home/satisfactory/save-backups/manual-unvalidated-$(date -u +%Y%m%dT%H%M%SZ)'`

### 6. Remove everything (needs user approval)

```bash
ssh openclaw '
  sudo systemctl disable --now gaffer-save-backup.timer
  sudo rm /etc/systemd/system/gaffer-save-backup.service /etc/systemd/system/gaffer-save-backup.timer
  sudo systemctl daemon-reload
  sudo rm -r /opt/gaffer-testbed   # includes the scripts and node_modules
'
```

This leaves the archives in place. Delete them only when you no longer need them:

```bash
ssh openclaw 'sudo rm -r /home/satisfactory/save-backups /home/satisfactory/save-restore-test'
```

## Settings

The scripts read these environment variables. The defaults suit the server.

| Variable | Default | Meaning |
|---|---|---|
| `GAFFER_SAVE_DIR` | `/home/satisfactory/.config/Epic/FactoryGame/Saved/SaveGames` | Directory to back up |
| `GAFFER_BACKUP_DIR` | `/home/satisfactory/save-backups` | Root of `daily/` and `pre-install/` |
| `GAFFER_KEEP_DAILY` | `14` | Number of daily archives to keep |
| `GAFFER_QUIET_SECONDS` | `15` | Second guard: a file changed more recently than this is "being written" |
| `GAFFER_MAX_WAIT_SECONDS` | `120` | Longest wait for the saves to be idle |
| `GAFFER_COPY_ATTEMPTS` | `5` | Copy retries when the saves change during a copy |
| `GAFFER_MIN_FREE_MB` | `1024` | The backup refuses to run with less free space |
| `GAFFER_UNINSPECTABLE_OK_COMMS` | empty | Process names (`/proc/<pid>/comm`, joined by `\|`) that the scan may skip when it cannot inspect them |
| `GAFFER_VALIDATOR` | empty | A program to run instead of `node validate-saves.mjs`. For tests only |
| `GAFFER_VALIDATE_SKIP` | `ServerSettings.*.sav` | Glob of file names the validator skips |
| `GAFFER_VALIDATE_RETRY_SECONDS` | `5` | Wait before a new copy when a save is not complete |
