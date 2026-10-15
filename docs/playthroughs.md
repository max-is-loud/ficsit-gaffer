# Playthroughs & Foremen — domain model

> **Status: shipped ([upstream #86](https://github.com/StuartMeeks/ficsit-foreman/issues/86), [upstream #61](https://github.com/StuartMeeks/ficsit-foreman/issues/61), [upstream #76](https://github.com/StuartMeeks/ficsit-foreman/issues/76)).** The domain model and data-preserving migration
> landed — the schema has `Foreman` and `Playthrough` (the former `Session`), and the
> server speaks "playthrough" with Foreman CRUD + a playthrough list (see
> [`packages/ff-server/prisma/schema.prisma`](../packages/ff-server/prisma/schema.prisma)).
> The playthrough switcher / foreman library UI ([upstream #61](https://github.com/StuartMeeks/ficsit-foreman/issues/61)) and the save subsystem — including
> per-version re-upload history ([upstream #76](https://github.com/StuartMeeks/ficsit-foreman/issues/76)) — also shipped; see [`save-subsystem.md`](./save-subsystem.md).
> Retained as the design of record. It supersedes the original framing of [upstream #61](https://github.com/StuartMeeks/ficsit-foreman/issues/61) and [upstream #76](https://github.com/StuartMeeks/ficsit-foreman/issues/76).

## Why

The unit the app is built around — today's `Session` — is really **"a playthrough of a
particular save, with a chosen foreman."** Three needs make that explicit:

- **Reusable foremen.** A pioneer should be able to define one or more foreman personas and reuse
  them across playthroughs, rather than re-describing a personality every time.
- **Named, switchable playthroughs.** A pioneer runs more than one factory/world over time and
  wants to switch between them, resuming each one's chat history *and* work orders.
- **A save per playthrough, re-uploaded over time.** A playthrough is tied to a Satisfactory save
  that is uploaded (optionally) when the playthrough is created and **re-uploaded as the pioneer
  progresses**; the save's metadata seeds the playthrough's default name and powers the save-game
  MCP's live answers.

## Entities

### Foreman *(new — reusable)*
The AI companion persona, owned by a user and attachable to many playthroughs.

| Field | Notes |
|---|---|
| `id` | |
| `userId` | owner (→ `User`) |
| `name` | e.g. "ADA", "Gruff Greg" |
| `personality` | the persona text injected into the system prompt as `{{PERSONALITY}}` |
| `createdAt` / `updatedAt` | |

The onboarding presets (the synthetic-AI/ADA option, gruff supervisor, etc.) become **starting
points** for creating a foreman rather than a per-session one-off.

### Playthrough *(rename of today's `Session`)*
One save's journey: a chosen foreman + the pioneer's play style + the conversation and its work.

| Field | Notes |
|---|---|
| `id` | |
| `userId` | owner (→ `User`) |
| `name` | freely editable; **default derived from the attached save** (else a sensible fallback) |
| `foremanId` | the attached foreman (→ `Foreman`); **one foreman per playthrough** |
| `pioneerProfile` | the pioneer's play style **for this run** — `{{PIONEER_PROFILE}}` |
| `summary` | rolling condensed record — `{{SESSION_SUMMARY}}` |
| `createdAt` / `updatedAt` | |
| relations | `messages[]`, `workOrders[]`, one current `Save` |

`pioneerProfile` lives **here, not on the user**, because play style varies per run (a relaxed
build vs a min-max sprint).

### Save *(new — mechanics owned by [upstream #76](https://github.com/StuartMeeks/ficsit-foreman/issues/76))*
The uploaded `.sav` for a playthrough.

| Field | Notes |
|---|---|
| `id` | |
| `playthroughId` | owning playthrough (→ `Playthrough`) |
| metadata | parsed world/save name, game version, uploaded-at |
| file reference | how/where the `.sav` is stored — **decided in [upstream #76](https://github.com/StuartMeeks/ficsit-foreman/issues/76)** (data-volume path vs object store) |

The model defines that a playthrough *has* a **current** save; the upload pipeline, per-version
storage and re-upload history are [upstream #76](https://github.com/StuartMeeks/ficsit-foreman/issues/76) (shipped). Re-uploading adds a new version and makes it
current; earlier versions are retained and can be re-activated or deleted.

## Relationships

```
User ──1:*── Foreman ──1:*── Playthrough ──1:1── Save (current)
 └───1:*────────────────────┘                 └──1:* Message / WorkOrder
```

- User 1–* Foreman, User 1–* Playthrough
- Foreman 1–* Playthrough (a foreman is reused across playthroughs)
- Playthrough 1–* Save (version history) with a 1–1 *current* pointer; 1–* Message / WorkOrder

**Not affected:** `AuthSession` (the Better Auth login cookie) is unrelated to a play
*session*/Playthrough — keeping the two distinct is exactly why that table was renamed
(see [architecture.md → Accounts & identity](./architecture.md)).

## Lifecycle

- **New playthrough:** pick (or create) a foreman; optionally upload a save now — if supplied, the
  default name comes from the save; otherwise name it freely and add a save later. The foreman runs
  on game-data alone until a save is attached.
- **Switch:** selecting a playthrough resumes its chat history and work orders.
- **Re-upload save:** as the pioneer progresses, they upload a fresh `.sav`; it is added as a new
  version and becomes current (earlier versions retained), refreshing the save-game MCP's view and
  reconciling collected collectibles on explore orders.
- **Rename / delete:** playthroughs are freely renamed; deleting one removes its chat + work orders.
- **Manage foremen:** a small library to create/edit/choose reusable foremen.

## Migration (there is real data)

- Each existing `Session` → a `Playthrough` (carrying its `pioneerProfile`, `summary`, messages and
  work orders).
- Extract a `Foreman` per **distinct** `personality` string per user (dedup identical personas),
  and point each playthrough's `foremanId` at it.
- Rename the Prisma model `Session` → `Playthrough`, and the `sessionId` foreign keys on
  `Message` / `WorkOrder` / `WorkOrderRevision` / `WorkOrderAuditEvent` → `playthroughId`.
- Additive and data-preserving (SQLite table rebuilds via Prisma; Postgres-portable as before).

## Delivery slices

1. **Domain model + migration** *(foundational — do first).* Schema (Foreman, Playthrough rename,
   Save table), the data migration, and the server rename `session`→`playthrough` across
   services/routes, plus Foreman CRUD and the playthrough list endpoint.
2. **Playthrough switcher + foreman library + sectioned settings + minimal save upload** *([upstream #61](https://github.com/StuartMeeks/ficsit-foreman/issues/61)).*
   List / switch / new / rename / delete playthroughs (resuming chat **and** work orders); a foreman
   library; the sectioned Settings dialog (Foreman / Pioneer / LLM / billing placeholder); **and** a
   minimal-but-functional save upload pulled forward from [upstream #76](https://github.com/StuartMeeks/ficsit-foreman/issues/76) — the new-playthrough modal optionally
   takes a `.sav` (drag-drop or file dialog), stored one-per-playthrough on a shared data volume,
   parsed for metadata (seeds the playthrough name). The save-game MCP gained an optional, host-
   injected `savePath` (per-path LRU of mtime-gated parses) so it answers about the active
   playthrough's save; the server overrides `savePath` on save-routed tool calls.
3. **Save subsystem: re-upload history + load-model refactor** *(refocused [upstream #76](https://github.com/StuartMeeks/ficsit-foreman/issues/76)).* Re-upload-over-time
   with per-version history, the save-game MCP folder/newest-per-playthrough load-model refactor,
   and extracting the save parse/normalise layer into a shared lib.

## Decisions (settled)

- Design-first; this spec is signed off before implementation.
- `pioneerProfile` lives on the **Playthrough**.
- A save is **optional** to start a playthrough.
- Minimal upload + storage + the per-call `savePath` MCP mechanism landed in **[upstream #61](https://github.com/StuartMeeks/ficsit-foreman/issues/61)**; the
  load-model refactor + per-version re-upload history landed in **[upstream #76](https://github.com/StuartMeeks/ficsit-foreman/issues/76)**.
- Foremen are seeded by **deduping** existing personalities on migration; new users get a foreman
  from their chosen onboarding preset.
