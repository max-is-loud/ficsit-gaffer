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
| `test-save-backup.sh` | Tests the two scripts on any machine, with a fake save tree. No server is involved. |

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

The game writes autosaves while it runs. A copy of a half-written file is useless. The
script uses "wait, copy, verify":

1. **Wait for a quiet moment.** It waits until no file has changed in the last 15 seconds
   (`GAFFER_QUIET_SECONDS`). It gives up after 120 seconds (`GAFFER_MAX_WAIT_SECONDS`).
2. **Copy** the whole directory to a private staging directory with `cp -a`.
3. **Verify.** The script accepts the copy only if both conditions are true:
   - no file in the source changed after the copy began, and
   - `diff -r` shows that every copied file equals its source. This also catches a file that
     the game created or renamed during the copy.
4. **Retry** the copy up to 5 times (`GAFFER_COPY_ATTEMPTS`). If the saves never become
   stable, the script exits with an error and makes **no archive**. It does not keep a doubtful copy.
5. Only then does it write the `.tar` and a `.sha256` file. It builds the `.tar` in the
   staging directory and renames it into place, so an archive is complete or absent.

A lock file stops the timer and a manual run from running at the same time. The script
also refuses to start if less than 1 GiB is free (`GAFFER_MIN_FREE_MB`).

An archive holds what is **on disk**. It does not hold the state of the running game. The
game does not save on shutdown. For a fresh point, save in the game first (or wait for an
autosave), then run the backup.

### The systemd units

The service copies the hardening of `satisfactory.service`: `NoNewPrivileges`,
`ProtectSystem=strict`, `PrivateTmp`, `PrivateDevices`, the `Protect*` and `Restrict*`
options, an empty `CapabilityBoundingSet`, and a `MemoryMax`. It differs in three ways:

- `ProtectHome=read-only` with `ReadWritePaths=/home/satisfactory/save-backups`. The backup
  needs to read the saves under `/home` but write in one directory only. The game unit
  cannot use `ProtectHome=true`. This unit does not need to write in the home, so
  read-only is correct.
- `RestrictAddressFamilies=AF_UNIX`. The job does no network I/O. It needs only the
  journal socket.
- `Nice=10` and `IOSchedulingClass=idle`, so the backup does not slow the game.

`systemd-analyze security --offline` rates the service **2.9 OK** (checked on this machine).

## Runbook

All commands run from a checkout of this repository on your machine, in this folder
(`tools/testbed/`), unless the text says otherwise. `openclaw` is the SSH alias.

### 0. Test the scripts locally (no approval needed)

```bash
tools/testbed/test-save-backup.sh
```

The script must print `all 17 checks passed`. It uses only a temporary directory.

### 1. Install (needs user approval, every step)

**1.1 Copy the files to `/tmp` on the server.** *Needs user approval.*

```bash
scp backup-saves.sh restore-saves.sh systemd/gaffer-save-backup.service \
  systemd/gaffer-save-backup.timer openclaw:/tmp/
```

**1.2 Install the scripts, the units and the backup directory.** *Needs user approval.*

```bash
ssh openclaw '
  set -e
  sudo install -d -m 0755 -o root -g root /opt/gaffer-testbed
  sudo install -m 0755 -o root -g root /tmp/backup-saves.sh /tmp/restore-saves.sh /opt/gaffer-testbed/
  sudo install -m 0644 -o root -g root /tmp/gaffer-save-backup.service /tmp/gaffer-save-backup.timer /etc/systemd/system/
  sudo install -d -m 0700 -o satisfactory -g satisfactory /home/satisfactory/save-backups
  rm /tmp/backup-saves.sh /tmp/restore-saves.sh /tmp/gaffer-save-backup.service /tmp/gaffer-save-backup.timer
  sudo systemctl daemon-reload
  systemd-analyze verify /etc/systemd/system/gaffer-save-backup.service /etc/systemd/system/gaffer-save-backup.timer
'
```

`systemd-analyze verify` must print nothing.

**1.3 Run the first backup by hand.** *Needs user approval.* It writes one archive and
changes nothing else.

```bash
ssh openclaw 'sudo systemctl start gaffer-save-backup.service; systemctl status gaffer-save-backup.service --no-pager; sudo -n -u satisfactory ls -l /home/satisfactory/save-backups/daily'
```

The status must show `status=0/SUCCESS`. The listing must show one `.tar` and one
`.tar.sha256`. If the unit fails, do not enable the timer. Read
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

### 6. Remove everything (needs user approval)

```bash
ssh openclaw '
  sudo systemctl disable --now gaffer-save-backup.timer
  sudo rm /etc/systemd/system/gaffer-save-backup.service /etc/systemd/system/gaffer-save-backup.timer
  sudo systemctl daemon-reload
  sudo rm -r /opt/gaffer-testbed
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
| `GAFFER_QUIET_SECONDS` | `15` | A file changed more recently than this is "being written" |
| `GAFFER_MAX_WAIT_SECONDS` | `120` | Longest wait for a quiet moment |
| `GAFFER_COPY_ATTEMPTS` | `5` | Copy retries when the saves change during a copy |
| `GAFFER_MIN_FREE_MB` | `1024` | The backup refuses to run with less free space |
