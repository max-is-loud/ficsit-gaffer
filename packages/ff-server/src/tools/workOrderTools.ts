// The server-local work-order tools the foreman calls: their JSON Schema definitions and handlers,
// plus the checks run when a plan is ingested (game-data name resolution, recipe derivation, power
// verification).

import { randomUUID } from 'node:crypto';

import type { McpGateway, ToolDefinition } from '../mcp/client.js';
import type { BuildCostLine, RecipeAssignment, RecipeItemRate, WorkOrder } from '../types.js';
import {
  formatWorkOrderLabel,
  type UpdatePlanInput,
  type WorkOrderOutcome,
  type WorkOrderService,
} from '../services/workOrderService.js';
import {
  blockToolSchema,
  exploreOrderCreateSchema,
  proposeCompletionSchema,
  reviseToolSchema,
  supersedeToolSchema,
  unblockToolSchema,
  workOrderCreateSchema,
} from '../validation.js';
import type { ExploreCollectible, ExploreWaypoint } from '../types.js';

/** Dependencies the work-order tool handlers need. */
export interface WorkOrderToolDeps {
  workOrders: WorkOrderService;
  /** Current game data version, stamped onto newly-issued orders. */
  gameVersion: () => string;
  /** MCP gateway — resolves every game-data name in a plan (buildings, recipes, items,
   * schematics) and enriches buildable build costs, rejecting the order on any miss. */
  mcp: McpGateway;
}

/** Outcome of a work-order tool call: text for the model, struct for the UI. */
export interface WorkOrderToolOutcome {
  text: string;
  isError: boolean;
  /** The affected order, surfaced to the client over SSE. */
  workOrder?: WorkOrder;
}

export const CREATE_WORK_ORDER = 'create_work_order';
export const PROPOSE_COMPLETION = 'propose_completion';
export const REVISE_WORK_ORDER = 'revise_work_order';
export const BLOCK_WORK_ORDER = 'block_work_order';
export const UNBLOCK_WORK_ORDER = 'unblock_work_order';
export const SUPERSEDE_WORK_ORDER = 'supersede_work_order';
export const CREATE_CHILD_WORK_ORDER = 'create_child_work_order';
export const CREATE_EXPLORE_ORDER = 'create_explore_order';

const WORK_ORDER_TOOL_NAMES = new Set<string>([
  CREATE_WORK_ORDER,
  PROPOSE_COMPLETION,
  REVISE_WORK_ORDER,
  BLOCK_WORK_ORDER,
  UNBLOCK_WORK_ORDER,
  SUPERSEDE_WORK_ORDER,
  CREATE_CHILD_WORK_ORDER,
  CREATE_EXPLORE_ORDER,
]);

/** True when `name` is one of the server-local work-order tools. */
export function isWorkOrderTool(name: string): boolean {
  return WORK_ORDER_TOOL_NAMES.has(name);
}

// --- JSON Schema fragments for tool inputs ---------------------------------

const expectedOutputItemSchema = {
  oneOf: [
    {
      type: 'object',
      properties: {
        kind: { const: 'item' },
        item: { type: 'string' },
        perMinute: { type: 'number' },
        unit: { type: 'string' },
      },
      required: ['kind', 'item', 'perMinute'],
    },
    {
      type: 'object',
      properties: { kind: { const: 'power' }, megawatts: { type: 'number' } },
      required: ['kind', 'megawatts'],
    },
    {
      type: 'object',
      properties: { kind: { const: 'unlock' }, schematic: { type: 'string' } },
      required: ['kind', 'schematic'],
    },
    {
      type: 'object',
      properties: { kind: { const: 'infrastructure' }, description: { type: 'string' } },
      required: ['kind', 'description'],
    },
  ],
};

const buildablesSchema = {
  type: 'array',
  description:
    'The buildables this step requires — every machine AND logistics piece (belts, splitters, mergers, pipes, poles), each with how many to build. Enumerate per consumer: e.g. an 8-generator plant needs a splitter and a merger PER generator, and belts feeding each machine — not one or two of each. For a PRODUCTION machine, set recipeName to the exact recipe it runs, and split machines that differ by recipe into separate blocks (not one "16 Constructors" entry but four blocks of 4, each with its own recipe). Do NOT include build-cost materials or per-minute rates; the server resolves build cost and derives production rates from recipe × count automatically.',
  items: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Building display name, e.g. "Coal Generator".' },
      requiredCount: { type: 'integer', minimum: 0 },
      recipeName: {
        type: 'string',
        description:
          'For a production machine, the exact recipe this block runs (e.g. "Iron Plate"). One recipe per block. Omit for logistics/storage/generators.',
      },
      notes: { type: 'string' },
    },
    required: ['name', 'requiredCount'],
  },
};

const stepsSchema = {
  type: 'array',
  description:
    'Ordered build steps; each is checkable and holds the buildables (with counts) it requires.',
  items: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      description: { type: 'string' },
      buildables: buildablesSchema,
    },
    required: ['title'],
  },
};

const coordProps = {
  type: 'object',
  properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
  required: ['x', 'y'],
};

const resourceNodesToolSchema = {
  type: 'array',
  description:
    'Resource nodes this order should tap — look them up with nearest_resource_nodes. Name the resource and, where known, its purity and coordinates, so the pioneer knows exactly where to mine.',
  items: {
    type: 'object',
    properties: {
      resourceName: {
        type: 'string',
        description: 'Exact item/resource display name, e.g. "Iron Ore".',
      },
      purity: { type: 'string', enum: ['impure', 'normal', 'pure'] },
      coordinates: coordProps,
      notes: { type: 'string' },
    },
    required: ['resourceName'],
  },
};

const collectibleOpportunityToolSchema = {
  type: 'object',
  properties: {
    kind: {
      type: 'string',
      enum: [
        'mercerSphere',
        'somersloop',
        'powerSlugBlue',
        'powerSlugYellow',
        'powerSlugPurple',
        'hardDrive',
      ],
    },
    coordinates: coordProps,
    distance: { type: 'number', description: 'Metres from the reference point.' },
    reason: { type: 'string' },
    optional: { type: 'boolean', description: 'Nice-to-grab vs on the critical path.' },
  },
  required: ['kind', 'optional'],
};

const opportunitiesToolSchema = {
  type: 'object',
  description:
    'Optional side-quests surfaced from the world + save tools (get_nearby / nearest_collectibles — already-collected ones are removed). Omit any group you have no data for; never guess coordinates.',
  properties: {
    nearbyCollectiblesFromPlayer: {
      type: 'array',
      description: 'Un-collected collectibles near the pioneer (needs a loaded save).',
      items: collectibleOpportunityToolSchema,
    },
    nearbyCollectiblesFromWorkOrderLocation: {
      type: 'array',
      description: 'Un-collected collectibles near this order build site.',
      items: collectibleOpportunityToolSchema,
    },
    overclockingOptions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          target: { type: 'string' },
          recommendation: { type: 'string' },
          powerShardCount: { type: 'integer' },
          expectedEffect: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['target', 'recommendation'],
      },
    },
    awesomeShopSuggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          itemName: { type: 'string' },
          reason: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
        required: ['itemName', 'reason'],
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
};

