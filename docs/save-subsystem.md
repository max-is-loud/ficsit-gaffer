# Save Subsystem — design & roadmap ([upstream #76](https://github.com/StuartMeeks/ficsit-foreman/issues/76))

> **Status: shipped.** All three PRs below (build-version awareness, re-upload
> history, same-game recognition) have merged. This document is retained as the
> design of record.

The minimal save upload shipped first in [upstream #61](https://github.com/StuartMeeks/ficsit-foreman/issues/61) (PR [upstream #97](https://github.com/StuartMeeks/ficsit-foreman/issues/97)). Saves are now stored
**per-version** on a shared volume (`${SAVE_DATA_DIR}/<playthroughId>/<saveId>.sav`),
with a separate "current" pointer per playthrough, and metadata parsed on upload
via the save-game MCP's `describe_save` tool. The save-game MCP is
per-playthrough-aware (every tool takes an optional `savePath`; the server injects
the active playthrough's path; an LRU of mtime-gated per-path stores parses once
per upload).

This document is the design of record for the **richer save-driven UX** referenced
in [`product.md`](./product.md) and [`playthroughs.md`](./playthroughs.md). It was
delivered as a sequence of independent PRs so each stayed small and reviewable.

## Goals

1. **Build-version awareness** — warn when an uploaded save's game build differs
   from the game-data the foreman reasons with (recipes/tools may not match).
2. **Re-upload history** — keep prior uploads per playthrough, with a clear
   "current" save and the ability to re-activate or delete versions.
3. **"Same game" recognition** — when an uploaded save matches a playthrough
   already present, offer to update it rather than always creating a new
   playthrough; confirm on ambiguity, never silently overwrite.

## Identity & the risk surface

A Satisfactory save carries **no stable world GUID**. The only identity signal is
the (user-editable) header: `sessionName`, `mapName`, `buildVersion` (the
Satisfactory changelist integer, e.g. `495413`), `saveVersion` (save-format
version), and `playDurationSeconds`. Matching is therefore heuristic — the design
leans on **confirm-on-ambiguity UX** rather than over-tuning a fingerprint.

The bundled game-data channel records both `gameVersion` (`"1.2.3.1"`) and
`build` (`495413`) in `meta.json`. The save's `buildVersion` is exactly that
`build` integer, so an exact `save.buildVersion === gameData.build` comparison is
possible once the game-data MCP exposes its build number.

## Shared API shape

`POST /api/playthroughs/:playthroughId/save` returns
`{ save: Save, warnings: SaveWarning[], match?: SaveMatch }` (additive over the
bare `Save` it returns today). One shape carries the build-mismatch warning
(PR1), the play-time-regression warning (PR2), and same-game ambiguity (PR3)
without further breaking changes.

```ts
type SaveWarning = {
  kind: 'build_mismatch' | 'playtime_regressed';
  message: string;
  // kind-specific detail, e.g. { saveBuild, gameDataBuild }
};
```

---

## PR roadmap

### PR1 — Save identity + game-version warning *(first slice)*
Self-contained; no schema-multiplicity change, no file migration. The hard
prerequisite for PR3.

- **Expose the game-data build.** `sf-game-data` carries `build?: number` from
  `meta.json` onto `GameData` (sibling to the existing `version`/`gameVersion`).
  `sf-mcp` includes `build` in `/health` + the graph context. The server's
  `McpGateway` exposes `gameBuild: number | undefined` beside `gameVersion`.
- **Richer `describe_save`.** Add discrete `sessionName`, `mapName`,
  `buildVersion`, `saveVersion` to `SaveState` (they're already in the parsed
  `RawHeader`; `normalise` currently collapses them into a humanised `version`
  string). `describe_save` returns the full identity set.
- **Persist identity on `Save`** (additive nullable columns; still 1–1) so the UI
  renders without re-parsing.
- **Warning.** On upload compare `save.buildVersion` vs `mcp.gameBuild`: equal →
  none; differ → `build_mismatch`; either unknown → none (no false positives).
- **Client.** Upload returns `{ save, warnings }`; a dismissible banner in the
  header surfaces a mismatch. The foreman does **not** need a separate signal in
  v1 (its save tools already read the actual save); surfacing it into the system
  prompt is a later option.

### PR2 — Re-upload history
- **Model:** `Save` 1→many + `Playthrough.currentSaveId` (named relations to
  disambiguate `currentSave` vs the `saves[]` history). Chosen over a separate
  `SaveVersion` table because `Save` already holds exactly the per-version
  metadata.
- **Storage:** `${SAVE_DATA_DIR}/<playthroughId>/<saveId>.sav`. An idempotent
  startup reconcile migrates the existing single-file layout and sets
  `currentSaveId`. Stays under `SAVE_DATA_DIR` so the MCP registry's `isWithin`
  guard still permits the injected `savePath`.
- `getSavePath(playthroughId)` resolves `currentSaveId` — the current save always
  feeds the MCP.
- **Retention:** keep last N per playthrough (config); never prune current.
- **Play-time-regression guard:** if a re-upload's `playDurationSeconds` is
  meaningfully lower than the current save's, add a `playtime_regressed` warning —
  warn, don't block.
- **Routes:** `GET /:id/saves`, `POST /:id/saves/:saveId/activate`,
  `DELETE /:id/saves/:saveId` (deleting the current save auto-promotes the newest
  remaining, else clears). **UI:** a save-timeline drawer reached from the
  playthrough switcher (reusing `DrawerDock`), not Settings.

### PR3 — "Same game" recognition
- **Match key:** `sessionName` + `mapName`, scoped to the user's own playthroughs'
  current saves.
- **`POST /api/saves/preview`** (multipart, user-scoped): parse identity only
  (quarantine temp file under `SAVE_DATA_DIR`, reuse `describe_save`, delete in a
  `finally`), return `{ identity, matches, warnings }`. The client then commits
  via the existing per-playthrough upload (append a version) or create-new.
- **UX:** no match → proceed as today; one confident match → offer "update
  playthrough X" (default) vs "create new"; ambiguous (multiple matches / name
  collision / play-time regressed / different `mapName`) → confirm modal
  enumerating candidates. Never silently overwrite.

