# Chat tool economy — measurements

## Traced follow-up run, 16 October 2026

To tell necessary detail queries from redundant re-fetches, the CLI gained
`--trace` (`bd75764`): per scenario turn, each tool call's round, arguments,
error flag and result (capped at 4,000 characters), the context blocks sent,
the final answer and the work orders afterwards. It was first checked offline
against the real MCP and save with a scripted provider (no model calls), then
used for one paid `follow-up` × 3 run. Each run's iron preparation turn is
traced as well, so the run covers both scenarios. It cost about **$1.06**, and
all six turns ended with `end_turn`. Setup otherwise matches the corrected
stage: commit `bd75764` (prompt unchanged from `4e2cfb8`), a freshly built
sf-mcp on port 18723 (listener PID verified as the launched process; batched
`names`/`items`/`resources` schemas confirmed), and the same save and model.

| Turn | Rounds | Tool calls | USD | Seconds |
|---|---|---|---|---|
| iron (preparation, unmeasured) | 7 (5–7) | 14 (14–17) | 0.261 (0.255–0.295) | 106.8 (61.9–118.6) |
| copper (measured) | 3 (3–6) | 8 (6–13) | 0.065 (0.062–0.118) | 31.9 (28.8–40.4) |

The iron turns here are preparation turns, not `iron-near-me` records, so
they are not added to the results table below.

### What the trace shows

