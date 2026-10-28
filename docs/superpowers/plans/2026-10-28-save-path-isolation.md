# Save-path isolation implementation plan (#52)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent a model-supplied `savePath` from reaching sf-mcp, so that a chat turn reads only the save of its own playthrough.

**Architecture:** The ff-server package owns the `savePath` argument. It removes `savePath` from each MCP tool schema that it offers to the model. It also removes `savePath` from each model tool call before the call goes to MCP. Then the existing gateway code adds the host path if the playthrough has a current save. sf-mcp keeps its behaviour. It only documents that its registry checks containment, not ownership.

**Tech stack:** TypeScript (ESM), Express, MCP SDK, zod, Vitest.

**Spec:** issue #52 (`gh issue view 52 -R max-is-loud/ficsit-gaffer`) and the "Design" section below.

**Branch:** `bugfix/save-path-isolation`, one PR, `Closes #52`.

## Decisions for the user

Approve the plan with an answer to each decision. The plan uses the recommended option where you give no answer.

1. **No save attached.** When the playthrough has no current save, what does a save-tool call do?
   - **(a) Recommended:** ff-server drops the model's `savePath`. Then sf-mcp serves its default store. The default store is an empty state, or the fixed `SAVE_FILE_PATH` save if the operator sets one.
   - (b) ff-server refuses the save tools with the text "This playthrough has no save." The call does not reach sf-mcp.
2. **Host-vouched paths in sf-mcp.** Must sf-mcp serve only the paths that the host vouches for?
   - **(a) Recommended:** No, not in #52. sf-mcp documents that it checks containment only. The orchestrator files a follow-up issue about direct, unauthenticated access to sf-mcp on port 8723 (see Finding 3).
   - (b) Yes, now. Add an opt-in shared secret (`SAVE_PATH_SECRET`) to both containers. The ff-server package sends an HMAC of each path. sf-mcp refuses a path without a valid HMAC. This option adds Task 4 (outline below) and a config change.

## Citation check at `70908d3`

Each citation in #52, checked against `70908d3b2cf2dad492512370bd6ef4b6a64e1070`:

| Citation in #52 | Result | Note |
| --- | --- | --- |
| `packages/sf-mcp/src/tools/save.ts:50-53` | Correct | `savePathSchema`. 12 save tools use it (lines 93 to 286). `describe_save` (line 306) and `get_save_summary` (`tools/saveSummary.ts:124`) also take a `savePath`. ff-server hides and refuses these two host-internal tools (`ff-server/src/tools/hostInternalTools.ts:6`). |
| `packages/ff-server/src/mcp/client.ts:143` | Moved | Line 143 is `return this.cachedTools;`. The schema pass-through is at lines 148-152 (`inputSchema` at 151). `llm/chat.ts:149-151` then filters only by tool name. |
| `packages/ff-server/src/mcp/aggregateGateway.ts:82-84` | Correct lines, but not in the live path | `ff-server/src/index.ts:46` builds one `McpHttpClient`. Only `test/mcpAggregate.test.ts` uses `McpAggregateGateway`. The live injection is `client.ts:170-171`. |
| `packages/ff-server/src/mcp/client.ts:163` | Moved | Line 163 is the `context?: ToolCallContext` parameter. The injection is at lines 170-171. |
| `packages/ff-server/src/context/turnContext.ts:44-46` | Correct | Without a current save, the turn context has no `savePath`. |
| `packages/sf-mcp/src/store/registry.ts:36-45` | Moved | `allows` is at lines 36-41. `resolve` is at lines 43-70. Its containment decision is at lines 47-53. |
| `packages/sf-mcp/src/store/registry.ts:11-14` | Correct | `isWithin`. |
| `packages/ff-server/src/services/saveService.ts:40` | Correct | Line 40 is the doc comment. The code that builds the path is at line 68. Upload previews also go in `<saveDataDir>/.preview/` (line 245). |
| `compose.yaml:38`, `:81` | Moved | Line 38 is `environment:` and line 81 is a comment. sf-mcp sets `SAVE_DATA_DIR` at line 41 and mounts `foreman-saves:/data/saves` at line 49. ff-server does the same at lines 84 and 118. |

### Findings beyond the issue