---

## Considered & deferred — live-watch folder mode

**Decision: out of scope for [upstream #76](https://github.com/StuartMeeks/ficsit-foreman/issues/76).** The idea was a power-user mode where the
save-game MCP points at a live Satisfactory SaveGames *folder* and serves the
newest save per session. It's deferred because:

- The product flow is **in-app upload**: each playthrough has one managed file
  (`<playthroughId>.sav`) the server overwrites on re-upload — there is no
  staleness problem in the managed flow, so nothing in the product needs it.
- It only helps a narrow niche — the MCP running on the gaming machine pointed
  straight at the live folder — which contradicts the actual deployment: the app
  runs on a VM that **cannot see the Windows game files** (saves are copied over
  manually; see `AGENTS.md`).
- The cost (folder scanning, filename parsing, a folder-backed store, multi-base
  path validation, a session-listing tool) is disproportionate to that value.

**The underlying finding, recorded so it isn't re-derived:** Satisfactory does
**not** rewrite one save file — it writes a **new timestamped file per save**,
grouped by session name: `<SessionName>_<timestamp>.sav`, plus rotating
`<SessionName>_autosave_0/1/2.sav` (a real folder held ~286 `.sav` across ~9
playthroughs). So the legacy single-file `SAVE_FILE_PATH` (stdio/dev convenience)
pins a stale snapshot if pointed at a folder that keeps writing new files. If this
is ever revisited: trust the filename prefix for session grouping, order by mtime
(filename timestamp as tie-break), and only ever parse the chosen-newest file
(never the whole folder).