const planProperties: Record<string, unknown> = {
  title: { type: 'string', description: 'Short, memorable title.' },
  goal: { type: 'string', description: 'One concise sentence — the purpose of the order.' },
  objective: { type: 'string', description: 'A fuller instruction of what to accomplish.' },
  strategicSignificance: { type: 'string', description: 'Why this work matters now.' },
  successCondition: { type: 'string', description: 'The specific condition that means done.' },
  tier: { type: 'integer', minimum: 0, maximum: 9, description: 'Satisfactory milestone tier.' },
  locationRecommendation: {
    type: 'object',
    properties: {
      summary: { type: 'string' },
      coordinates: {
        type: 'object',
        properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } },
        required: ['x', 'y'],
      },
      relativeToPlayer: { type: 'string' },
      rationale: { type: 'string' },
    },
    required: ['summary'],
  },
  resourceNodes: resourceNodesToolSchema,
  buildSteps: stepsSchema,
  expectedOutputs: {
    type: 'array',
    description:
      'What the order produces. Use kind=power (MW) as the hero output for power plants.',
    items: expectedOutputItemSchema,
  },
  opportunities: opportunitiesToolSchema,
  notes: {
    type: 'array',
    description: 'Freeform foreman build notes / guidance shown alongside the order.',
    items: { type: 'string' },
  },
};

/**
 * Anthropic tool definitions for the foreman's work-order capabilities. Merged
 * with the MCP game-data tools when calling the model. Completion is Pioneer-
 * only (Option A): the foreman may only PROPOSE completion, never close out.
 */
export function workOrderToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: CREATE_WORK_ORDER,
      description:
        'Issue a NEW work order — a specific, self-contained task with everything needed to start. Use this ONLY for genuinely new work. To change the order the pioneer is already on (add/edit a step, swap a recipe, adjust counts, change the goal), call revise_work_order instead — do NOT create a second order. It starts in the `new` state for the pioneer to begin; it does NOT abandon any existing order (use supersede_work_order for that). Annotate each production buildable with its exact recipe (split machines by recipe into separate blocks) and use the game-data + save-game tools to choose recipes, get counts right, and size power before issuing — the server derives per-minute rates and build costs, so do not author them.',
      inputSchema: {
        type: 'object',
        properties: planProperties,
        required: ['title', 'goal'],
      },
    },
    {
      name: PROPOSE_COMPLETION,
      description:
        'Suggest to the pioneer that the active work order looks finished. This does NOT complete it — only the pioneer may complete a work order. Use when the build appears done and you want to prompt them to confirm.',
      inputSchema: {
        type: 'object',
        properties: {
          workOrderId: { type: 'string', description: 'Target order; defaults to the active one.' },
          note: { type: 'string', description: 'Why you think it is complete.' },
        },
      },
    },
    {
      name: REVISE_WORK_ORDER,
      description:
        "Revise the current order's plan (any plan fields). Defaults to the order the pioneer is on — use this whenever they ask to adjust, add to, or change the active work order, rather than issuing a new one. IMPORTANT: a field you send REPLACES that field wholesale — to change buildSteps, send the COMPLETE current set of steps plus your change, not just the new/changed step, or the omitted steps are dropped (checklist progress on surviving steps is preserved by id). Creates a new revision the pioneer acknowledges. Provide a changeSummary describing what changed and why.",
      inputSchema: {
        type: 'object',
        properties: {
          workOrderId: { type: 'string', description: 'Target order; defaults to the active one.' },
          ...planProperties,
          changeSummary: { type: 'string', description: 'What changed since the last revision.' },
        },
      },
    },
    {
      name: BLOCK_WORK_ORDER,
      description:
        'Mark an order blocked when it cannot continue. Always supply a clear reason and a resolution hint (e.g. a prerequisite child order).',
      inputSchema: {
        type: 'object',
        properties: {
          workOrderId: { type: 'string' },
          blockedReason: { type: 'string' },
          blockedResolutionHint: { type: 'string' },
        },
        required: ['blockedReason', 'blockedResolutionHint'],
      },
    },
    {
      name: UNBLOCK_WORK_ORDER,
      description: 'Clear a block once resolved. Supply a note on how it was resolved.',
      inputSchema: {
        type: 'object',
        properties: {
          workOrderId: { type: 'string' },
          resolutionNote: { type: 'string' },
        },
        required: ['resolutionNote'],
      },
    },
    {
      name: SUPERSEDE_WORK_ORDER,
      description:
        'Replace an order with a newer strategic instruction. Issue the replacement with create_work_order first, then supersede the old one referencing the new id.',
      inputSchema: {
        type: 'object',
        properties: {
          workOrderId: { type: 'string', description: 'The order being superseded.' },
          supersededByWorkOrderId: { type: 'string', description: 'The replacement order id.' },
          supersededReason: { type: 'string' },
        },
        required: ['supersededByWorkOrderId', 'supersededReason'],
      },
    },
    {
      name: CREATE_CHILD_WORK_ORDER,
      description:
        'Create a prerequisite/supporting child of a parent order (e.g. hard-drive hunt, MAM research, resource gathering). Often paired with block_work_order on the parent. Completing the child auto-unblocks a blocked parent.',
      inputSchema: {
        type: 'object',
        properties: {
          parentWorkOrderId: {
            type: 'string',
            description: 'Parent; defaults to the active order.',
          },
          relationshipToParent: {
            type: 'string',
            enum: [
              'prerequisite',
              'exploration',
              'hard_drive_hunt',
              'mam_research',
              'resource_gathering',
              'infrastructure_support',
              'corrective_action',
            ],
          },
          ...planProperties,
        },
        required: ['title', 'goal', 'relationshipToParent'],
      },
    },
    {
      name: CREATE_EXPLORE_ORDER,
      description:
        'Issue an EXPLORE order — a collection route the pioneer travels to grab collectibles (Mercer Spheres, Somersloops, power slugs, hard drives, customizer helmet/tapes), standalone or as a child of a work order (relationshipToParent "exploration"/"hard_drive_hunt"). Use this instead of create_work_order when the task is collecting/looting, not building. Find collectibles with nearest_collectibles / list_collectibles and reference each by its `id`; the server derives its kind, coordinates, and — for hard-drive pods — the unlock COST to open it, and rejects unknown ids (so a pod waypoint always shows what to bring). Group collectibles into ordered waypoints.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short, memorable title.' },
          goal: { type: 'string', description: 'One sentence — what the route is for.' },
          objective: { type: 'string' },
          strategicSignificance: { type: 'string' },
          successCondition: { type: 'string' },
          tier: { type: 'integer', minimum: 0, maximum: 9 },
          notes: { type: 'array', items: { type: 'string' } },
          waypoints: {
            type: 'array',
            description:
              'Ordered stops on the route. Each groups the collectibles grabbable there; the server fills in each collectible’s facts from its id.',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                order: { type: 'integer' },
                coordinates: coordProps,
                relativeToPlayer: { type: 'string' },
                notes: { type: 'string' },
                collectibles: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: {
                        type: 'string',
                        description:
                          'Stable collectible id from nearest_collectibles / list_collectibles.',
                      },
                      reason: { type: 'string', description: 'Why it is worth grabbing.' },
                    },
                    required: ['id'],
                  },
                },
              },
              required: ['collectibles'],
            },
          },
          parentWorkOrderId: { type: 'string' },
          relationshipToParent: {
            type: 'string',
            enum: [
              'prerequisite',
              'exploration',
              'hard_drive_hunt',
              'mam_research',
              'resource_gathering',
              'infrastructure_support',
              'corrective_action',
            ],
          },
        },
        required: ['title', 'goal', 'waypoints'],
      },
    },
  ];
}

