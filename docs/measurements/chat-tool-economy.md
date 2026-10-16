# Chat tool economy — measurements

Before/after numbers for the work that cuts rounds, tool calls and input
tokens per foreman chat turn (#34, #36, #37, #38, #39). The plan is in
[`docs/superpowers/plans/2026-10-16-chat-tool-economy.md`](../superpowers/plans/2026-10-16-chat-tool-economy.md).

## Method

`npm run measure:turn -w @foreman/ff-server -- --save <file.sav> --runs 5 --scenario all`
replays fixed questions (`packages/ff-server/src/scripts/measureScenarios.ts`)
through the real chat loop, provider and a local `sf-mcp`, on a scratch
database with a fresh playthrough per run. Each cell is the median, with the
minimum and maximum in brackets.

- **Input** is tokens billed at the full input rate; **cache read** and
  **cache write** are reported separately.
- **Input-equivalent** = input + 1.25 × cache write + 0.1 × cache read
  (Anthropic's 5-minute cache prices). This is the main cost figure.
- `follow-up` measures only its second turn, after the first turn has already
  looked up the save.

Each entry records the model, max tokens, commit and save hash. The save is a
copy of the production playthrough's current save; it is not committed.

## Baseline

Not yet measured.
