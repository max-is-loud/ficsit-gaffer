# Chat tool economy implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the model rounds, tool calls and input tokens of a foreman chat turn (#36, #37, #38, #39), and measure the change against a fixed baseline.

**Architecture:** Five PRs, smallest first. First, per-turn usage metrics and a repeatable measurement script. Then prompt steering (#38), batched lookups in `sf-mcp` (#37), concurrent tool dispatch (#39), and finally a cached save summary sent as its own system block after the persona (#36). Each PR is measured against the previous one with the same script, save and questions.

**Tech stack:** TypeScript (ESM), Express, Prisma/SQLite, `@anthropic-ai/sdk`, `openai`, MCP SDK, zod, Vitest.

**Spec:** issues #36, #37, #38 and #39 (`gh issue view N -R max-is-loud/ficsit-foreman`); the bridge v2 design on `feature/bridge-v2-spec` (`docs/superpowers/specs/2026-10-15-bridge-v2-live-world-design.md`); and the "#36 design" section below, which settles the design questions in #36.

## Global constraints

- Code standards from `CONTRIBUTING.md`: a header comment on every non-test file; at most 500 lines per file; functions at most 60 lines, depth 3, complexity 12 and 4 parameters; new kinds of thing go in tables, not `if` arms; no `any`; braces always; British English.
- Never add to `source-limits.json` or `eslint-suppressions.json`, and never raise a count. When a change fixes a recorded violation, run `npm run lint:prune` (and `npm run check:source -- --update` if needed) in that package.
- Before each commit, run `npm run lint`, `npm run check:source` and `npm test` in every package you touched.
- Conventional Commits with a body; branch per PR from `main`; AI-generated PR bodies start with `🤖 AI-generated PR — Please review carefully.` and link their issue (`Closes #N` / `Refs #N`).
- Nothing on upstream (`StuartMeeks/ficsit-foreman`). Commits marked **[upstreamable]** below must touch only that package's generic code, with no Gaffer-only lines mixed in.
- `get_recipe` / `get_building` / `get_item` / `get_schematic` keep their single-`name` call shape and response shape, because `workOrderTools.ts` calls them that way (lines 1071, 1180, 1228).
- The persona system block and the tool list must stay byte-identical across turns of one playthrough unless the persona, pioneer profile, session summary or tool set changes. Anything that changes per save goes **after** them.

## Findings from the investigation (beyond the brief)

1. **The messages in a turn are not cached.** `anthropic.ts` sets breakpoints on the tool list and the system prompt only. Each of a turn's ~7 rounds re-sends the growing message list as uncached input, which explains most of the ~215K input tokens. A breakpoint on the last message would turn most of that into cache reads (at a tenth of the input price). This is one adapter change, and no issue covers it yet. **Recommendation:** file a new issue and ship it as PR 2 (Task 3). It uses the 4th and last breakpoint (tools, system, save summary, last message).
2. **The session summary sits inside the persona block** (`{{SESSION_SUMMARY}}`, between the pioneer profile and Authority). Each time the background summariser updates it, the system cache is invalidated. That happens rarely, so this plan doesn't change it; it's noted for a later issue.
3. **`describe_save` is offered to the model** even though its description says it is host-internal. Task 6 hides host-internal tools from the model, which also shortens the cached tool list.
4. **A tool that throws aborts the whole turn.** `callTool` errors propagate out of `runChat`. Task 5 turns them into per-call `isError` results, as #39 requires.
5. **The save header has a real save timestamp.** `@etothepii/satisfactory-file-parser` exposes `header.saveDateTime`, but `sf-save-data` drops it. Task 6 carries it through so the summary can say when the pioneer saved, not just when the file was uploaded.
6. **`sf-mcp/src/tools/gameData.ts` is 469 lines.** Batching has to move code out of it, not add to it (Task 4).
7. Upstream `main` (`e300175`) has none of this work, so nothing is to be cherry-picked first.

## Order of work and PR split

| PR | Branch | Issue | Contents | Upstream? |
|---|---|---|---|---|
| 1 | `feature/chat-turn-metrics` | Refs #38, Closes #34 | Token usage on `LlmTurnResult`; stop reason and output tokens logged by both adapters; one log line per turn; the measurement script; a **baseline** run | Adapter and metrics commit **[upstreamable]**; script Gaffer-only |
| 2 | `feature/batched-tool-rounds-prompt` | Closes #38 | `SYSTEM_PROMPT.md` steering, plus its tests | Gaffer-only |
| 3 | `feature/cache-chat-messages` | new issue (file after approval) | A cache breakpoint on the last message | **[upstreamable]** |
| 4 | `feature/batched-lookup-tools` | Closes #37 | `names[]` lookups, `recipes_for` `items[]`, `nearest_resource_nodes` `resources[]`; one prompt line | `sf-mcp` commit **[upstreamable]**; prompt commit Gaffer-only |
| 5 | `feature/concurrent-tool-calls` | Closes #39 | `toolRunner.ts`: concurrent read-only calls, ordered work-order calls, per-call errors | **[upstreamable]** |
| 6 | `feature/save-summary-context` | Closes #36 | `savedAt` in `sf-save-data`; `get_save_summary` in `sf-mcp`; the cache, renderer and context block in `ff-server`; the prompt update | `sf-save-data` and `sf-mcp` commits **[upstreamable]**; `ff-server` and prompt commits Gaffer-only (shaped around bridge v2) |

Each PR includes a measurement run, appended to `docs/measurements/chat-tool-economy.md`. #39 comes before #36 because it is small and independent, and it makes the batched calls from #37 actually run in parallel. #36 then lands last, so its measurement isolates its own effect. #33 and #35 aren't needed. #34 is closed by PR 1 as a side effect, since the measurement needs the same numbers. If you'd rather keep #34 separate, PR 1 can say `Refs #34` instead.

## #36 design

### D1. Where the data comes from

| Option | Notes |
|---|---|
| **A. A new `sf-mcp` tool, `get_save_summary` (recommended)** | One host-internal MCP call, built from the existing selectors next to the parsed save (`SaveStore`'s mtime cache already avoids re-parsing). Compact, typed and upstreamable. |
| B. `ff-server` calls the 6–7 existing tools and condenses them | No `sf-mcp` change, but it moves large payloads, ties `ff-server` to every tool's shape, and needs 7 calls per build. |
| C. `ff-server` parses the save itself | Duplicates `sf-mcp` and pulls the save parser into the server. Rejected. |

### D2. Where it goes in the prompt

| Option | Caching effect |
|---|---|
| **A. A second system block after the persona, with its own `cache_control` (recommended)** | Order: tools (breakpoint) → persona (breakpoint) → save summary (breakpoint) → messages. A re-upload invalidates only the summary block and what follows it. The tool list and persona stay cached. For OpenAI, it is a second `system` message, so its automatic prefix cache keeps the persona prefix. |
| B. A placeholder inside `SYSTEM_PROMPT.md` | Each re-upload invalidates the persona cache (~5K tokens). Simpler, but it is what #36 asks us to avoid. |
| C. Prepended to the latest user message | Changes history and is never stable. Rejected. |

### D3. Contents and size budget

The budget is **≤ 1,200 tokens (about 4,800 characters) rendered**, enforced by fixed caps on every list, not by truncating text. One summary replaces 6–7 tool results per turn, and `get_production` and `get_storage` alone are often larger than the whole summary. The measurement script records the actual size of each tool result it replaces, so the comparison is measured, not assumed.

| Section | Contents | Cap |
|---|---|---|
| Header | Save name, in-game save time (UTC), upload time (UTC), play time, game version | — |
| Player | Position (metres, rounded to 1 m), biome and direction within it, HUB position | — |
| Progress | Highest tier with a purchased milestone; milestones purchased in that tier; Space Elevator phase; unlocked MAM trees | 8 milestones |
| Recipes | Standard and alternate counts; alternate names | 30 names, then "+N more" |
| Power | Total capacity, consumption and headroom (MW); circuit count and overloaded-circuit count; generators by type (count, MW) | 6 generator types |
| Production | Top items by configured per-minute output (item, /min, machine count) | 15 |
| Storage | Top items by quantity held (containers plus the dimensional depot) | 15 |
| Nearby resources | The nearest node of each resource type, for the 8 nearest types (resource, purity, distance in m, bearing, biome). Not checked against existing miners, and the block says so | 8 |

Left to tools: inventory, per-machine lists, storage locations, collectibles, bottlenecks and per-circuit detail.

### D4. Caching and invalidation

| Option | Notes |
|---|---|
| **A. In memory, keyed by `saveId` (recommended)** | A re-upload creates a new `Save` row, and so a new key. `setCurrentSave` switches keys. Delete evicts the entry. Built lazily on the first turn and warmed in the background after an upload. Rendering is deterministic, so after a restart a rebuilt summary is byte-identical and the provider's prompt cache still hits. LRU capacity 32. |
| B. A persisted `summaryJson` column on `Save` | Needs a migration. Only worth it if building turns out slow, and the measurement script will show whether it does. |

A failed build is logged as a warning and not cached. The turn continues without the block, and the save tools still work.

### D5. Freshness and source labels

Each block carries its source and time in a heading, rather than a tag on every line, which saves tokens. Every figure sits under exactly one heading, so each is labelled. Timestamps are **absolute**. Relative wording such as "2 h ago" would change the bytes every turn and break caching. The save heading reads:

`## Save snapshot — saved in-game 2026-10-14 21:03 UTC, uploaded 2026-10-14 21:10 UTC (not live)`

If the header has no save time, the block shows the upload time only.

### D6. Extension point for live data (bridge v2)

| Option | Notes |
|---|---|
| **A. Separate blocks per source (recommended)** | A `ContextContributor` table, each entry returning one rendered block. The save block stays byte-stable across turns. A future live contributor (bridge v2 Part 2: position; later #14: readings) adds a small **Live readings** block after it, rebuilt each turn, frozen for that turn's rounds, and headed with its freshness (`fresh` / `last_known`, `lastSyncAt`). It names the save figures it supersedes ("supersedes the save's player position"). The cache breakpoint goes on the last block, so a change in the live block costs only a rewrite of that small block. |
| B. A per-figure merge into one block | Every live update rewrites the whole summary and invalidates its cache each turn. Rejected. |

This plan builds the contributor table and the save contributor only. When the live contributor lands, the bridge v2 rule "the Pioneer's live position comes only from `get_my_live_position`" needs a revision to allow "or the Live readings block". I'll note that on the v2 spec branch when we get there, not in this work.

### D7. Prompt update

The "Save State & Opportunities" section changes. When a Save snapshot block is present, the model uses it for position, tier, milestones, recipe counts, power totals and top production and storage. It calls the save tools only for detail the block doesn't contain. When there is no block, there is no save.

## Measurement

**Tool:** `npm run measure:turn -w @foreman/ff-server` (Task 1). It drives the real `runChat` with the real provider and a real `sf-mcp`, against a scratch SQLite database and a fresh playthrough per run. Wrappers around the provider and the gateway record each round.

**Fixed inputs**, recorded at the top of every results entry:

- Save: a copy of the production save, passed with `--save`. It isn't committed. Record its file name and SHA-256.
- Model: `--model`, matching production. Max tokens: 16000, as in production.
- Scenarios, in `src/scripts/measureScenarios.ts`:
  - `iron-near-me`: "What's the next iron factory I should build near me?"
  - `power-plan`: "My power is getting tight. Plan the next power plant for me."
  - `follow-up`: the `iron-near-me` question, then "And what about copper — what should I build for that near me?" Only turn 2 is measured. This is the re-fetch case #36 targets.
- Runs: `--runs 5` per scenario. Report the median, plus the minimum and maximum.

**Per-turn metrics:** rounds; tool calls (total and by name); characters returned per tool; uncached input, cache-read, cache-write and output tokens; final stop reason; wall time. Derived: **input-equivalent = input + 1.25 × cacheWrite + 0.1 × cacheRead**, the Anthropic price ratios for the 5-minute cache. This is the main cost figure.

**Expected direction.** These are targets to check, not CI gates. After #38: fewer rounds, and `full_production_line` in place of `ingredient_tree` + `get_recipe` chains. After the cache PR: input-equivalent per turn down sharply at the same tool count. After #37: fewer `get_*` calls. After #39: lower wall time, everything else unchanged. After #36: in `follow-up` turn 2, no calls to `get_player_state`, `get_milestones`, `get_storage` or `get_production`. Overall: median rounds ≤ 4 and input-equivalent ≤ 50 % of baseline on `iron-near-me`.

---

### Task 1: Turn metrics and the measurement script (PR 1)

**Files:**
- Modify: `packages/ff-server/src/llm/types.ts` (add `TurnUsage`, `LlmTurnResult.usage`, `LlmTurnResult.rawStopReason`)
- Modify: `packages/ff-server/src/llm/anthropic.ts` (fill usage; add `stop_reason` and output tokens to the log line)
- Modify: `packages/ff-server/src/llm/openai.ts` (`stream_options: { include_usage: true }`; read `usage` from the final chunk; log `finish_reason` and completion tokens)
- Create: `packages/ff-server/src/llm/turnMetrics.ts`
- Modify: `packages/ff-server/src/llm/chat.ts` (accumulate metrics; log one line per turn; optional `events.metrics`)
- Create: `packages/ff-server/src/scripts/measureChatTurn.ts`, `measureScenarios.ts`, `scratchDb.ts`
- Modify: `packages/ff-server/package.json` (`"measure:turn": "tsx src/scripts/measureChatTurn.ts"`)
- Create: `docs/measurements/chat-tool-economy.md`
- Test: `packages/ff-server/test/turnMetrics.test.ts`, `openai-stream.test.ts`, `anthropic.test.ts`, `chat.test.ts`

**Interfaces:**
- Produces:
  - `interface TurnUsage { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }`
  - `LlmTurnResult.usage?: TurnUsage`, `LlmTurnResult.rawStopReason?: string`
  - `OpenAiStreamChunk.usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }`. OpenAI's `cached_tokens` maps to `cacheReadTokens` and is subtracted from `inputTokens`.
  - `interface TurnMetrics { rounds: number; toolCalls: string[]; usage: TurnUsage; stopReason: string; durationMs: number; hitIterationCap: boolean }`
  - `class TurnMetricsRecorder { startRound(): void; recordRound(result: LlmTurnResult): void; recordToolCalls(calls: NeutralToolCall[]): void; finish(hitCap: boolean): TurnMetrics }`
  - `formatTurnMetrics(metrics: TurnMetrics): string` produces `Chat turn: rounds=7 tools=30 input=… cacheRead=… cacheWrite=… output=… stop=end_turn ms=…`
  - `ChatEvents.metrics?(metrics: TurnMetrics): void` is optional, so the chat route compiles unchanged.

- [ ] **Step 1: Write the failing tests.** `turnMetrics.test.ts`: two rounds with usage `{10,5,100,0}` and `{20,7,110,30}` sum to `{30,12,210,30}`; a round with no usage adds zero; `formatTurnMetrics` output matches the line above. `openai-stream.test.ts`: a final chunk `{ choices: [], usage: { prompt_tokens: 120, completion_tokens: 9, prompt_tokens_details: { cached_tokens: 100 } } }` yields `usage = { inputTokens: 20, outputTokens: 9, cacheReadTokens: 100, cacheWriteTokens: 0 }`. `chat.test.ts`: a two-round scripted turn calls `events.metrics` once, with `rounds: 2` and `toolCalls: ['get_recipe']`.
- [ ] **Step 2: Run** `npm test -w @foreman/ff-server`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement the types, adapters, recorder and the `runChat` wiring.** `runChat` keeps its signature and return value. It logs `formatTurnMetrics` at `info` level on every exit path, including the iteration cap.
- [ ] **Step 4: Run the tests.** Expected: PASS. Then run `npm run lint`, `npm run check:source`, and `npm run lint:prune` if `openai.ts`'s recorded complexity dropped.
- [ ] **Step 5: Commit [upstreamable]:** `feat(server): record token usage and stop reason per model call and per turn`.
- [ ] **Step 6: Write the script.** `measureChatTurn.ts` takes `--save <path> --scenario <id|all> --runs <n> --model <id> [--max-tokens 16000] [--out <file.jsonl>]`. It reads `LLM_API_KEY` and `SF_MCP_URL` (default `http://localhost:3001/mcp`). For each run, it uses `scratchDb.ts` (`createScratchDb(): Promise<{ prisma, saveDataDir, cleanup }>`, applied with `prisma db push` as in `test/helpers.ts`) and `SaveService.addVersion` to attach a copy of the save. It wraps the provider and the gateway to record per-round usage and per-tool result sizes, runs each scenario turn by turn through `runChat`, writes one JSONL row per measured turn, and prints a markdown table (median, min and max per metric per scenario). `measureScenarios.ts` exports `MEASURE_SCENARIOS: { id: string; turns: string[]; measuredTurn: number }[]` with the three scenarios above. `sf-mcp` must run on the same machine (`npm run dev -w @foreman/sf-mcp`) so it can read the save by its absolute path.
- [ ] **Step 7: Smoke-test the script** with `--runs 1 --scenario iron-near-me`. Expected: one row, `rounds ≥ 1`, and non-zero input tokens.
- [ ] **Step 8: Record the baseline.** `--runs 5 --scenario all` on this branch. The prompt is unchanged, so this is the baseline. Write the table, model, save hash and git SHA into `docs/measurements/chat-tool-economy.md` under "Baseline".
- [ ] **Step 9: Commit (Gaffer-only)** `feat(server): add a repeatable chat-turn measurement script`, then open PR 1.

### Task 2: Steer towards fewer, batched rounds (PR 2, #38)

**Files:**
- Modify: `packages/ff-server/SYSTEM_PROMPT.md` (a new "Research Efficiently" section directly after "Match the intent to the tool"; edit the "Full production breakdown" bullet)
- Test: `packages/ff-server/test/systemPrompt.test.ts`

- [ ] **Step 1: Write the failing test.** A new `describe('research economy guidance in the bundled prompt')` loads the bundled template and asserts it contains `same round`, `full_production_line` and `do not re-fetch`.
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Add the section.** Exact copy:

```
## Research Efficiently

Every round of tool calls re-sends the whole conversation, so rounds are the
cost, not calls. Plan the lookups a question needs first, then request every
independent lookup in the same round — several tool calls at once. Only start
another round when a later lookup depends on an earlier result.
- For a production chain, call `full_production_line` (machines, extraction and
  build cost in one answer) or `total_raw_inputs` — do not walk the chain with
  `ingredient_tree` followed by `get_recipe` for each step.
- Do not re-fetch a fact you already have this turn, or one stated in a save
  snapshot or live readings block.
```

Change the bullet `Full production breakdown with machine counts → ingredient_tree` to `Full production chain with machine counts and build cost → full_production_line (ingredient_tree for per-tier rates only)`.
- [ ] **Step 4: Run** the tests, `npm run lint` and `npm run check:source`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(server): steer the foreman towards fewer, batched tool rounds`.
- [ ] **Step 6: Measure** `--runs 5 --scenario all`, append the results under "#38", and open PR 2 (`Closes #38`).

### Task 3: Cache the conversation within a turn (PR 3, new issue)

Before starting, file the issue "perf(server): cache the conversation prefix across tool rounds" (`enhancement`, `area:ff-server`, milestone *Public release*), add it to project 4, and link it from the PR.

**Files:**
- Modify: `packages/ff-server/src/llm/anthropic.ts` (add `markLastMessageCacheable(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[]`)
- Test: `packages/ff-server/test/anthropic.test.ts`

- [ ] **Step 1: Write the failing tests.** For a request whose last message is a tool-result user message, the last block of the last message has `cache_control: { type: 'ephemeral' }`. A string-content last message becomes `[{ type: 'text', text, cache_control }]`. No other message carries `cache_control`. There are at most 4 breakpoints in total (tools, system, last message, plus the context block from Task 6). The input array is not mutated.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement it** and apply it in `runTurn`. Add a comment explaining why: the rounds re-send the growing message list. Caveat for the comment: cache lookups scan back at most 20 blocks from a breakpoint, so a round with more than ~9 tool calls may miss once and write again.
- [ ] **Step 4: Run** the tests and lint. Expected: PASS.
- [ ] **Step 5: Commit [upstreamable]:** `perf(server): cache the conversation prefix across tool rounds`.
- [ ] **Step 6: Measure, append the results** (expect cache-read to dominate), and open PR 3.

### Task 4: Batched lookups (PR 4, #37)

**Files:**
- Create: `packages/sf-mcp/src/tools/toolResult.ts` (`ToolResult` type, `okResult(version, payload)`, `notFoundResult(version, what)`, moved out of `gameData.ts`)
- Create: `packages/sf-mcp/src/tools/lookupTools.ts` (the lookup table and `registerLookupTools`)
- Modify: `packages/sf-mcp/src/tools/gameData.ts` (remove `get_item`, `get_recipe`, `get_schematic`, `get_building` and `recipes_for`; call `registerLookupTools`; add `resources` to `nearest_resource_nodes`)
- Modify: `packages/ff-server/SYSTEM_PROMPT.md` (one bullet)
- Test: `packages/sf-mcp/test/lookupTools.test.ts`; existing `gameDataTools.test.ts` and ff-server `workOrderTools.test.ts` must still pass

**Interfaces:**
- Produces:
  - `interface LookupToolSpec { tool: string; title: string; description: string; singularKey: string; pluralKey: string; argName: 'name' | 'item'; resolve(graph: GraphDB, name: string): Promise<object | undefined> | object | undefined; notFoundLabel: string }`
  - `const LOOKUP_TOOLS: LookupToolSpec[]` has five entries: `get_item` (`item`/`items`), `get_recipe` (`recipe`/`recipes`), `get_building` (`building`/`buildings`), `get_schematic` (`schematic`/`schematics`), and `recipes_for` (`argName: 'item'`; the single response spreads the result as today; plural key `results`).
  - `registerLookupTools(server: McpServer, graph: GraphDB): void`
  - Input schema per tool: `{ [argName]: z.string().optional(), [argName + 's']: z.array(z.string()).min(1).max(25).optional() }`. Exactly one must be given; otherwise return `isError` with `Pass either '<argName>' or '<argName>s'.`
  - Single form: the response is unchanged byte for byte. Batched form: `{ version, [pluralKey]: [...found in request order, de-duplicated], notFound: string[] }`, with `isError` only when nothing resolved.
  - `nearest_resource_nodes` gains `resources?: string[]` (max 10, exclusive with `resource`). With it, `n` applies per resource and the response is `{ version, byResource: { [name]: nodes[] }, notFound: string[] }`.
- `ingredient_tree` stays single-target. Each target has its own rate, and Task 2 already steers chains to `full_production_line`. Record this in the PR body.

- [ ] **Step 1: Write the failing tests** in `lookupTools.test.ts`, against a stub server and the fixture graph used by `gameDataTools.test.ts`. For each of the five tools: `names: ['<real A>', 'Nope', '<real A>', '<real B>']` returns A and B in order, with `notFound: ['Nope']` and no `isError`. All not found gives `isError: true`. The single `name` response deep-equals today's. Neither argument, or both, gives an error. Compactness: the batched text length is ≤ the sum of the single-call text lengths for the same names. For `nearest_resource_nodes`: `resources: ['Iron Ore', 'Copper Ore'], n: 2` returns two nodes per key.
- [ ] **Step 2: Run** `npm test -w @foreman/sf-mcp`. Expected: FAIL.
- [ ] **Step 3: Implement.** Descriptions start with the single-name sentence and add: "Pass `names` to resolve several at once in one call — prefer this over separate calls."
- [ ] **Step 4: Run** the tests in `sf-mcp` and `ff-server`, then `npm run lint`, `npm run check:source`, and `npm run lint:prune` in `sf-mcp` (the recorded counts for `gameData.ts` should drop). Expected: PASS, and `gameData.ts` shorter than 469 lines.
- [ ] **Step 5: Commit [upstreamable], `sf-mcp` only:** `feat(mcp): accept several names in game-data lookup tools`.
- [ ] **Step 6: Prompt.** Add to "Research Efficiently": ``- `get_item`, `get_recipe`, `get_building`, `get_schematic` and `recipes_for` take a list (`names` / `items`); one batched call beats several single ones.`` Extend Task 2's test to assert `names`. Commit (Gaffer-only) `feat(server): tell the foreman to batch lookups`.
- [ ] **Step 7: Measure, append the results,** and open PR 4 (`Closes #37`).

### Task 5: Concurrent tool dispatch (PR 5, #39)

**Files:**
- Create: `packages/ff-server/src/llm/toolRunner.ts`
- Modify: `packages/ff-server/src/llm/chat.ts` (move `dispatchTool` and `ToolOutcome` out; the loop calls `runToolCalls`)
- Test: `packages/ff-server/test/toolRunner.test.ts`; existing `chat.test.ts` and `anthropic.test.ts` unchanged and passing

**Interfaces:**
- Produces:
  - `interface ToolRunContext { playthroughId: string; savePath?: string; deps: ChatDeps; events: ChatEvents }`. This is one options object, which clears the `max-params` suppression recorded for `chat.ts`.
  - `interface ToolOutcome { text: string; isError: boolean }`
  - `runToolCalls(calls: NeutralToolCall[], context: ToolRunContext): Promise<ToolOutcome[]>` returns outcomes in call order.
  - `const SEQUENTIAL_TOOL_RULES: ((name: string) => boolean)[] = [isWorkOrderTool]`. A tool is sequential if any rule matches. This is a table, so a future state-changing family is one entry.
  - `const MAX_CONCURRENT_TOOL_CALLS = 6`
- Behaviour:
  - `events.toolUse` fires for every call, in call order, before any dispatch.
  - Read-only calls run with at most 6 in flight. Sequential calls run one at a time in their original relative order, alongside the read-only group. Calls in one round were issued together, so none can depend on another's result.
  - `events.workOrder` fires as each sequential call completes, which is therefore in call order.
  - A dispatch that throws becomes `{ text: 'Tool <name> failed: <message>', isError: true }`, logged with the playthrough id and the tool name. The other calls continue.
  - The limiter is a small in-file worker pool, with no new dependency.

- [ ] **Step 1: Write the failing tests** with a fake gateway whose `callTool` waits for a per-name delay and tracks in-flight counts.
  - Results stay in call order: `[A 30 ms, B 10 ms, C 0 ms]` returns outcomes A, B, C, and the peak read-only in-flight count is 3.
  - The cap holds: 8 read-only calls never have more than 6 in flight.
  - Work orders run in order: `create_work_order`, `revise_work_order` and `block_work_order` (real `WorkOrderService` on a test DB) never overlap and complete in call order, and the `events.workOrder` order matches.
  - Errors are isolated: a throwing `get_recipe` gives `isError: true` while its neighbours succeed.
  - `toolUse` events arrive in call order.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** In `runChat`, push the `tool` messages from the returned array in order.
- [ ] **Step 4: Run** the tests, `npm run lint`, `npm run check:source`, and `npm run lint:prune` (the `chat.ts` `max-params` record should go). Expected: PASS.
- [ ] **Step 5: Commit [upstreamable]:** `perf(server): run a round's read-only tool calls concurrently`.
- [ ] **Step 6: Measure** (wall time should fall; tokens and rounds should be unchanged within noise), append the results, and open PR 5 (`Closes #39`).

### Task 6: Cached save summary (PR 6, #36)

Implements D1–D7. The work is split into four commits, in order.

**6a — `sf-save-data` [upstreamable]**
- Modify: `src/parser/types.ts` (`RawHeader.saveDateTime?: string`); the parser mapping that fills `RawHeader`; `src/normalise/types.ts` (`SaveState.savedAt?: string`, ISO 8601 UTC); `src/normalise/index.ts`.
- Check the library's `saveDateTime` format before writing the conversion. If it is a .NET tick count (100 ns intervals since 0001-01-01), convert to ISO. Keep the conversion in its own function, `saveDateTimeToIso(raw: string): string | undefined`, which returns `undefined` for an unparsable value and adds a `parseWarnings` entry.
- Test: `test/normalise.test.ts`: a known tick value gives the expected ISO string; garbage gives `undefined` plus a warning.
- Commit: `feat(save-data): carry the save's in-game timestamp`.

**6b — `sf-mcp` [upstreamable]**
- Create: `src/query/saveSummary.ts` with `buildSaveSummary(input: SaveSummaryInput): SaveSummary`, where `SaveSummaryInput = { state: SaveState; graph: SaveGraph; gameData: GameDataIndex; world: WorldQueries; resolve: NameResolver }`. It applies the D3 caps from the existing selectors (`playerSummary`, `milestones`, `unlockedRecipes`, `powerView`, `productionView`, `storageView`) and from `world.nearestResourceNodes` / `world.biomeAt`. It must not be added to `selectors.ts`, which is already 1,400 lines.
- Create: `src/tools/saveSummary.ts` with `registerSaveSummaryTool(server: McpServer, registry: SaveStoreRegistry, world: WorldQueries): void`, which registers `get_save_summary` (`{ savePath }`). Its description starts with "Host-internal:".
- Modify: `src/index.ts` (one registration line).
- `SaveSummary` (wire JSON; all distances in metres, rates per minute, power in MW):
  `{ save: { saveName, savedAt?, playDurationSeconds?, version }, player: { position?, biome?, within?, hub? }, progress: { highestTier, tierMilestones: string[], spaceElevatorPhase?, mamTrees: string[] }, recipes: { standardCount, alternateCount, alternates: string[], alternatesOmitted: number }, power: { capacityMw, consumptionMw, headroomMw, circuits, overloadedCircuits, generators: { type, count, mw }[] }, production: { item, perMinute, machines }[], storage: { item, quantity }[], nearbyResources: { resource, purity, distanceMetres, bearing, biome }[] }`
- Test: `test/saveSummary.test.ts`. Build from `emptySaveState` with fixtures for player, milestones, recipes, storage and production, following `saveTools.test.ts` and `production.test.ts`. Check that the caps hold with 40 storage items and 50 alternates (15 and 30 kept, `alternatesOmitted: 20`). An empty save gives empty lists, not throws. Lists are sorted deterministically, by value descending and then name ascending.
- Commit: `feat(mcp): add a host-internal save summary tool`.

**6c — `ff-server` (Gaffer-only)**
- Create: `src/context/saveSummarySchema.ts`: a zod schema for `SaveSummary`. Unknown or invalid input means no block, plus a warning.
- Create: `src/context/renderSaveSummary.ts` with `renderSaveSummary(summary: SaveSummary, uploadedAt: Date): string`. It is deterministic: fixed number formatting (MW to 1 decimal place, /min to 1 decimal place, metres as integers), absolute UTC timestamps, and the D5 heading. It ends with the line "For anything not listed here, or more detail, use the save tools."
- Create: `src/context/saveSummaryCache.ts` with `class SaveSummaryCache { constructor(mcp: McpGateway, capacity?: number); get(save: CurrentSave): Promise<string | undefined>; warm(save: CurrentSave): void; evict(saveId: string): void }`. It memoises the rendered string per `saveId` (LRU, capacity 32, keyed on promise so concurrent turns share one build) and drops the entry on failure.
- Create: `src/context/contextBlocks.ts` with `interface ContextContributor { source: 'save' | 'live'; build(request: ContextRequest): Promise<string | undefined> }`, `interface ContextRequest { playthroughId: string; currentSave?: CurrentSave }`, `buildContextBlocks(contributors: ContextContributor[], request: ContextRequest): Promise<string[]>` (in table order, skipping `undefined`), and `saveContributor(cache: SaveSummaryCache): ContextContributor`.
- Modify: `src/services/saveService.ts`: add `getCurrentSave(playthroughId): Promise<CurrentSave | undefined>`, where `CurrentSave = { id: string; path: string; uploadedAt: Date }`. Because the file is 453 lines, add only this method; if it would pass 500 lines, move the path helpers into `savePaths.ts` first.
- Modify: `src/routes/chat.ts`: the context is built in a new helper, `src/context/turnContext.ts` (`buildTurnContext(deps: AppDeps, playthroughId: string): Promise<{ savePath?: string; contextBlocks: string[] }>`), so the recorded route function doesn't grow.
- Modify: `src/routes/saves.ts` / `deps.ts`: wire `SaveSummaryCache`; `warm` after upload and after set-current; `evict` on delete.
- Modify: `src/llm/types.ts` (`LlmRequest.contextBlocks?: string[]`), `src/llm/chat.ts` (`ChatRequest.contextBlocks?: string[]`, passed through on every round, unchanged within the turn), `src/llm/anthropic.ts` (system becomes `[persona with cache_control, ...blocks]`, with `cache_control` on the last block only), `src/llm/openai.ts` (one extra `system` message per block, after the persona).
- Modify: `src/llm/chat.ts` `assembleTools`: filter out `HOST_INTERNAL_TOOLS = new Set(['describe_save', 'get_save_summary'])`. The direct dispatch path stays, as `saveService` still calls them.
- Tests:
  - `test/renderSaveSummary.test.ts`: the same input gives byte-identical output; the heading has both timestamps; there is no save-time clause when `savedAt` is absent; the **budget** holds, with a synthetic summary at every cap (long names of 40 characters) rendering to ≤ 4,800 characters.
  - `test/saveSummaryCache.test.ts`, with a counting fake gateway: two `get`s for the same save make one MCP call; a new `saveId` (re-upload) makes a new call and returns the new text; a failed call returns `undefined` and the next `get` retries; `evict` forces a rebuild; capacity 2 evicts the least recently used entry.
  - `test/anthropic.test.ts`: with `contextBlocks: ['X']`, `system` is two blocks, both `cache_control`; without blocks the request equals today's.
  - `test/openai-stream.test.ts` (or a new `openai-messages.test.ts`): a block becomes a second `system` message.
  - `test/chat.test.ts`: `describe_save` and `get_save_summary` from the MCP fake are not offered to the model.
  - `test/routes.test.ts`: upload save A, chat, upload save B, chat. The second request's `contextBlocks` reflect B (fake provider captures requests; fake MCP returns per-path summaries).
- Commit: `feat(server): give the foreman a cached save summary each turn`.

**6d — prompt (Gaffer-only)**
- Modify `SYSTEM_PROMPT.md` "Save State & Opportunities": open with "When a **Save snapshot** block follows this prompt, it already states the pioneer's position, tier and milestones, recipe counts, power totals, top production and storage, and the nearest resource nodes, as of that save. Use it for those, and do not call `get_player_state`, `get_milestones`, `get_unlocked_recipes`, `get_power`, `get_production` or `get_storage` for facts it gives. Call them for detail it lacks (inventory, per-machine lists, locations, per-circuit power). The snapshot is not live; say so when its age matters. Without the block, no save is loaded." Change "For 'near you' guidance, read the pioneer's position from `get_player_state`" to "…from the save snapshot".
- Test: `systemPrompt.test.ts` asserts `Save snapshot` and `do not call \`get_player_state\``.
- Commit: `feat(server): tell the foreman when the save snapshot is enough`.

- [ ] For each commit: write the tests first, run them (FAIL), implement, run them (PASS), run `npm run lint`, `npm run check:source` and `lint:prune` in each package touched, then commit.
- [ ] **Measure** `--runs 5 --scenario all`. Also record the rendered summary size, and the summed result sizes of the six replaced tools from the baseline, side by side. Append the results.
- [ ] Open PR 6 (`Closes #36`). After merge, re-scope or close siblings per CONTRIBUTING (in particular, comment on #36 with the measured size against the replaced tools).

## Review focus

1. **A save with no player position or no power** (fresh or creative save). The summary must omit those lines, not print `undefined` or `NaN`. Tests: Task 6b (empty save) and the 6c render test with optional fields absent.
2. **Two chat requests for the same playthrough at the same time, just after an upload.** They should share one summary build, not two. Test: in 6c `saveSummaryCache.test.ts`, two concurrent `get`s give one MCP call.
3. **A model that sends both `name` and `names`, or an empty `names`.** It should get a clear tool error, not a crash or a silent empty result. Test: Task 4, Step 1.
4. **A round that mixes `create_work_order` with lookups, where the lookup fails.** The work order must still be created and its SSE event sent. Test: Task 5, the errors-are-isolated case extended with a work-order call.
5. **A restart between turns.** The rebuilt summary must be byte-identical, or the provider cache misses. Test: 6c determinism (render the same JSON twice in fresh module state; compare against a stored expected string).