/**
 * Validates and executes a work-order tool call. Returns a text result for the
 * model to read back and, where relevant, the affected order for the client.
 */
export async function handleWorkOrderTool(
  playthroughId: string,
  name: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  switch (name) {
    case CREATE_WORK_ORDER:
      return handleCreate(playthroughId, input, deps);
    case PROPOSE_COMPLETION:
      return handleProposeCompletion(playthroughId, input, deps);
    case REVISE_WORK_ORDER:
      return handleRevise(playthroughId, input, deps);
    case BLOCK_WORK_ORDER:
      return handleBlock(playthroughId, input, deps);
    case UNBLOCK_WORK_ORDER:
      return handleUnblock(playthroughId, input, deps);
    case SUPERSEDE_WORK_ORDER:
      return handleSupersede(playthroughId, input, deps);
    case CREATE_CHILD_WORK_ORDER:
      return handleCreateChild(playthroughId, input, deps);
    case CREATE_EXPLORE_ORDER:
      return handleCreateExplore(playthroughId, input, deps);
    default:
      return { text: `Unknown work-order tool '${name}'.`, isError: true };
  }
}

async function handleCreate(
  playthroughId: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  const parsed = workOrderCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { text: `Invalid create_work_order arguments: ${parsed.error.message}`, isError: true };
  }
  const enrich = await resolvePlanReferences(parsed.data, deps.mcp);
  if (!enrich.ok) {
    return { text: enrich.message, isError: true };
  }
  const derived = await deriveRecipes(parsed.data, deps.mcp);
  if (!derived.ok) {
    return { text: derived.message, isError: true };
  }
  const power = await verifyPlanPower(parsed.data, deps.mcp);
  if (!power.ok) {
    return { text: power.message, isError: true };
  }
  const order = await deps.workOrders.create(playthroughId, parsed.data, deps.gameVersion());
  const label = formatWorkOrderLabel(order.sequenceNumber);
  const advisory = outputAdvisory(parsed.data);
  const advisoryText = advisory !== undefined ? `\n\n${advisory}` : '';
  return {
    text: `Issued ${label}: "${order.title}" (state: new). Tell the pioneer it is ready to start.${advisoryText}`,
    isError: false,
    workOrder: order,
  };
}

async function handleProposeCompletion(
  playthroughId: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  const parsed = proposeCompletionSchema.safeParse(input);
  if (!parsed.success) {
    return { text: `Invalid propose_completion arguments: ${parsed.error.message}`, isError: true };
  }
  const target = await resolveTargetId(deps, playthroughId, parsed.data.workOrderId);
  if (target.error !== undefined) {
    return { text: target.error, isError: true };
  }
  const outcome = await deps.workOrders.proposeCompletion(
    playthroughId,
    target.id,
    parsed.data.note,
  );
  return mapOutcome(outcome, (order) => ({
    text: `Proposed completion of ${formatWorkOrderLabel(order.sequenceNumber)}. Ask the pioneer to confirm — only they can mark it complete.`,
    workOrder: order,
  }));
}

async function handleRevise(
  playthroughId: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  const parsed = reviseToolSchema.safeParse(input);
  if (!parsed.success) {
    return { text: `Invalid revise_work_order arguments: ${parsed.error.message}`, isError: true };
  }
  const target = await resolveTargetId(deps, playthroughId, parsed.data.workOrderId);
  if (target.error !== undefined) {
    return { text: target.error, isError: true };
  }
  const { workOrderId: _id, changeSummary, ...patch } = parsed.data;
  void _id;
  const enrich = await resolvePlanReferences(patch, deps.mcp);
  if (!enrich.ok) {
    return { text: enrich.message, isError: true };
  }
  const derived = await deriveRecipes(patch, deps.mcp);
  if (!derived.ok) {
    return { text: derived.message, isError: true };
  }
  // Cross-field checks (power, output shortfall) must see the MERGED order, not just the
  // patch: a target-only revise ("2400 MW") is otherwise never compared to the existing
  // generators. Overlay the patch onto the current order with the same field semantics
  // updatePlan uses (a present field replaces; an absent one keeps the existing value).
  const existing = await deps.workOrders.get(playthroughId, target.id);
  const effective: PlanInput =
    existing === undefined
      ? patch
      : {
          buildSteps: patch.buildSteps ?? existing.buildSteps,
          expectedOutputs: patch.expectedOutputs ?? existing.expectedOutputs,
          recipes: patch.recipes ?? existing.recipes,
        };
  const power = await verifyPlanPower(effective, deps.mcp);
  if (!power.ok) {
    return { text: power.message, isError: true };
  }
  const meta = changeSummary !== undefined ? { changeSummary } : {};
  const outcome = await deps.workOrders.updatePlan(
    playthroughId,
    target.id,
    patch as UpdatePlanInput,
    'Foreman',
    meta,
  );
  const notes = [
    outputAdvisory(effective),
    droppedContentAdvisory(patch.buildSteps, existing?.buildSteps),
  ].filter((n): n is string => n !== undefined);
  const advisoryText = notes.length > 0 ? `\n\n${notes.join('\n\n')}` : '';
  return mapOutcome(outcome, (order) => ({
    text: `Revised ${formatWorkOrderLabel(order.sequenceNumber)} (now revision ${order.currentRevision}). The pioneer will see a plan-changed notice to acknowledge.${advisoryText}`,
    workOrder: order,
  }));
}

async function handleBlock(
  playthroughId: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  const parsed = blockToolSchema.safeParse(input);
  if (!parsed.success) {
    return { text: `Invalid block_work_order arguments: ${parsed.error.message}`, isError: true };
  }
  const target = await resolveTargetId(deps, playthroughId, parsed.data.workOrderId);
  if (target.error !== undefined) {
    return { text: target.error, isError: true };
  }
  const outcome = await deps.workOrders.transition(playthroughId, target.id, 'Block', 'Foreman', {
    blockedReason: parsed.data.blockedReason,
    blockedResolutionHint: parsed.data.blockedResolutionHint,
  });
  return mapOutcome(outcome, (order) => ({
    text: `Blocked ${formatWorkOrderLabel(order.sequenceNumber)}: ${parsed.data.blockedReason}`,
    workOrder: order,
  }));
}