1. **The one model-to-MCP path is `llm/toolRunner.ts:120`.** It sends `call.arguments` to `deps.mcp.callTool` without a change. The fix goes here.
2. **The gateway cannot tell model arguments from host arguments.** `saveService.ts:432` and `context/saveSummaryCache.ts:71` call `describe_save` and `get_save_summary` with `savePath` in `args` and no context. So the gateway must not remove `savePath` from all `args`.
3. **sf-mcp is reachable without authentication.** `compose.yaml:37` publishes port 8723 on the host. A direct MCP client can read any save under `SAVE_DATA_DIR` if it knows both IDs. #52 does not cover this path. Decision 2 covers it.
4. **`docs/playthroughs.md:121` says "the server overrides `savePath` on save-routed tool calls".** That was true only with a save attached. Task 2 corrects it.

## Design

| Proposal point in #52 | Chosen design | Alternative | Reason for the choice |
| --- | --- | --- | --- |
| 1. Remove `savePath` from the model-visible schemas | ff-server removes each host-managed property from each MCP tool schema in `assembleTools` (`llm/chat.ts`). A one-entry table, `HOST_MANAGED_ARGUMENTS = ['savePath']`, names the properties. | sf-mcp removes `savePath` from its schemas and reads the path from the MCP request `_meta`. | sf-mcp must keep `savePath` in its zod schema, because zod removes unknown keys before the handler runs. The `_meta` change touches the protocol of two packages and of every other sf-mcp host. The ff-server change meets the acceptance with one table and one function. |
| 2. Always override a model-supplied `savePath` | ff-server removes the host-managed arguments from each model call in `dispatchTool` (`llm/toolRunner.ts`). The gateway then adds the host path when one exists (no change to `client.ts`). With no save: Decision 1. | Change `McpHttpClient.callTool`: when a context is present, always replace or delete `args.savePath`. | The tool runner is the only place where model arguments enter (Finding 1). A gateway rule that depends on "a context object is present" is subtle, and the host calls in Finding 2 pass no context. |
| 3. sf-mcp serves only host-vouched paths | Decision 2, recommended (a): no behaviour change. Document the containment-only contract on `SaveStoreRegistry`, `savePathSchema` and the sf-mcp README. | An opt-in HMAC token (Decision 2 (b), Task 4). | After Tasks 1 and 2, no model argument reaches sf-mcp. sf-mcp has no data about playthrough ownership. Only a shared secret can prove a path came from the host, and that is a config change for its own issue. |

## Global constraints

- Obey `CONTRIBUTING.md` › Code standards. In summary:
  - Each non-test file starts with a header comment.
  - A file has at most 500 lines.
  - A function has at most 60 lines, depth 3, complexity 12 and 4 parameters.
  - Add a new kind of thing as a table entry, not as an `if` arm.
  - Use no `any`, always use braces, and write British English.
- Do not add to `source-limits.json` or `eslint-suppressions.json`. Do not raise a count. Do not add an ESLint suppression.
- Before each commit, run `npm run lint`, `npm run check:source` and `npm test` in each package that you changed.
- Conventional Commits with a body. Each commit ends with `Refs #52` and the `Co-Authored-By` line.
- Upstreamable commits (marked **[upstreamable]**) touch only generic code and docs. They hold no Gaffer-only lines. The sf-mcp commit (Task 3) touches only `packages/sf-mcp/`.
- The tool list must stay byte-identical across the turns of one playthrough, so the prompt cache stays valid. The schema filter must be deterministic and must not change the cached tool objects in `McpHttpClient`.
- The work-order and live tools are local. Do not filter their schemas.

## Review focus

1. A model `savePath` that is an empty string, a number, `null` or an object. The tool runner removes the key for each value type.
2. A tool schema that lists `savePath` in `required` (for example, `describe_save`). The filter also removes it from `required`, so the schema stays valid for the provider. The filter removes an empty `required` array.
3. The cached tool objects of `McpHttpClient`. The filter returns copies and does not change the originals. Two calls give equal output.
4. A save attached and a model `savePath` that points at another playthrough. The host path wins (this must not regress).
5. A game-data tool call that carries `savePath`. The tool runner removes the key. The call still goes to MCP with its other arguments unchanged.

Task 1 tests items 1, 2, 3 and 5 as unit tests. Task 2 tests item 4 and the acceptance through `runChat`.

---

### Task 1: Host-managed arguments table and filters (ff-server) **[upstreamable]**