- **Follow-ups make no save re-fetches.** The three copper turns made no
  `get_player_state`, `get_milestones`, `get_unlocked_recipes` or `get_power`
  calls. They made seven `get_production` calls, all narrowed by `item`
  (Copper Ore × 3, Copper Ingot × 2, Wire × 2), and one `get_storage` call
  sorted by the pioneer's location. Each asks for detail the snapshot omits:
  per-machine lists with locations, or containers in distance order. The
  answers use it ("one Mk.1 miner on the normal node at (-333, 2316) feeds
  2 smelters"). Under the prompt's own rule these are legitimate detail
  calls. The literal zero-call target for the six save tools is still not met.
- **First turns still fetch the unlock state.** Every iron turn called
  `get_milestones` (9,248 characters) and `get_unlocked_recipes`
  (16,733 characters) with no arguments. The snapshot gives the highest tier
  and recipe counts, but not which recipes or buildings are unlocked; the
  answers depend on that ("Steel isn't unlocked yet"). This is a gap in the
  snapshot's contents, not a redundant call, and the largest remaining
  first-turn payload. One iron turn of three also called `get_player_state`,
  which repeats the snapshot's position: the only clear redundancy observed.
- **Rounds are dependency chains plus late exact-name lookups.** Iron turns
  ran 4–6 tool rounds. Every one called `list_buildings` for conveyors (and
  often power poles) in round 3 or 4, just before `create_work_order`. That is
  static game data, so it could have been requested in round 1. Two calls
  failed on the model's input: `get_recipe` given building names, and
  `get_schematic` given "Project Assembly Phase 2".
- **Answer quality.** Each iron turn issued one Reinforced Iron Plate build
  order (one revised once), grounded in the save. Copper turns sensibly
  advised against a new copper factory; run 1 issued a small Copper Sheet
  order. Two pre-existing problems surfaced, neither caused by this branch:
  - In run 2 the copper answer told the pioneer to treat WO-001 as "not
    issued", although it had been created. Persisted history is text-only and
    no context lists existing work orders, so a follow-up turn cannot verify
    its own earlier order. This is the same on `main`.
  - A turn's text from every round is concatenated without a separator
    ("…from copper.**Don't build…"). The accumulation is unchanged from `main`.

No code change is made for these findings: the save tools' remaining calls are
detail queries, and the single redundant `get_player_state` call is one
observation. Candidate follow-ups are listing unlocked buildings in the
snapshot, steering static exact-name lookups into the first round, and giving
follow-up turns a list of existing work orders.

## Recovered run, 16 October 2026

The interrupted Claude session's background benchmark completed at 12:18
America/Toronto. All 18 measured turns finished with `end_turn`. However, the
original **final** stage omitted the save snapshot: the CLI called `runChat`
directly without the web route's `buildTurnContext`. It therefore did not test
#36. The corrected stage uses that production context builder, shares the
summary cache across the two scenario turns, rejects missing snapshots before
calling the model, and records the context character count.

A second limitation affects the historical baseline: the stage runner failed
to replace the MCP listener. PID 38312 started at 11:23 and was still serving
port 8723 after all three stages, exposing `names` lookups and `get_save_summary`.
The results do **not** isolate the effect of introducing batched MCP schemas.
The corrected run uses a freshly launched final-build MCP on dedicated port
18723. Historical results remain useful observations, but are not a clean
before/after benchmark of the entire stack.

## Findings and remaining work

- **Round-trip target not met for iron planning.** The corrected median is
  8 rounds (6–9), against the target of at most 4 and historical baseline 7.
  Median tool calls are 19 versus 20. This sample does not demonstrate an
  improvement in first-turn round trips or latency.
- **Input-cost target met numerically, with the baseline caveat above.** Using
  Sonnet 5.5's 0.05× cache-read weight, median iron input-equivalent falls from
  187,507 to 79,535 (42.4% of baseline). Median total cost falls from $0.541 to
  $0.344. The cache-only stage was already $0.313: the corrected snapshot stage
  does not show an additional first-turn cost benefit in this small sample.
- **Follow-up behaviour improves.** Median rounds fall from 5 to 4, calls from
  12 to 9, and total cost from $0.198 to $0.075. Against the original final run
  without snapshot context, calls fall from 13 to 9 and cost from $0.137 to
  $0.075. Ranges overlap, so these observations need a larger controlled sample
  before claiming a reliable effect size.
- **The zero-save-refetch target is not met.** Corrected follow-ups make no
  player-state, power or unlocked-recipe calls, but still make six production,
  one milestone and one storage call across the three samples. First-turn
  production calls actually increase. The retained metrics contain names and
  sizes, not arguments or final answers, so they cannot distinguish necessary
  detail queries from redundant requests. The traced run above resolves this
  for its follow-ups: every remaining save-tool call asked for item- or
  location-scoped detail the snapshot omits.
- Tool arguments and answer/work-order outputs are now traced (see above).
  Effort tuning remains separate (#43).
  A clean batching comparison needs pinned MCP processes per stage. No issue is
  considered fully validated or closed by this report; PR integration and
  answer-quality review remain outstanding.

## Method and provenance

- Model: `anthropic/claude-sonnet-5-5`; max output tokens: 16,000.
- No effort override was sent; all stages used the provider default.
- Three runs each of `iron-near-me` and `follow-up`, per the user's reduced
  measurement scope. `power-plan` and the original five-run matrix were omitted.
- Iron question: “What's the next iron factory I should build near me?”
- Follow-up: that iron question, then “And what about copper — what should I
  build for that near me?” Only the copper turn appears in the tables; its
  preparatory iron turn also incurs cost.
- Each run uses a fresh scratch database playthrough and an uploaded copy of
  the same save. Prompt caches were not forcibly cleared between runs, so
  cache warmth varies; medians and ranges are descriptive, not significance tests.
- Baseline: ff-server `936aa5e`; cache: `66517a7` (prompt steering and
  conversation caching); original final: `8a738a1` (all implementation work,
  but no snapshot in the measurement request); corrected: `4e2cfb8` (the
  harness fix on `8a738a1`), with final-build sf-mcp. The run started with that fix uncommitted; it was committed during
  execution; both corrected logs report `4e2cfb8` at report time.
- The first baseline iron sample reuses the earlier smoke run. Its `run: 1`
  overlaps another `run: 1`; row order identifies samples unambiguously.
- Duration is `runChat` time. It excludes upload, save-summary construction,
  database preparation and follow-up setup turns.
- Only metrics were retained by the harness. Final answer text and work-order
  payloads were not saved, so these measurements do not establish answer quality.
- Save: `production.sav`, SHA-256 `d5b7fcb7aa811e25b56f4c80c71fa0a1f2d706a8f97db66e48d2bb008882ee11`. The save is not committed.

## Cost calculation

USD estimates use [Anthropic's pricing table](https://platform.claude.com/docs/en/about-claude/pricing),
checked on 16 October 2026: per million tokens, $2 input, $2.50 five-minute
cache write, $0.10 cache read and $10 output. These are token-based estimates,
not an invoice reconciliation.

`USD = (2 × input + 2.5 × cacheWrite + 0.10 × cacheRead + 10 × output) / 1,000,000`

The historical CLI's `inputEquivalent` field weights cache reads at 0.1×.
For Sonnet 5.5 it should be 0.05×. Raw JSON is preserved unchanged; this report
recalculates costs from the four raw token counts and does not use that field.

## Results

Cells show median (minimum–maximum), three samples per row.

| Scenario | Stage | Rounds | Tool calls | USD per measured answer | Seconds |
|---|---|---|---|---|---|
| iron-near-me | baseline | 7 (7–9) | 20 (18–24) | 0.541 (0.489–0.792) | 125.6 (97.2–130.8) |
| iron-near-me | cache | 7 (7–8) | 21 (19–22) | 0.313 (0.284–0.341) | 104.1 (91.2–121.4) |
| iron-near-me | final | 7 (6–7) | 18 (17–19) | 0.284 (0.274–0.339) | 105.5 (103.2–109.6) |
| iron-near-me | corrected | 8 (6–9) | 19 (14–20) | 0.344 (0.272–0.345) | 137.1 (91.1–140.1) |
| follow-up | baseline | 5 (4–5) | 12 (11–13) | 0.198 (0.181–0.208) | 37.1 (36.4–40.5) |
| follow-up | cache | 4 (4–5) | 12 (10–14) | 0.112 (0.097–0.144) | 27.1 (27.0–38.1) |
| follow-up | final | 4 (4–6) | 13 (11–15) | 0.137 (0.096–0.165) | 47.1 (27.4–47.8) |
| follow-up | corrected | 4 (3–4) | 9 (6–12) | 0.075 (0.046–0.119) | 29.6 (21.0–29.6) |

### Token breakdown

| Scenario | Stage | Uncached input | Cache read | Cache write | Output |
|---|---|---|---|---|---|
| iron-near-me | baseline | 178,620 (176,784–277,460) | 177,744 (177,744–203,136) | 0 (0–25,392) | 15,358 (11,431–16,939) |
| iron-near-me | cache | 16 (16–18) | 340,688 (330,473–404,317) | 51,369 (46,456–52,478) | 14,854 (13,329–17,187) |
| iron-near-me | final | 16 (14–16) | 313,837 (234,735–316,185) | 43,038 (42,030–68,760) | 14,366 (13,766–14,514) |
| iron-near-me | corrected | 18 (14–20) | 381,472 (202,261–453,293) | 49,175 (45,480–55,020) | 18,339 (11,466–18,516) |
| follow-up | baseline | 75,174 (65,744–77,380) | 126,960 (101,568–126,960) | 0 (0–0) | 3,953 (3,518–4,057) |
| follow-up | cache | 10 (10–12) | 141,948 (125,020–184,896) | 25,841 (21,327–31,862) | 3,278 (3,139–4,621) |
| follow-up | final | 10 (10–14) | 125,009 (124,441–229,192) | 26,997 (19,561–33,297) | 5,652 (3,471–5,880) |
| follow-up | corrected | 10 (8–10) | 118,452 (84,597–137,634) | 10,467 (6,265–26,597) | 3,705 (2,177–3,827) |

The corrected rerun cost approximately **$2.02**, including all three preparatory iron answers for the follow-up scenario.

## Snapshot size and save-tool calls

The corrected snapshot is **1,624 characters** (character count, not a tokenizer measurement).

- Baseline `iron-near-me`: these six tools returned 37,379 (37,299–39,859) characters in total per measured turn.
- Baseline `follow-up`: these six tools returned 38,449 (37,042–38,449) characters in total per measured turn.

Calls below are totals across the three runs, not medians. Detail calls can remain legitimate when the snapshot omits the requested detail.

| Scenario | Stage | get_player_state | get_milestones | get_unlocked_recipes | get_power | get_production | get_storage |
|---|---|---|---|---|---|---|---|
| iron-near-me | baseline | 3 | 3 | 3 | 3 | 7 | 3 |
| iron-near-me | cache | 3 | 3 | 3 | 3 | 8 | 3 |
| iron-near-me | final | 3 | 3 | 3 | 3 | 6 | 3 |
| iron-near-me | corrected | 1 | 3 | 2 | 0 | 11 | 3 |
| follow-up | baseline | 3 | 3 | 3 | 2 | 9 | 3 |
| follow-up | cache | 3 | 3 | 3 | 3 | 8 | 2 |
| follow-up | final | 3 | 3 | 2 | 3 | 10 | 2 |
| follow-up | corrected | 0 | 1 | 0 | 0 | 6 | 1 |

## Per-tool evidence

Mean calls and returned characters per measured turn. Host-internal summary construction is excluded from model tool-call counts.

| Scenario | Stage | Tool | Mean calls | Mean result characters |
|---|---|---|---|---|
| iron-near-me | baseline | check_material_coverage | 1.00 | 1670 |
| iron-near-me | baseline | create_work_order | 1.33 | 325 |
| iron-near-me | baseline | describe_location | 0.67 | 79 |
| iron-near-me | baseline | find_bottlenecks | 1.00 | 2850 |
| iron-near-me | baseline | get_building | 1.67 | 3644 |
| iron-near-me | baseline | get_milestones | 1.00 | 9248 |
| iron-near-me | baseline | get_nearby | 1.00 | 676 |
| iron-near-me | baseline | get_player_state | 1.00 | 1137 |
| iron-near-me | baseline | get_power | 1.00 | 1407 |
| iron-near-me | baseline | get_production | 2.33 | 5322 |
| iron-near-me | baseline | get_recipe | 0.33 | 492 |
| iron-near-me | baseline | get_schematic | 0.33 | 662 |
| iron-near-me | baseline | get_storage | 1.00 | 4332 |
| iron-near-me | baseline | get_unlocked_recipes | 1.00 | 16733 |
| iron-near-me | baseline | ingredient_tree | 1.33 | 1369 |
| iron-near-me | baseline | list_buildings | 2.00 | 2837 |
| iron-near-me | baseline | nearest_resource_nodes | 2.00 | 6190 |
| iron-near-me | baseline | recipes_for | 0.33 | 1671 |
| iron-near-me | baseline | revise_work_order | 0.33 | 30 |
| iron-near-me | cache | check_material_coverage | 1.00 | 1618 |
| iron-near-me | cache | create_work_order | 2.00 | 331 |
| iron-near-me | cache | describe_location | 1.00 | 119 |
| iron-near-me | cache | find_bottlenecks | 1.00 | 2850 |
| iron-near-me | cache | full_production_line | 1.67 | 7930 |
| iron-near-me | cache | get_building | 0.33 | 743 |
| iron-near-me | cache | get_milestones | 1.00 | 9248 |
| iron-near-me | cache | get_nearby | 1.00 | 676 |
| iron-near-me | cache | get_player_state | 1.00 | 1137 |
| iron-near-me | cache | get_power | 1.00 | 1407 |
| iron-near-me | cache | get_production | 2.67 | 5439 |
| iron-near-me | cache | get_recipe | 0.33 | 171 |
| iron-near-me | cache | get_storage | 1.00 | 4332 |
| iron-near-me | cache | get_unlocked_recipes | 1.00 | 16733 |
| iron-near-me | cache | list_buildings | 1.33 | 2758 |
| iron-near-me | cache | list_power_generators | 0.33 | 1079 |
| iron-near-me | cache | list_schematics | 0.33 | 984 |
| iron-near-me | cache | nearest_resource_nodes | 2.00 | 6800 |
| iron-near-me | cache | recipes_for | 0.67 | 2081 |
| iron-near-me | final | check_material_coverage | 1.00 | 1776 |
| iron-near-me | final | create_work_order | 1.00 | 245 |
| iron-near-me | final | describe_location | 1.00 | 119 |
| iron-near-me | final | full_production_line | 1.00 | 4103 |
| iron-near-me | final | get_building | 0.67 | 1486 |
| iron-near-me | final | get_milestones | 1.00 | 9248 |
| iron-near-me | final | get_nearby | 1.00 | 865 |
| iron-near-me | final | get_player_state | 1.00 | 1137 |
| iron-near-me | final | get_power | 1.00 | 1407 |
| iron-near-me | final | get_production | 2.00 | 4495 |
| iron-near-me | final | get_recipe | 0.67 | 831 |
| iron-near-me | final | get_storage | 1.00 | 4224 |
| iron-near-me | final | get_unlocked_recipes | 1.00 | 16733 |
| iron-near-me | final | list_buildings | 2.67 | 5813 |
| iron-near-me | final | nearest_resource_nodes | 1.00 | 3369 |
| iron-near-me | final | recipes_for | 0.33 | 1671 |
| iron-near-me | final | revise_work_order | 0.67 | 61 |
| iron-near-me | corrected | check_material_coverage | 1.00 | 1454 |
| iron-near-me | corrected | create_work_order | 1.00 | 205 |
| iron-near-me | corrected | describe_location | 1.33 | 159 |
| iron-near-me | corrected | full_production_line | 1.00 | 4451 |
| iron-near-me | corrected | get_building | 0.67 | 1420 |
| iron-near-me | corrected | get_milestones | 1.00 | 9248 |
| iron-near-me | corrected | get_nearby | 0.67 | 483 |
| iron-near-me | corrected | get_nearby_parts | 0.67 | 979 |
| iron-near-me | corrected | get_player_state | 0.33 | 379 |
| iron-near-me | corrected | get_production | 3.67 | 6008 |
| iron-near-me | corrected | get_recipe | 0.67 | 818 |
| iron-near-me | corrected | get_storage | 1.00 | 4333 |
| iron-near-me | corrected | get_unlocked_recipes | 0.67 | 11155 |
| iron-near-me | corrected | list_buildings | 1.67 | 2614 |
| iron-near-me | corrected | nearest_resource_nodes | 1.00 | 2896 |
| iron-near-me | corrected | recipes_for | 0.67 | 2752 |
| iron-near-me | corrected | revise_work_order | 0.67 | 163 |
| follow-up | baseline | check_material_coverage | 0.33 | 460 |
| follow-up | baseline | find_bottlenecks | 0.67 | 1900 |
| follow-up | baseline | get_milestones | 1.00 | 9248 |
| follow-up | baseline | get_player_state | 1.00 | 1137 |
| follow-up | baseline | get_power | 0.67 | 938 |
| follow-up | baseline | get_production | 3.00 | 5592 |
| follow-up | baseline | get_schematic | 0.33 | 649 |
| follow-up | baseline | get_storage | 1.00 | 4332 |
| follow-up | baseline | get_unlocked_recipes | 1.00 | 16733 |
| follow-up | baseline | list_schematics | 0.33 | 984 |
| follow-up | baseline | nearest_resource_nodes | 1.00 | 1877 |
| follow-up | baseline | recipes_for | 0.67 | 1480 |
| follow-up | baseline | total_raw_inputs | 0.33 | 135 |
| follow-up | baseline | what_consumes | 0.67 | 624 |
| follow-up | cache | check_material_coverage | 1.00 | 1524 |
| follow-up | cache | find_bottlenecks | 0.33 | 950 |
| follow-up | cache | get_milestones | 1.00 | 9248 |
| follow-up | cache | get_player_state | 1.00 | 1137 |
| follow-up | cache | get_power | 1.00 | 1407 |
| follow-up | cache | get_production | 2.67 | 4418 |
| follow-up | cache | get_storage | 0.67 | 2888 |
| follow-up | cache | get_unlocked_recipes | 1.00 | 16733 |
| follow-up | cache | list_schematics | 0.33 | 984 |
| follow-up | cache | nearest_resource_nodes | 1.33 | 2416 |
| follow-up | cache | recipes_for | 0.67 | 3389 |
| follow-up | cache | what_consumes | 1.00 | 936 |
| follow-up | final | check_material_coverage | 1.00 | 1528 |
| follow-up | final | get_milestones | 1.00 | 9248 |
| follow-up | final | get_player_state | 1.00 | 1137 |
| follow-up | final | get_power | 1.00 | 1407 |
| follow-up | final | get_production | 3.33 | 6218 |
| follow-up | final | get_recipe | 0.67 | 798 |
| follow-up | final | get_storage | 0.67 | 2889 |
| follow-up | final | get_unlocked_recipes | 0.67 | 11155 |
| follow-up | final | list_schematics | 0.67 | 1968 |
| follow-up | final | nearest_resource_nodes | 2.00 | 4098 |
| follow-up | final | recipes_for | 0.67 | 3320 |
| follow-up | final | what_consumes | 0.33 | 312 |
| follow-up | corrected | check_material_coverage | 1.00 | 1472 |
| follow-up | corrected | get_building | 0.33 | 547 |
| follow-up | corrected | get_milestones | 0.33 | 3083 |
| follow-up | corrected | get_production | 2.00 | 2691 |
| follow-up | corrected | get_schematic | 0.33 | 240 |
| follow-up | corrected | get_storage | 0.33 | 1444 |
| follow-up | corrected | list_schematics | 1.00 | 6244 |
| follow-up | corrected | nearest_resource_nodes | 1.33 | 1870 |
| follow-up | corrected | recipes_for | 1.33 | 4464 |
| follow-up | corrected | what_consumes | 1.00 | 936 |

## Repeating the corrected stage

Start a fresh MCP process from the final commit on an unused port, with
`MCP_TRANSPORT=http`, `MCP_HTTP_HOST=127.0.0.1`, `MCP_HTTP_PORT=18723` and
`SAVE_DATA_DIR=/tmp`. Confirm its actual listener PID and tool schemas before
running the measurement. A log line saying “Listening” is insufficient if a
previous listener survived the restart.

With the provider key already loaded into the environment, run from the repo root:

```sh
MCP_URL=http://127.0.0.1:18723/mcp npm run measure:turn -w @foreman/ff-server -- --save /path/to/production.sav --scenario iron-near-me --runs 3 --model claude-sonnet-5-5 --out /path/to/new-results.jsonl
MCP_URL=http://127.0.0.1:18723/mcp npm run measure:turn -w @foreman/ff-server -- --save /path/to/production.sav --scenario follow-up --runs 3 --model claude-sonnet-5-5 --out /path/to/new-results.jsonl
```

Use a new output file; the CLI appends records. The model calls incur API cost.

## Raw records

- [baseline](chat-tool-economy/baseline.jsonl)
- [cache](chat-tool-economy/cache.jsonl)
- [final](chat-tool-economy/final.jsonl)
- [corrected](chat-tool-economy/corrected.jsonl)
- [traced](chat-tool-economy/traced.jsonl) — copper turns only, as measured
- [traced, full trace](chat-tool-economy/traced-trace.jsonl) — all six turns, with tool arguments, capped results, answers and work orders