async function handleUnblock(
  playthroughId: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  const parsed = unblockToolSchema.safeParse(input);
  if (!parsed.success) {
    return { text: `Invalid unblock_work_order arguments: ${parsed.error.message}`, isError: true };
  }
  const target = await resolveTargetId(deps, playthroughId, parsed.data.workOrderId);
  if (target.error !== undefined) {
    return { text: target.error, isError: true };
  }
  const outcome = await deps.workOrders.transition(playthroughId, target.id, 'Unblock', 'Foreman', {
    resolutionNote: parsed.data.resolutionNote,
  });
  return mapOutcome(outcome, (order) => ({
    text: `Unblocked ${formatWorkOrderLabel(order.sequenceNumber)} (now active).`,
    workOrder: order,
  }));
}

async function handleSupersede(
  playthroughId: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  const parsed = supersedeToolSchema.safeParse(input);
  if (!parsed.success) {
    return {
      text: `Invalid supersede_work_order arguments: ${parsed.error.message}`,
      isError: true,
    };
  }
  const target = await resolveTargetId(deps, playthroughId, parsed.data.workOrderId);
  if (target.error !== undefined) {
    return { text: target.error, isError: true };
  }
  const outcome = await deps.workOrders.transition(
    playthroughId,
    target.id,
    'Supersede',
    'Foreman',
    {
      supersededByWorkOrderId: parsed.data.supersededByWorkOrderId,
      supersededReason: parsed.data.supersededReason,
    },
  );
  return mapOutcome(outcome, (order) => ({
    text: `Superseded ${formatWorkOrderLabel(order.sequenceNumber)}.`,
    workOrder: order,
  }));
}

async function handleCreateChild(
  playthroughId: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  const parsed = workOrderCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      text: `Invalid create_child_work_order arguments: ${parsed.error.message}`,
      isError: true,
    };
  }
  if (parsed.data.relationshipToParent === undefined) {
    return { text: 'create_child_work_order requires relationshipToParent.', isError: true };
  }
  let parentId = parsed.data.parentWorkOrderId;
  if (parentId === undefined) {
    const current = await deps.workOrders.getCurrent(playthroughId);
    if (current === undefined) {
      return {
        text: 'No parentWorkOrderId given and no current order to parent to.',
        isError: true,
      };
    }
    parentId = current.id;
  }
  const enrich = await resolvePlanReferences(parsed.data, deps.mcp);
  if (!enrich.ok) {
    return { text: enrich.message, isError: true };
  }
  const derived = await deriveRecipes(parsed.data, deps.mcp);
  if (!derived.ok) {
    return { text: derived.message, isError: true };
  }
  const power = await verifyPlanPower(parsed.data, deps.mcp);
  if (!power.ok) {
    return { text: power.message, isError: true };
  }
  const order = await deps.workOrders.create(
    playthroughId,
    { ...parsed.data, parentWorkOrderId: parentId },
    deps.gameVersion(),
  );
  const advisory = outputAdvisory(parsed.data);
  const advisoryText = advisory !== undefined ? `\n\n${advisory}` : '';
  return {
    text: `Issued child ${formatWorkOrderLabel(order.sequenceNumber)}: "${order.title}" under the parent. Completing it will auto-unblock a blocked parent.${advisoryText}`,
    isError: false,
    workOrder: order,
  };
}

// --- Explore orders (#207) -------------------------------------------------

/** A collectible resolved from the world dataset (coordinates in metres). */
interface ResolvedCollectible {
  id: string;
  kind: string;
  guid?: string;
  schematic?: string;
  unlock?: ExploreCollectible['unlockCost'];
  x: number;
  y: number;
  z: number;
}

/** Resolves collectibles by id via `resolve_collectibles`; null if the tool is unavailable. */
async function resolveCollectiblesByIds(
  ids: string[],
  mcp: McpGateway,
): Promise<{ byId: Map<string, ResolvedCollectible>; unresolved: string[] } | null> {
  try {
    const res = await mcp.callTool('resolve_collectibles', { ids });
    if (res.isError) {
      return null;
    }
    const parsed = JSON.parse(res.text) as {
      resolved?: ResolvedCollectible[];
      unresolved?: string[];
    };
    const byId = new Map<string, ResolvedCollectible>();
    for (const c of parsed.resolved ?? []) {
      byId.set(c.id, c);
    }
    return { byId, unresolved: parsed.unresolved ?? [] };
  } catch {
    return null;
  }
}

/**
 * Issues an explore order (#207). The foreman references collectibles by id; the server
 * resolves them against the world dataset, DERIVES each collectible's facts (kind,
 * coordinates, identity, and unlock cost — so a pod always lists its true open cost) and
 * REJECTS any unknown id — the same accuracy standard as work orders.
 */
async function handleCreateExplore(
  playthroughId: string,
  input: unknown,
  deps: WorkOrderToolDeps,
): Promise<WorkOrderToolOutcome> {
  const parsed = exploreOrderCreateSchema.safeParse(input);
  if (!parsed.success) {
    return {
      text: `Invalid create_explore_order arguments: ${parsed.error.message}`,
      isError: true,
    };
  }
  const plan = parsed.data;

  const ids = [...new Set(plan.waypoints.flatMap((w) => w.collectibles.map((c) => c.id)))];
  const lookup = await resolveCollectiblesByIds(ids, deps.mcp);
  if (lookup === null) {
    return {
      text: 'Could not resolve collectibles against the world data — try again.',
      isError: true,
    };
  }
  if (lookup.unresolved.length > 0) {
    return {
      text:
        `Explore order not created: these collectible ids aren't in the world data — get valid ` +
        `ids from nearest_collectibles / list_collectibles and retry.\n` +
        lookup.unresolved.map((id) => `  • ${id}`).join('\n'),
      isError: true,
    };
  }

  const waypoints: ExploreWaypoint[] = plan.waypoints.map((w, i) => {
    const collectibles: ExploreCollectible[] = w.collectibles.map((ref) => {
      const c = lookup.byId.get(ref.id)!;
      const item: ExploreCollectible = {
        id: c.id,
        kind: c.kind as ExploreCollectible['kind'],
        collected: false,
        coordinates: { x: c.x, y: c.y, z: c.z },
      };
      if (c.guid !== undefined) {
        item.guid = c.guid;
      }
      if (c.schematic !== undefined) {
        item.schematic = c.schematic;
      }
      if (c.unlock !== undefined) {
        item.unlockCost = c.unlock;
      }
      if (ref.reason !== undefined) {
        item.reason = ref.reason;
      }
      return item;
    });
    const waypoint: ExploreWaypoint = {
      id: randomUUID(),
      order: w.order ?? i,
      // Default the stop to its first collectible's location when not given.
      coordinates: w.coordinates ?? collectibles[0]?.coordinates ?? { x: 0, y: 0 },
      collectibles,
    };
    if (w.label !== undefined) {
      waypoint.label = w.label;
    }
    if (w.relativeToPlayer !== undefined) {
      waypoint.relativeToPlayer = w.relativeToPlayer;
    }
    if (w.notes !== undefined) {
      waypoint.notes = w.notes;
    }
    return waypoint;
  });

  const order = await deps.workOrders.create(
    playthroughId,
    {
      orderType: 'explore',
      title: plan.title,
      goal: plan.goal,
      ...(plan.objective !== undefined ? { objective: plan.objective } : {}),
      ...(plan.strategicSignificance !== undefined
        ? { strategicSignificance: plan.strategicSignificance }
        : {}),
      ...(plan.successCondition !== undefined ? { successCondition: plan.successCondition } : {}),
      ...(plan.tier !== undefined ? { tier: plan.tier } : {}),
      ...(plan.notes !== undefined ? { notes: plan.notes } : {}),
      ...(plan.locationRecommendation !== undefined
        ? { locationRecommendation: plan.locationRecommendation }
        : {}),
      waypoints,
      ...(plan.parentWorkOrderId !== undefined
        ? { parentWorkOrderId: plan.parentWorkOrderId }
        : {}),
      ...(plan.relationshipToParent !== undefined
        ? { relationshipToParent: plan.relationshipToParent }
        : {}),
    },
    deps.gameVersion(),
  );
  const label = formatWorkOrderLabel(order.sequenceNumber, 'explore');
  const total = waypoints.reduce((n, w) => n + w.collectibles.length, 0);
  return {
    text: `Issued ${label}: "${order.title}" — a ${waypoints.length}-waypoint route to collect ${total} item(s). Tell the pioneer it is ready.`,
    isError: false,
    workOrder: order,
  };
}