**Files:**
- Create: `packages/ff-server/src/tools/hostManagedArguments.ts`
- Modify: `packages/ff-server/src/llm/chat.ts:139-157` (`assembleTools`)
- Test: `packages/ff-server/test/hostManagedArguments.test.ts`

**Interfaces:**
- Consumes: `ToolDefinition` from `packages/ff-server/src/mcp/client.ts`.
- Produces:
  - `withoutHostManagedProperties(tool: ToolDefinition): ToolDefinition`. It returns a copy of `tool` without the host-managed keys in `inputSchema.properties` and in `inputSchema.required`. It returns the same object when the schema has no host-managed key.
  - `withoutHostManagedArguments(args: Record<string, unknown>): Record<string, unknown>`. It returns a copy of `args` without the host-managed keys.
  - `hasHostManagedArgument(tool: ToolDefinition): boolean`. It is true when the schema has a host-managed property. Only Task 2 variant (b) uses it. Do not add it for variant (a).

- [ ] **Step 1: Write the failing unit tests**

In `packages/ff-server/test/hostManagedArguments.test.ts`:

```ts
const playerState: ToolDefinition = {
  name: 'get_player_state',
  description: 'd',
  inputSchema: {
    type: 'object',
    properties: { savePath: { type: 'string' }, location: { type: 'object' } },
    required: ['location', 'savePath'],
  },
};

it('removes savePath from the properties and the required list', () => {
  const filtered = withoutHostManagedProperties(playerState);
  expect(filtered.inputSchema).toEqual({
    type: 'object',
    properties: { location: { type: 'object' } },
    required: ['location'],
  });
});

it('removes an empty required list', () => {
  const onlyPath = { ...playerState, inputSchema: { type: 'object', properties: { savePath: { type: 'string' } }, required: ['savePath'] } };
  expect(withoutHostManagedProperties(onlyPath).inputSchema).toEqual({ type: 'object', properties: {} });
});

it('does not change the original tool and is deterministic', () => {
  const before = structuredClone(playerState);
  const first = withoutHostManagedProperties(playerState);
  expect(playerState).toEqual(before);
  expect(withoutHostManagedProperties(playerState)).toEqual(first);
});

it('returns the same object for a tool without host-managed properties', () => {
  const recipe: ToolDefinition = { name: 'get_recipe', description: 'r', inputSchema: { type: 'object' } };
  expect(withoutHostManagedProperties(recipe)).toBe(recipe);
});

it.each(['', 42, null, { path: '/data/saves/a/b.sav' }, '/data/saves/a/b.sav'])(
  'removes a model savePath of value %j',
  (value) => {
    expect(withoutHostManagedArguments({ savePath: value, name: 'Iron Plate' })).toEqual({ name: 'Iron Plate' });
  },
);
```

Add one `runChat` test for `assembleTools` to `packages/ff-server/test/hostInternalTools.test.ts`. Its `runRound` harness already sets `mcp.listTools`. The test does these steps:

1. List `get_player_state` with the schema above.
2. Assert that `provider.requests[0].tools` has a `get_player_state` entry.
3. Assert that the `inputSchema.properties` of that entry has no `savePath` key.

- [ ] **Step 2: Run the tests and make sure that they fail**

Run: `npm test -w @foreman/ff-server -- hostManagedArguments hostInternalTools`
Expected: FAIL. The module `../src/tools/hostManagedArguments.js` does not exist.

- [ ] **Step 3: Implement the filters**

Create `hostManagedArguments.ts` with a header comment: "Arguments that only the host may set (the save path). The chat loop hides them from the model's tool schemas, and the tool runner removes them from the model's calls." Keep the names in `const HOST_MANAGED_ARGUMENTS: ReadonlySet<string> = new Set(['savePath'])`. Each export gets a doc comment with its contract. Read `properties` and `required` as `unknown` and narrow them (`isRecord`, `Array.isArray`). Do not use `any`.

In `assembleTools` (`llm/chat.ts`), map the filtered MCP tools through `withoutHostManagedProperties`. Add one clause to the doc comment of `assembleTools`: "it removes host-managed arguments from the MCP schemas".

- [ ] **Step 4: Run the tests and make sure that they pass**

Run: `npm test -w @foreman/ff-server -- hostManagedArguments hostInternalTools`
Expected: PASS.

- [ ] **Step 5: Run the checks and commit**

Run: `npm run lint && npm run check:source && npm test` in `packages/ff-server`. Expected: no errors.

