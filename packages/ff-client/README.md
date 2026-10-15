# @foreman/ff-client

The FICSIT Foreman web client — a React + TypeScript + Vite single-page app. It
runs as the `ff-client` service in the `foreman` Docker Compose project, served by
nginx, which reverse-proxies `/api` to the backend so the browser uses a single
origin (no CORS).

> **Phase 3 status: in progress.** Account sign-in/up, foreman chat (playthrough +
> streaming), the active **work-order cockpit** (built to the
> [Work Orders v2](../../docs/work-orders.md) model), and onboarding/settings are in
> place. The visual language lives in [`design-tokens.css`](./design-tokens.css)
> (the canonical palette + type), with Barlow / Barlow Condensed / IBM Plex Mono
> self-hosted (no CDN).

## What works

- **Accounts** — an email + password sign-in / sign-up gate stands before onboarding.
  Login sessions are HttpOnly cookies (the client stores no auth token); on first
  sign-in the browser's existing anonymous playthrough is claimed for the new account.
  Sign-out lives in the header. The BYO LLM key stays in the browser as before.
- **Playthroughs** — a header dropdown switches between playthroughs (resuming chat
  history **and** work orders), and creates / renames / deletes them. A new playthrough
  is made from a lightweight modal: name it, pick or create a foreman, optionally drop
  in a `.sav` (drag-drop or file dialog — its name seeds the playthrough), and set a
  pioneer profile.
- **Foreman chat** — streams the foreman's reply token-by-token over SSE, and shows
  tool calls (game-data + work-order tools) as inline chips. Past turns re-hydrate when
  a playthrough is opened.
- **Work-order cockpit** — the active order rendered to the v2 model, in a tabbed
  panel (Order / Revisions / Audit): state badge, plan-revised banner with a
  field-level diff + acknowledge, blocked banner, foreman completion suggestion. A
  **build** order shows build-step checklists with per-buildable built counters, a
  megawatt power hero, and collapsible recipes / resource nodes / two-group nearby
  collectibles / child orders; an **explore** order shows its ordered waypoint
  route with per-collectible collected toggles. The pioneer starts, pauses, ticks
  items, sets counts, marks collectibles, reverts, and **completes** (completion is
  Pioneer-only; the foreman only proposes) — all against the work-order REST API,
  updating live over SSE. A history list sits beneath the active order.
- **Settings** — a sectioned dialog: **Foremen** (a library to create / edit / delete
  reusable personas and choose which one this playthrough uses), **Pioneer** (this
  playthrough's profile), **LLM** (provider / model / key, kept only in the browser and
  sent per request — needed unless the server has its own key), and a **Billing**
  placeholder.

## Run

### With Docker Compose (recommended)

From the repo root, the whole stack builds and runs together:

```bash
docker compose up -d --build
```

Then open **http://localhost:8725**. (Backend on `:8724`, MCP on `:8723`.)

### Bare metal (dev)

```bash
# from the repo root
npm install
npm run dev:web        # Vite dev server on http://localhost:5173
```

The dev server proxies `/api` to `http://localhost:8724` (override with
`VITE_API_TARGET`), so run the backend (`npm run dev:server`) and MCP server
alongside it.

## Notes / next steps

- **Fonts** are self-hosted via `@fontsource` (Barlow, Barlow Condensed, IBM Plex
  Mono), bundled same-origin so no CDN is needed (CSP-safe).
- Remaining Phase-3 work was tracked in the
  [upstream issue tracker](https://github.com/StuartMeeks/ficsit-foreman/issues): a navigable
  Work History drawer, and driving the foreman propose-completion / chat flow
  end-to-end against a live backend.