/** Per-unit build cost + resolved class/display name for one buildable, from `get_building`. */
interface ResolvedBuild {
  buildingClass?: string;
  /** Canonical building display name (for recipe↔machine compatibility checks). */
  displayName?: string;
  buildCost: BuildCostLine[];
}

interface BuildableInput {
  name: string;
  buildingClass?: string;
  buildCost?: BuildCostLine[];
  requiredCount?: number;
  recipeName?: string;
}
interface StepInput {
  buildables?: BuildableInput[];
}

/** Outcome of plan-reference resolution: ok, or a rejection naming what failed. */
export type EnrichResult = { ok: true } | { ok: false; unresolved: string[]; message: string };

/** The kinds of game-data name a plan carries, each resolved against its own MCP tools. */
type RefKind = 'building' | 'recipe' | 'item' | 'schematic';

interface KindConfig {
  /** Exact-match resolver tool (returns `isError` on a miss). */
  getTool: string;
  /** Key the resolver wraps its entity under on success. */
  responseKey: string;
  /** Discovery tool backing best-match suggestions. */
  listTool: string;
  /** Key the discovery tool wraps its list under. */
  listKey: string;
  /** Human label for the rejection message (singular). */
  label: string;
}

/**
 * How each name kind resolves. `building` covers both buildables and recipe
 * `machineName`s (a machine is a building); resources fold into items, so
 * `resourceName` resolves via `get_item`. Slice 1 (#222) added `list_items` /
 * `list_recipes` and `search` on `list_schematics` to source suggestions here.
 */
const KIND: Record<RefKind, KindConfig> = {
  building: {
    getTool: 'get_building',
    responseKey: 'building',
    listTool: 'list_buildings',
    listKey: 'buildings',
    label: 'building',
  },
  recipe: {
    getTool: 'get_recipe',
    responseKey: 'recipe',
    listTool: 'list_recipes',
    listKey: 'recipes',
    label: 'recipe',
  },
  item: {
    getTool: 'get_item',
    responseKey: 'item',
    listTool: 'list_items',
    listKey: 'items',
    label: 'item',
  },
  schematic: {
    getTool: 'get_schematic',
    responseKey: 'schematic',
    listTool: 'list_schematics',
    listKey: 'schematics',
    label: 'schematic',
  },
};

const KIND_ORDER: RefKind[] = ['building', 'recipe', 'item', 'schematic'];

/** The name-bearing plan fields resolution walks. All optional (revise sends a partial plan). */
interface PlanInput {
  buildSteps?: StepInput[];
  /** Server-DERIVED (#228): overwritten by deriveRecipes from the recipe-annotated blocks. */
  recipes?: RecipeAssignment[];
  expectedOutputs?: {
    kind: string;
    item?: string;
    schematic?: string;
    megawatts?: number;
    perMinute?: number;
  }[];
  resourceNodes?: { resourceName?: string }[];
}

/**
 * Resolves every game-data name a plan carries — buildables, recipe machine/recipe/item
 * names, expected-output items and unlock schematics, and resource-node names — against
 * the sf-mcp resolver tools. Buildables are additionally enriched with their per-unit
 * `buildCost` + class in place. If ANY name fails to resolve, returns a rejection whose
 * message groups each bad name by kind with best-match suggestions and a pointer to the
 * relevant `list_*` tool. The caller must NOT persist on a rejection, so a wrong name is
 * corrected up front rather than silently degrading the plan (#220 for buildables, #222
 * for the rest).
 */
export async function resolvePlanReferences(
  plan: PlanInput,
  mcp: McpGateway,
): Promise<EnrichResult> {
  const misses: Record<RefKind, Set<string>> = {
    building: new Set(),
    recipe: new Set(),
    item: new Set(),
    schematic: new Set(),
  };

  // Buildables: enrich buildCost/class in place, collecting misses under `building`.
  await enrichBuildables(plan, mcp, (name) => misses.building.add(name));

  // Every other name field, existence-only, deduplicated per kind.
  const toResolve: Record<RefKind, Set<string>> = {
    building: new Set(),
    recipe: new Set(),
    item: new Set(),
    schematic: new Set(),
  };
  // Recipes are annotated PER PRODUCTION BLOCK now (#228), not in a separate recipes[]
  // array — the server derives that array + its rates from the blocks (see deriveRecipes).
  for (const step of plan.buildSteps ?? []) {
    for (const b of step.buildables ?? []) {
      if (b.recipeName !== undefined) {
        toResolve.recipe.add(b.recipeName);
      }
    }
  }
  for (const output of plan.expectedOutputs ?? []) {
    if (output.kind === 'item' && output.item !== undefined) {
      toResolve.item.add(output.item);
    }
    if (output.kind === 'unlock' && output.schematic !== undefined) {
      toResolve.schematic.add(output.schematic);
    }
  }
  for (const node of plan.resourceNodes ?? []) {
    if (node.resourceName !== undefined) {
      toResolve.item.add(node.resourceName);
    }
  }

  for (const kind of KIND_ORDER) {
    for (const name of toResolve[kind]) {
      if (!(await nameResolves(name, KIND[kind], mcp))) {
        misses[kind].add(name);
      }
    }
  }

  return buildEnrichResult(misses, mcp);
}