```bash
git add packages/ff-server/src/tools/hostManagedArguments.ts packages/ff-server/src/llm/chat.ts \
  packages/ff-server/test/hostManagedArguments.test.ts packages/ff-server/test/hostInternalTools.test.ts
git commit   # fix(server): hide host-managed arguments from the model's tool schemas
```

### Task 2: Remove model `savePath` at dispatch, with the regression test (ff-server) **[upstreamable]**

**Files:**
- Modify: `packages/ff-server/src/llm/toolRunner.ts:119-120` (`dispatchTool`)
- Modify: `docs/playthroughs.md:121` (Finding 4)
- Test: `packages/ff-server/test/savePathIsolation.test.ts`

**Interfaces:**
- Consumes: `withoutHostManagedArguments` from Task 1. For variant (b) only: `hasHostManagedArgument` from Task 1.
- Produces: no new export. For variant (b) only: `ToolRunContext` gets `saveToolNames?: ReadonlySet<string>` (the MCP tools for which `hasHostManagedArgument` is true). `runChat` builds it from the listed MCP tools.

- [ ] **Step 1: Write the failing regression test**

In `packages/ff-server/test/savePathIsolation.test.ts`, run one chat turn through `runChat` (use the pattern of `test/hostInternalTools.test.ts`: a test database, `FakeLlmProvider`, and a gateway). The gateway emulates the sf-mcp registry for `get_player_state`:

```ts
const OTHER_SAVE = '/data/saves/other-playthrough/other-save.sav';
const OWN_SAVE = '/data/saves/own-playthrough/own-save.sav';

/** Lists get_player_state with a savePath property; answers with the data of the save it receives. */
function saveMcp(): McpGateway & { calls: { args: Record<string, unknown>; context?: ToolCallContext }[] } {
  // listTools → [{ name: 'get_player_state', inputSchema: { type: 'object', properties: { savePath: { type: 'string' } } } }]
  // callTool(name, args, context): record the call; the effective path is context?.savePath ?? args.savePath
  //   (the same rule as McpHttpClient.callTool); return `data of ${effectivePath ?? 'default save'}`.
}
```

Tests:

```ts
it('does not return another playthrough save when no save is attached', async () => {
  // runChat with savePath undefined; the model calls get_player_state with { savePath: OTHER_SAVE }
  expect(mcp.calls[0]?.args).not.toHaveProperty('savePath');
  expect(toolResultText(provider)).not.toContain(OTHER_SAVE);
  expect(toolResultText(provider)).toBe('data of default save');            // variant (a)
  // variant (b) instead: expect(mcp.calls).toHaveLength(0) and the text 'This playthrough has no save.'
});

it('reads the attached save, not the model path, when a save is attached', async () => {
  // runChat with savePath OWN_SAVE; the model calls get_player_state with { savePath: OTHER_SAVE }
  expect(toolResultText(provider)).toBe(`data of ${OWN_SAVE}`);
});

it('offers get_player_state to the model without a savePath property', async () => {
  const offered = provider.requests[0]?.tools.find((tool) => tool.name === 'get_player_state');
  expect(offered?.inputSchema).not.toHaveProperty('properties.savePath');
});
```

`toolResultText(provider)` returns the `content` of the `tool` message in `provider.requests[1].messages`.

- [ ] **Step 2: Run the test and make sure that it fails**

Run: `npm test -w @foreman/ff-server -- savePathIsolation`
Expected: FAIL. The first test receives `data of /data/saves/other-playthrough/other-save.sav`. The third test passes already because of Task 1.

- [ ] **Step 3: Implement the dispatch change**

Variant (a): in `dispatchTool`, pass `withoutHostManagedArguments(call.arguments)` to `deps.mcp.callTool`. Change the comment above the call to this text: "Remove host-managed arguments from the model's call. The gateway adds the host's savePath."

Variant (b): also add one entry to a refusal table, not a new `if` chain. Before the MCP call, when `context.savePath === undefined` and `context.saveToolNames?.has(call.name)`, return `{ text: 'This playthrough has no save.', isError: true }`. Keep `dispatchTool` at complexity 12 or less. If it goes above, move the MCP branch into a helper `dispatchMcpTool(call, context)`.

- [ ] **Step 4: Run the tests and make sure that they pass**

Run: `npm test -w @foreman/ff-server -- savePathIsolation toolRunner hostInternalTools chat`
Expected: PASS.

