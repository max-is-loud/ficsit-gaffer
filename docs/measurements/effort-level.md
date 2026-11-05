# Effort level — `high` against `medium`

Measured on 5 November 2026 for Gaffer issue #43. The question: which
`LLM_EFFORT` level should the foreman use by default?

## Result

**Keep `LLM_EFFORT` unset by default.** On Claude Sonnet 5.5, unset sends no
effort, and Anthropic's documented provider default, `high`, applies.

`high` gave the better work orders in this sample, and `medium` costs about
half as much. Across three runs of `iron-near-me` for each level:

- `medium` took a median of **$0.103** and **40.5 s** for a turn. `high` took
  **$0.209** and **93.0 s**. `medium` used about half of the cost, 44% of the
  time, 54% of the tool calls and 49% of the output tokens.
- `high` gave the better-prepared work orders. All three `high` runs issued an
  order on the first attempt, each with a bootstrap step for the build cost,
  and two used the pioneer's inventory. The orders of both levels are similar
  in scope (see [Work-order quality](#work-order-quality)). One `medium` run issued no order. The
  other two were rejected once and issued on a retry, and neither has a
  bootstrap step.
- `high` is not error-free. One `high` run said that the pioneer holds no
  Reinforced Iron Plate (the pioneer holds 35), and built its plan on that
  (see [Work-order quality](#work-order-quality)).

Why unset and not an explicit `high`:

- An explicit `LLM_EFFORT=high` stops start-up for a configured model that has
  no effort setting, for example `claude-haiku-4-5`. `resolveServerConfig` calls
  `assertEffortSupported`, which refuses a level that the model's row in the
  support table does not list (`packages/ff-server/src/llm/effort.ts`). Unset
  never refuses.
- The default model, `claude-sonnet-4-6`, and Sonnet 5.5 both accept `high`.
  Unset keeps the request the same as before the setting existed.

`medium` stays a documented choice for a cost-sensitive deployment. Its
trade-off, from this sample: about half the cost and time, against thinner
work orders that sometimes need a retry or a follow-up turn.

The sample is small (three runs for each level, one scenario). The limits
below say what it does not show.

## Results

Cells show median (minimum–maximum), three samples for each level. The
scenario is `iron-near-me`, and every turn ended with `end_turn`.

| Level    | Rounds  | Tool calls | Seconds           | USD per turn        |
| -------- | ------- | ---------- | ----------------- | ------------------- |
| `medium` | 5 (2–6) | 7 (4–7)    | 40.5 (17.4–40.7)  | 0.103 (0.103–0.104) |
| `high`   | 5 (5–6) | 13 (11–15) | 93.0 (72.1–106.2) | 0.209 (0.181–0.222) |

### Token breakdown

| Level    | Uncached input | Cache read                | Cache write            | Output                |
| -------- | -------------- | ------------------------- | ---------------------- | --------------------- |
| `medium` | 12 (6–14)      | 155,518 (27,236–182,719)  | 10,423 (9,733–31,999)  | 5,995 (2,019–6,295)   |
| `high`   | 12 (12–14)     | 183,694 (175,078–212,421) | 26,060 (24,921–26,764) | 12,256 (9,544–14,176) |

### Each run

| Level          | Run | Rounds | Tool calls | Uncached | Cache read | Cache write | Output | Seconds | USD        |
| -------------- | --- | ------ | ---------- | -------- | ---------- | ----------- | ------ | ------- | ---------- |
| `medium`       | 1   | 2      | 4          | 6        | 27,236     | 31,999      | 2,019  | 17.4    | 0.1029     |
| `medium`       | 2   | 6      | 7          | 14       | 182,719    | 10,423      | 5,995  | 40.5    | 0.1043     |
| `medium`       | 3   | 5      | 7          | 12       | 155,518    | 9,733       | 6,295  | 40.7    | 0.1029     |
| `medium` total |     |        |            |          |            |             |        |         | **0.3101** |
| `high`         | 1   | 5      | 15         | 12       | 183,694    | 26,764      | 9,544  | 72.1    | 0.1807     |
| `high`         | 2   | 5      | 11         | 12       | 175,078    | 24,921      | 14,176 | 106.2   | 0.2216     |
| `high`         | 3   | 6      | 13         | 14       | 212,421    | 26,060      | 12,256 | 93.0    | 0.2090     |
| `high` total   |     |        |            |          |            |             |        |         | **0.6113** |

The measurement cost **$0.9214** in total (about $0.92).

Caution about the `medium` row: run 1 is not comparable to the others. It
issued no work order, so it did less work (4 calls, 2 rounds, 17.4 s), but it
cost about the same as runs 2 and 3. Cache writes make up $0.080 of its $0.103,
against $0.026 in run 2 and $0.024 in run 3. The per-call usage
([usage.jsonl](effort-level/usage.jsonl)) shows that its first call read
nothing from the prompt cache and wrote 27,236 tokens to it, so run 1 paid for
the cold start of the series. The median `medium` cost
of $0.103 is therefore the cost of turns that issued an order less reliably
than the `high` turns did.

## Work-order quality

The traces hold each turn's tool calls, the answer and the work orders. The
points below were checked against them. "Run n" is the run number in the
`effort-level/*-trace.jsonl` files.

**1. `medium` run 1 issued no work order.** Its trace has `workOrders: []` and
four tool calls, with no `create_work_order`. The answer ends: "I haven't
issued a work order yet. Say the word and I'll issue the full order…". The
user must ask again, which costs another turn. The other five runs all issued
an order.

**2. In `medium` runs 2 and 3, the first `create_work_order` call failed.**
Both calls carried an `expectedOutputs` entry
`{"kind":"unlock","schematic":"Space Elevator Phase 1"}`. The server returned
"Work order not created: these names don't match the game data…" and
suggested "Confusing Creature, Personnel Elevator". Each run then called
`list_schematics` (search "Project Assembly", which returned an empty list) and
issued the order on the second attempt. Run 2 retried in round 5 and run 3 in
round 4, so the failure cost two extra rounds in each run. This is the
same confusion that [chat-tool-economy.md](chat-tool-economy.md) records: a
Space Elevator phase is not a schematic. No `high` run made the mistake. All three
issued on the first attempt. `high` run 2 revised its order once afterwards
(`revise_work_order`, revision 2) to correct "the bootstrap Reinforced Iron
Plate arithmetic in the notes". A single sample cannot say whether `high`
avoids the schematic error by reasoning or by chance.

**3. The `high` orders start with a bootstrap step. The `medium` orders do
not.** Step 0 of each `high` order:

| Run | Step 0 title                               | What it covers                                                                                   |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 1   | "Bootstrap the RIP assemblers"             | Build the 3 Assemblers first, hand-feed them from inventory; needs about 50 RIP, holds 35.       |
| 2   | "Bootstrap parts and overclock the miners" | Dismantle the two Rotor Assemblers for a 16 RIP refund; add Power Shards to the existing miners. |
| 3   | "Prep: handcraft Reinforced Iron Plate"    | Craft about 60 RIP at the Crafting Bench from 553 plates and 860 screws; no buildables.          |

Step 0 of both `medium` orders is a mining step ("Mine the NW normal iron
nodes", "Mine the ore"), and neither order mentions the build cost of the
Reinforced Iron Plate. `medium` run 1 mentions it in its prose answer ("build
the Assemblers first and bootstrap from there"), but issued no order.
No `medium` run called `get_player_state`. `high` runs 1 and 3 did, and their
orders use the result: "you hold 35", "553 plates, 860 screws and 35
Reinforced Iron Plate".

`high` run 2 is the exception. It did **not** call `get_player_state`. Its
step 0 says "You have no Reinforced Iron Plate in
stock", and its answer says "You have 0 RIP". That is wrong: the pioneer
carries 35 (`get_player_state` in runs 1 and 3). Run 2 then recommends
dismantling two Rotor Assemblers for a 16 RIP refund, which the inventory made
unnecessary. This is a real quality defect in a `high` run, and it comes from
a missing tool call rather than from the effort level alone.

**4. `high` runs found more of the state of the factory.** `high` runs 1 and 2
called `find_bottlenecks` (7 machines starved, including the Rotor Assembler
at (-339, 2524) "starved of Iron Rod: no Iron Rod reaching it"). Both use it:
run 1 says "That's why your Rotor assemblers are starved of Iron Rod"; run 2
writes "The screw line is overproducing: both screw containers are filling,
and the rotor assemblers are starved of rods", and its notes say "Do not
expand the screw line. It is already overproducing." Run 3 did not call
`find_bottlenecks`. No `medium` run called it, and none mentions starved
machines. So: two of three `high` runs found the rod shortage, and one of
them (run 2) also stated the screw over-production. The medium answers do
use the save snapshot well (87 Rotors, about 12,000 Screws, 514 MW of
headroom), so they were not ungrounded. They just found less.

Other differences seen in the traces:

- The orders are similar in scope, so the `high` orders are not better because
  they build more. `high` run 1 is the only order that builds its own Iron Rod
  and Screw production, and the only one without Smart Plating: its notes leave
  Smart Plating to the "Next order after this one". The other four orders
  (`medium` runs 2 and 3, `high` runs 2 and 3) include Smart Plating and take
  screws from the stock of about 12,000 or from the existing screw line. The
  difference that this report counts is the bootstrap step and the use of the
  inventory.
- `high` runs made more detail calls: `get_milestones`, `get_power`,
  `get_building`, `get_storage`, `describe_location` and `get_nearby` appear
  only in `high` runs. The `medium` runs stayed with the first-round batch
  (`nearest_resource_nodes`, `get_production`, `check_material_coverage`, and
  one of `get_recipe`, `recipes_for` or `full_production_line`).
- Both levels advised checking that the Biomass Burners are fuelled. Five of
  the six runs proposed the same site, the three normal iron nodes to the
  north-west. `high` run 2 chose instead to put Power Shards in the existing
  miners and add a smelter bank.
- Every order lists buildables with counts. The `high` orders in runs 2 and 3
  add the coordinates of the containers to take items from, and run 3 adds the
  hand-crafting quantities. This is a judgement from reading the orders, not a
  measured score.

## Limits

- **Three samples for each level, one scenario.** Medians and ranges are
  descriptive, not significance tests. The `medium` run 1 outlier (no order,
  17.4 s) moves the `medium` minimums.
- **One scenario.** `iron-near-me` is a first turn that plans a new factory.
  The `follow-up` scenario was left out so that the spend stayed inside the
  agreed approval (about $1–2). Follow-up turns are cheaper and may not
  show the same gap.
- **Prompt caches were not cleared between runs.** The per-call usage in
  [usage.jsonl](effort-level/usage.jsonl) shows the cache state at the start
  of each turn. Only `medium` run 1 started cold: its first call read 0 tokens
  from the cache and wrote 27,236. The first call of every other run read
  25,513 or 27,236 cached tokens. The `medium` runs came first, so the first
  level paid for the cold start, and the order of the two levels is a
  confound.
- **Explicit levels only.** The run set `medium` and `high` explicitly. It did
  not measure the unset path. That `high` is the provider default for unset is
  Anthropic's documented behaviour, not something these runs show.
- **Model.** Sonnet 5.5 was measured. The shipped default model is
  `claude-sonnet-4-6`, which was not measured.
- **Quality was read by hand** from the traces, not scored. The judgement that
  `high` gives the better orders rests on three `high` orders and two `medium`
  orders (`medium` run 1 issued none).

## Method and provenance

- Commit `3101974`, built with `npm ci` and `npm run build`.
- sf-mcp: a fresh process from `packages/sf-mcp` (`node dist/index.js`) with
  `MCP_TRANSPORT=http`, `SAVE_DATA_DIR=/tmp`, listening on `127.0.0.1:18723`.
  Listener PID 120535 was checked with `ss` and `ps`. `/health` reported game
  data `1.2.3.1`.
- Save: `production.sav`, SHA-256
  `d5b7fcb7aa811e25b56f4c80c71fa0a1f2d706a8f97db66e48d2bb008882ee11`. It is the
  save of [chat-tool-economy.md](chat-tool-economy.md). The save is not
  committed.
- Model `claude-sonnet-5-5`, max tokens 16,000, provider Anthropic.
  `LLM_EFFORT=medium` for the first level, then `LLM_EFFORT=high`. The summary
  line of each log confirms the effort level.
- Scenario `iron-near-me` only, 3 runs for each level: the 3 `medium` runs, then
  the 3 `high` runs, on 5 November 2026 from 21:05:42 UTC. The question is
  "What's the next iron factory I should build near me?"
- The measurement CLI gives each run a fresh scratch database playthrough and
  an uploaded copy of the same save, as in the earlier measurements.
- Duration is `runChat` time. It excludes upload, save-summary construction and
  database preparation.
- The records are the unchanged output of the measurement CLI with `--out` and
  `--trace`. The trace holds each turn's tool calls with arguments and capped
  results, the answer and the work orders.

## Cost calculation

USD estimates use [Anthropic's pricing table](https://platform.claude.com/docs/en/about-claude/pricing),
checked on 5 November 2026: per million tokens, $2 input, $2.50 five-minute
cache write, $0.10 cache read and $10 output. These are token-based estimates,
not an invoice reconciliation.

`USD = (2 × input + 2.5 × cacheWrite + 0.10 × cacheRead + 10 × output) / 1,000,000`

The tables recalculate the cost from the four token counts in `usage`. They do
not use the `inputEquivalent` field of the records.

## Repeating the measurement

Start a fresh MCP process from the commit on an unused port, with
`MCP_TRANSPORT=http`, `MCP_HTTP_HOST=127.0.0.1`, `MCP_HTTP_PORT=18723` and
`SAVE_DATA_DIR=/tmp`. Confirm its listener PID before the run. A "Listening"
log line is not enough if an earlier listener survived.

With the provider key already in the environment, run from the repository root
once for each level. Use a new output file for each run, because the CLI
appends records. The model calls incur API cost (about $0.31 for `medium` and
$0.61 for `high` here).

```sh
LLM_EFFORT=medium MCP_URL=http://127.0.0.1:18723/mcp npm run measure:turn -w @foreman/ff-server -- --save /path/to/production.sav --scenario iron-near-me --runs 3 --model claude-sonnet-5-5 --out /path/to/effort-medium.jsonl --trace /path/to/effort-medium-trace.jsonl
LLM_EFFORT=high MCP_URL=http://127.0.0.1:18723/mcp npm run measure:turn -w @foreman/ff-server -- --save /path/to/production.sav --scenario iron-near-me --runs 3 --model claude-sonnet-5-5 --out /path/to/effort-high.jsonl --trace /path/to/effort-high-trace.jsonl
```

## Raw records

- [medium](effort-level/medium.jsonl) — one metrics record for each measured turn
- [medium, full trace](effort-level/medium-trace.jsonl) — tool calls with arguments and capped results, answers and work orders
- [high](effort-level/high.jsonl) — one metrics record for each measured turn
- [high, full trace](effort-level/high-trace.jsonl) — tool calls with arguments and capped results, answers and work orders
- [per-call usage](effort-level/usage.jsonl) — the token usage of each model call, taken from the `Anthropic usage` lines of the CLI output (the logs are not committed, because they hold local paths). For each run, the calls add up to the totals in the metrics records.