/**
 * Resolves every DISTINCT buildable name to its class + per-unit `buildCost` via
 * `get_building`, mutating `buildSteps` in place, and reports each unresolved name via
 * `onMiss` (its buildCost is cleared so a wrong name never ships a stale cost).
 */
async function enrichBuildables(
  plan: { buildSteps?: StepInput[] },
  mcp: McpGateway,
  onMiss: (name: string) => void,
): Promise<void> {
  const steps = plan.buildSteps ?? [];
  const names = new Set<string>();
  for (const step of steps) {
    for (const b of step.buildables ?? []) {
      names.add(b.name);
    }
  }
  if (names.size === 0) {
    return;
  }

  const resolved = new Map<string, ResolvedBuild | null>();
  for (const name of names) {
    resolved.set(name, await resolveBuild(name, mcp));
  }

  for (const step of steps) {
    for (const b of step.buildables ?? []) {
      const r = resolved.get(b.name);
      if (r === null || r === undefined) {
        b.buildCost = [];
        onMiss(b.name);
      } else {
        b.buildCost = r.buildCost;
        if (r.buildingClass !== undefined) {
          b.buildingClass = r.buildingClass;
        }
      }
    }
  }
}

/** Whether a name resolves exactly via its kind's `get_*` tool (non-error, entity present). */
async function nameResolves(name: string, cfg: KindConfig, mcp: McpGateway): Promise<boolean> {
  try {
    const res = await mcp.callTool(cfg.getTool, { name });
    if (res.isError) {
      return false;
    }
    const parsed = JSON.parse(res.text) as Record<string, unknown>;
    return parsed[cfg.responseKey] !== undefined;
  } catch {
    return false;
  }
}

/** A compact `{ className, displayName }` entry as returned by a `list_*` discovery tool. */
interface NameEntry {
  className: string;
  displayName: string;
}

/** Fetches a kind's full name list once (for suggestions); [] if the tool is unavailable. */
async function fetchNames(cfg: KindConfig, mcp: McpGateway): Promise<NameEntry[]> {
  try {
    const res = await mcp.callTool(cfg.listTool, {});
    if (res.isError) {
      return [];
    }
    const parsed = JSON.parse(res.text) as Record<string, NameEntry[] | undefined>;
    return parsed[cfg.listKey] ?? [];
  } catch {
    return [];
  }
}

/** Significant lower-case tokens of a name (drops single-character noise like "T"). */
function tokenise(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Up to five best-match display names for a miss: the highest token-overlap tier against
 * a kind's name list. Advisory only — the model must re-issue with an exact name, so this
 * surfaces candidates without ever resolving on the model's behalf.
 */
function suggestFor(name: string, candidates: NameEntry[]): string[] {
  const tokens = tokenise(name);
  if (tokens.length === 0 || candidates.length === 0) {
    return [];
  }
  let best = 0;
  const scored = candidates.map((c) => {
    const haystack = `${c.displayName} ${c.className}`.toLowerCase();
    const score = tokens.reduce((n, t) => (haystack.includes(t) ? n + 1 : n), 0);
    best = Math.max(best, score);
    return { displayName: c.displayName, score };
  });
  if (best === 0) {
    return [];
  }
  return scored
    .filter((s) => s.score === best)
    .map((s) => s.displayName)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 5);
}

/**
 * Turns per-kind misses into an `EnrichResult`: ok if none, otherwise a rejection whose
 * message groups bad names by kind (each with suggestions + a pointer to the kind's
 * `list_*` tool) and whose `unresolved` is the flat list of bad names.
 */
async function buildEnrichResult(
  misses: Record<RefKind, Set<string>>,
  mcp: McpGateway,
): Promise<EnrichResult> {
  const unresolved: string[] = [];
  const sections: string[] = [];
  for (const kind of KIND_ORDER) {
    const names = misses[kind];
    if (names.size === 0) {
      continue;
    }
    const cfg = KIND[kind];
    const candidates = await fetchNames(cfg, mcp);
    const lines = [...names].map((name) => {
      unresolved.push(name);
      const suggestions = suggestFor(name, candidates);
      return suggestions.length > 0
        ? `  • "${name}" → did you mean: ${suggestions.join(', ')}?`
        : `  • "${name}" → no close match found.`;
    });
    const heading = `${cfg.label[0]!.toUpperCase()}${cfg.label.slice(1)} names (confirm with ${cfg.listTool}):`;
    sections.push(`${heading}\n${lines.join('\n')}`);
  }
  if (unresolved.length === 0) {
    return { ok: true };
  }
  return {
    ok: false,
    unresolved,
    message:
      `Work order not created: these names don't match the game data — correct them and ` +
      `retry with the exact in-game display names.\n${sections.join('\n')}`,
  };
}

/** Resolves one buildable name to its class + per-unit build cost via `get_building`. */
async function resolveBuild(name: string, mcp: McpGateway): Promise<ResolvedBuild | null> {
  try {
    const res = await mcp.callTool('get_building', { name });
    if (res.isError) {
      return null;
    }
    const parsed = JSON.parse(res.text) as {
      building?: {
        className?: string;
        displayName?: string;
        buildCost?: { item?: string; itemClassName?: string; amount?: number }[];
      };
    };
    const building = parsed.building;
    if (building === undefined) {
      return null;
    }
    const buildCost: BuildCostLine[] = (building.buildCost ?? []).map((c) => ({
      itemName: c.item ?? c.itemClassName ?? 'Unknown',
      ...(c.itemClassName !== undefined ? { itemClass: c.itemClassName } : {}),
      amount: c.amount ?? 0,
    }));
    return {
      buildCost,
      ...(building.className !== undefined ? { buildingClass: building.className } : {}),
      ...(building.displayName !== undefined ? { displayName: building.displayName } : {}),
    };
  } catch {
    return null;
  }
}

// --- Recipe derivation: server-owned rates + recipes[] projection (#228) ----

/** Outcome of recipe derivation: ok, or a rejection (building↔recipe mismatch). */
export type DeriveResult = { ok: true } | { ok: false; message: string };

/** A recipe's per-machine rates + the machine it runs in, from `get_recipe`. */
interface RecipeData {
  /** Machine display name (`producedIn[0]`); undefined for machineless recipes. */
  machineName?: string;
  producedIn: string[];
  /** Per single machine at 100% clock. */
  ingredients: RecipeItemRate[];
  products: RecipeItemRate[];
}