- [ ] **Step 5: Correct the doc**

In `docs/playthroughs.md:121`, replace "the server overrides `savePath` on save-routed tool calls". Use this text: "the server removes `savePath` from the model's tool schemas and calls, and injects its own path".

- [ ] **Step 6: Run the checks and commit**

Run: `npm run lint && npm run check:source && npm test` in `packages/ff-server`. Expected: no errors.

```bash
git add packages/ff-server/src/llm/toolRunner.ts packages/ff-server/test/savePathIsolation.test.ts docs/playthroughs.md
git commit   # fix(server): drop model-supplied save paths before MCP calls
```

### Task 3: Document the containment-only contract (sf-mcp) **[upstreamable]**

This task changes comments and the README only. It has no test cycle. It is a separate commit so that it can go upstream alone.

**Files:**
- Modify: `packages/sf-mcp/src/store/registry.ts:17-25` (the `SaveStoreRegistry` doc comment)
- Modify: `packages/sf-mcp/src/tools/save.ts:47-49` (the comment above `savePathSchema`)
- Modify: `packages/sf-mcp/README.md:68-70`

**Interfaces:** no change.

- [ ] **Step 1: Edit the comments and the README**

Add the same contract to each place, in two or three sentences. Use this text: "The registry checks only that a path is inside `SAVE_DATA_DIR`. It does not check which playthrough or user owns the save. A host must never forward a `savePath` from the model; it must remove it and inject its own." Do not change any code line.

- [ ] **Step 2: Run the checks**

Run: `npm run lint && npm run check:source && npm test` in `packages/sf-mcp`. Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/sf-mcp/src/store/registry.ts packages/sf-mcp/src/tools/save.ts packages/sf-mcp/README.md
git commit   # docs(sf-mcp): state that the save registry checks containment, not ownership
```

### Task 4 (only for Decision 2 (b)): Opt-in HMAC for host-vouched paths

Do this task only if the user chooses Decision 2 (b). It needs its own approval of the detailed steps before work starts, because it adds a config secret to two containers. Outline:

| Commit | Package | Content |
| --- | --- | --- |
| `feat(sf-mcp): refuse unsigned save paths when SAVE_PATH_SECRET is set` **[upstreamable]** | `sf-mcp` | `config.ts` reads `SAVE_PATH_SECRET`. `SaveStoreRegistry.resolve` takes an optional `savePathToken` and serves the path only when `HMAC-SHA256(secret, absolutePath)` matches (`crypto.timingSafeEqual`). Without the secret, the behaviour does not change. Tests in `test/registry.test.ts`. |
| `feat(server): sign the injected save path` | `ff-server` | `McpHttpClient.callTool` and the two host calls add `savePathToken`. Tests in `test/mcp-client.test.ts`. |
| `chore: share SAVE_PATH_SECRET between sf-mcp and ff-server` | Gaffer-only | `compose.yaml` and the READMEs. |

## Order of work and commits

| Order | Commit | Upstream? |
| --- | --- | --- |
| 1 | Task 1: `fix(server): hide host-managed arguments from the model's tool schemas` | **[upstreamable]**. Upstream ff-server has no `hostInternalTools.ts`, so the commit can need a small adaptation there. |
| 2 | Task 2: `fix(server): drop model-supplied save paths before MCP calls` | **[upstreamable]** |
| 3 | Task 3: `docs(sf-mcp): state that the save registry checks containment, not ownership` | **[upstreamable]**, `packages/sf-mcp/` only |
| 4 | Task 4 commits, only for Decision 2 (b) | See Task 4 |

Tasks 1 and 2 close the hole. Task 3 is independent and can come in any position. No task in this plan holds Gaffer-only lines, except the Task 4 config commit.

## Verification before the PR

Run the project verification list from `docs/workflow/project.md`, commands 1 to 5, at the branch head. Expected: each command passes. This plan does not change the bridge receiver. Run command 6 only if a file under `integrations/` changed.

## Remaining risks

- With Decision 1 (a), a deployment that sets `SAVE_FILE_PATH` shows that fixed save to each playthrough without a save. This is the behaviour before #52 too, and it is the operator's configuration choice.
- `McpAggregateGateway` stays in the code, but no production path uses it. This plan does not delete it, because #52 does not need that change.
- Direct access to sf-mcp on port 8723 stays open with Decision 2 (a) (Finding 3).