/** Fetches a recipe's per-machine rates via `get_recipe`; null on miss (names are pre-resolved). */
async function fetchRecipeData(name: string, mcp: McpGateway): Promise<RecipeData | null> {
  try {
    const res = await mcp.callTool('get_recipe', { name });
    if (res.isError) {
      return null;
    }
    const parsed = JSON.parse(res.text) as {
      recipe?: {
        producedIn?: string[];
        ingredients?: { item?: string; perMinute?: number }[];
        products?: { item?: string; perMinute?: number }[];
      };
    };
    const recipe = parsed.recipe;
    if (recipe === undefined) {
      return null;
    }
    const rates = (xs?: { item?: string; perMinute?: number }[]): RecipeItemRate[] =>
      (xs ?? [])
        .filter(
          (x): x is { item: string; perMinute: number } =>
            typeof x.item === 'string' && typeof x.perMinute === 'number',
        )
        .map((x) => ({ itemName: x.item, perMinute: x.perMinute }));
    const producedIn = recipe.producedIn ?? [];
    return {
      producedIn,
      ...(producedIn[0] !== undefined ? { machineName: producedIn[0] } : {}),
      ingredients: rates(recipe.ingredients),
      products: rates(recipe.products),
    };
  } catch {
    return null;
  }
}

/** Rounds a per-minute rate to 4dp and formats without noisy trailing zeros. */
function fmtRate(rate: number): string {
  const r = Math.round(rate * 10_000) / 10_000;
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
}

/**
 * Derives the work order's `recipes[]` projection and its per-minute rates from each
 * recipe-annotated PRODUCTION buildable block — the server owns the rates, the foreman
 * only annotates recipe + count (#228). Hard-rejects a block whose building can't run its
 * recipe (deterministic, from the recipe's `producedIn`). Returns a non-blocking advisory
 * when derived output falls short of an `expectedOutputs` item target (never rejects on that
 * — clock/somersloop variance is legitimate). Skips (ok) a partial revise with no buildSteps.
 */
export async function deriveRecipes(plan: PlanInput, mcp: McpGateway): Promise<DeriveResult> {
  if (plan.buildSteps === undefined) {
    return { ok: true };
  }

  interface Block {
    buildingName: string;
    recipeName: string;
    count: number;
  }
  const blocks: Block[] = [];
  for (const step of plan.buildSteps) {
    for (const b of step.buildables ?? []) {
      if (b.recipeName !== undefined) {
        blocks.push({
          buildingName: b.name,
          recipeName: b.recipeName,
          count: b.requiredCount ?? 0,
        });
      }
    }
  }
  if (blocks.length === 0) {
    plan.recipes = [];
    return { ok: true };
  }

  const recipeCache = new Map<string, RecipeData | null>();
  const buildCache = new Map<string, ResolvedBuild | null>();
  const getRecipe = async (name: string): Promise<RecipeData | null> => {
    if (!recipeCache.has(name)) {
      recipeCache.set(name, await fetchRecipeData(name, mcp));
    }
    return recipeCache.get(name) ?? null;
  };
  const getBuild = async (name: string): Promise<ResolvedBuild | null> => {
    if (!buildCache.has(name)) {
      buildCache.set(name, await resolveBuild(name, mcp));
    }
    return buildCache.get(name) ?? null;
  };

  interface Agg {
    machineName: string;
    recipeName: string;
    inputs: Map<string, number>;
    outputs: Map<string, number>;
  }
  const byRecipe = new Map<string, Agg>();
  const mismatches: string[] = [];

  for (const block of blocks) {
    const recipe = await getRecipe(block.recipeName);
    if (recipe === null) {
      continue; // name was resolved upstream; be defensive
    }
    // Compatibility: the block's building must be a machine the recipe runs in.
    if (recipe.producedIn.length > 0) {
      const build = await getBuild(block.buildingName);
      const buildingDisplay = build?.displayName ?? block.buildingName;
      const compatible = recipe.producedIn.some(
        (m) => m.toLowerCase() === buildingDisplay.toLowerCase(),
      );
      if (!compatible) {
        mismatches.push(
          `  • "${block.recipeName}" runs in ${recipe.producedIn.join(' or ')}, not ${buildingDisplay} — fix the block's building or its recipe.`,
        );
        continue;
      }
    }
    const agg = byRecipe.get(block.recipeName) ?? {
      machineName: recipe.machineName ?? block.buildingName,
      recipeName: block.recipeName,
      inputs: new Map<string, number>(),
      outputs: new Map<string, number>(),
    };
    for (const ing of recipe.ingredients) {
      agg.inputs.set(
        ing.itemName,
        (agg.inputs.get(ing.itemName) ?? 0) + ing.perMinute * block.count,
      );
    }
    for (const prod of recipe.products) {
      agg.outputs.set(
        prod.itemName,
        (agg.outputs.get(prod.itemName) ?? 0) + prod.perMinute * block.count,
      );
    }
    byRecipe.set(block.recipeName, agg);
  }

  if (mismatches.length > 0) {
    return {
      ok: false,
      message:
        `Work order not created: these blocks pair a recipe with the wrong machine — ` +
        `correct the building or recipe and retry.\n${mismatches.join('\n')}`,
    };
  }

  const round = (n: number): number => Math.round(n * 10_000) / 10_000;
  plan.recipes = [...byRecipe.values()].map((e) => ({
    machineName: e.machineName,
    recipeName: e.recipeName,
    inputItems: [...e.inputs].map(([itemName, perMinute]) => ({
      itemName,
      perMinute: round(perMinute),
    })),
    outputItems: [...e.outputs].map(([itemName, perMinute]) => ({
      itemName,
      perMinute: round(perMinute),
    })),
  }));

  return { ok: true };
}

/**
 * Non-blocking advisory: which `expectedOutputs` item targets does the plan's derived
 * production fall short of? Works purely from the derived `recipes[]` (output totals + the
 * producing machine) + `expectedOutputs`, so it runs on a full plan (create) OR the merged
 * effective plan (revise). Never rejects; surfaced to the foreman, never the pioneer.
 */
export function outputAdvisory(plan: PlanInput): string | undefined {
  const producedByItem = new Map<string, { total: number; machine: string }>();
  for (const recipe of plan.recipes ?? []) {
    for (const out of recipe.outputItems ?? []) {
      const prev = producedByItem.get(out.itemName);
      producedByItem.set(out.itemName, {
        total: (prev?.total ?? 0) + out.perMinute,
        machine: prev?.machine ?? recipe.machineName,
      });
    }
  }
  const notes: string[] = [];
  for (const output of plan.expectedOutputs ?? []) {
    if (
      output.kind !== 'item' ||
      output.item === undefined ||
      typeof output.perMinute !== 'number'
    ) {
      continue;
    }
    const produced = producedByItem.get(output.item);
    const total = produced?.total ?? 0;
    if (total + 0.01 >= output.perMinute) {
      continue;
    }
    const where =
      produced !== undefined
        ? ` — increase the ${produced.machine} block(s)`
        : ' — no block produces it';
    notes.push(
      `  • ${output.item}: the plan produces ${fmtRate(total)}/min but targets ${fmtRate(output.perMinute)}/min${where}.`,
    );
  }
  if (notes.length > 0) {
    return (
      `Heads up — the plan under-delivers its own stated targets; adjust the block counts ` +
      `(or the targets) before the pioneer starts:\n${notes.join('\n')}`
    );
  }
  return undefined;
}

/**
 * Non-blocking safeguard for the revise trap: `updatePlan` REPLACES `buildSteps` with exactly
 * what the patch sends (checklist state is carried forward by id, but plan content of omitted
 * steps is dropped), yet the model tends to send only the delta. We can't tell an intentional
 * trim from an accidental delta, so rather than reject, we warn the foreman when a revise
 * SHRINKS the plan (fewer steps or buildables than the current order) to resend the full plan
 * if the drop wasn't intended. Surfaced to the foreman in-loop, never the pioneer.
 */
function droppedContentAdvisory(
  incoming: StepInput[] | undefined,
  existing: StepInput[] | undefined,
): string | undefined {
  if (incoming === undefined || existing === undefined || existing.length === 0) {
    return undefined;
  }
  const countBuildables = (steps: StepInput[]): number =>
    steps.reduce((n, s) => n + (s.buildables?.length ?? 0), 0);
  const wasSteps = existing.length;
  const nowSteps = incoming.length;
  const wasBuildables = countBuildables(existing);
  const nowBuildables = countBuildables(incoming);
  if (nowSteps >= wasSteps && nowBuildables >= wasBuildables) {
    return undefined;
  }
  return (
    `Heads up — revising REPLACES the whole build plan, and this patch has fewer parts than the ` +
    `current order (was ${wasSteps} step(s) / ${wasBuildables} buildable(s), now ${nowSteps} / ` +
    `${nowBuildables}). If you only meant to add or tweak something, resend the existing steps ` +
    `alongside your change so they aren't dropped.`
  );
}

// --- Quantity verification: power output (#223) ----------------------------

/** Outcome of a quantity check: ok, or a rejection explaining the mismatch. */
export type PowerCheckResult = { ok: true } | { ok: false; message: string };

/** A fixed-output power generator: class → display name + per-unit MW. */
interface FixedGenerator {
  displayName: string;
  powerProduction: number;
}

/**
 * Fetches the fixed-output power generators keyed by class name via
 * `list_power_generators`. Excludes variable-output generators (Geothermal), whose
 * output is geyser-dependent and so can't be verified from a count. [] if unavailable.
 */
async function fetchPowerGenerators(mcp: McpGateway): Promise<Map<string, FixedGenerator>> {
  const map = new Map<string, FixedGenerator>();
  try {
    const res = await mcp.callTool('list_power_generators', {});
    if (res.isError) {
      return map;
    }
    const parsed = JSON.parse(res.text) as {
      generators?: {
        className?: string;
        displayName?: string;
        powerProduction?: number;
        variablePowerProduction?: boolean;
      }[];
    };
    for (const g of parsed.generators ?? []) {
      if (
        g.className !== undefined &&
        typeof g.powerProduction === 'number' &&
        g.variablePowerProduction !== true
      ) {
        map.set(g.className, {
          displayName: g.displayName ?? g.className,
          powerProduction: g.powerProduction,
        });
      }
    }
  } catch {
    return map;
  }
  return map;
}

/** Formats an MW figure without noisy trailing decimals. */
function fmtMW(mw: number): string {
  return Number.isInteger(mw) ? String(mw) : mw.toFixed(2);
}

/**
 * Verifies a plan's declared power output against what its generator buildables actually
 * produce. Power is deterministic — generators can't be overclocked, so `powerProduction`
 * is fixed — making this the one quantitative check safe to hard-reject (#223). Rejects
 * only UNDER-provision (the plant can't produce its claimed MW); over-provisioning is
 * legitimate headroom. Skips (ok) whenever it can't see BOTH a power output and generator
 * buildables in the plan — so partial revises are never falsely rejected.
 */
export async function verifyPlanPower(plan: PlanInput, mcp: McpGateway): Promise<PowerCheckResult> {
  let declaredMW = 0;
  let hasPowerOutput = false;
  for (const output of plan.expectedOutputs ?? []) {
    if (output.kind === 'power' && typeof output.megawatts === 'number') {
      declaredMW += output.megawatts;
      hasPowerOutput = true;
    }
  }
  if (!hasPowerOutput || declaredMW <= 0) {
    return { ok: true };
  }

  const generators = await fetchPowerGenerators(mcp);
  if (generators.size === 0) {
    return { ok: true };
  }

  // Aggregate generator buildables by type (a generator may appear across several steps).
  const byType = new Map<string, { displayName: string; powerProduction: number; count: number }>();
  for (const step of plan.buildSteps ?? []) {
    for (const b of step.buildables ?? []) {
      if (b.buildingClass === undefined) {
        continue;
      }
      const gen = generators.get(b.buildingClass);
      if (gen === undefined) {
        continue;
      }
      const entry = byType.get(b.buildingClass) ?? { ...gen, count: 0 };
      entry.count += b.requiredCount ?? 0;
      byType.set(b.buildingClass, entry);
    }
  }
  const types = [...byType.values()];
  if (types.length === 0) {
    return { ok: true };
  }

  const actualMW = types.reduce((sum, t) => sum + t.count * t.powerProduction, 0);
  if (actualMW + 1e-6 >= declaredMW) {
    return { ok: true };
  }

  const built = types.map((t) => `${t.count}× ${t.displayName}`).join(' + ');
  const base =
    `Work order not created: it claims ${fmtMW(declaredMW)} MW but its ${built} ` +
    `produce ${fmtMW(actualMW)} MW`;
  if (types.length === 1) {
    const t = types[0]!;
    const needed = Math.ceil(declaredMW / t.powerProduction);
    return {
      ok: false,
      message:
        `${base} (${fmtMW(t.powerProduction)} MW each). For ${fmtMW(declaredMW)} MW you need ` +
        `${needed}× ${t.displayName}. Adjust the count or the target and retry.`,
    };
  }
  return {
    ok: false,
    message:
      `${base}. Increase generator counts (or lower the target) so total output is at ` +
      `least ${fmtMW(declaredMW)} MW, then retry.`,
  };
}

/** Resolves the target order id (explicit, or the playthrough's current order). */
async function resolveTargetId(
  deps: WorkOrderToolDeps,
  playthroughId: string,
  explicitId: string | undefined,
): Promise<{ id: string; error?: undefined } | { id?: undefined; error: string }> {
  if (explicitId !== undefined) {
    return { id: explicitId };
  }
  // The "current" order — active, or the latest non-terminal — so the foreman can
  // act on an order it just issued (which is `new`, not yet `active`).
  const current = await deps.workOrders.getCurrent(playthroughId);
  if (current === undefined) {
    return { error: 'No workOrderId given and no current work order in this playthrough.' };
  }
  return { id: current.id };
}

/** Maps a service outcome to a tool outcome, rendering failures as error text. */
function mapOutcome(
  outcome: WorkOrderOutcome,
  onOk: (order: WorkOrder) => { text: string; workOrder: WorkOrder },
): WorkOrderToolOutcome {
  if (!outcome.ok) {
    return { text: outcome.message, isError: true };
  }
  const { text, workOrder } = onOk(outcome.order);
  return { text, isError: false, workOrder };
}
