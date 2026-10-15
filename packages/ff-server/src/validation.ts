// Shared zod schemas for REST request bodies and foreman tool inputs, so both validate against
// identical shapes.

import { z } from 'zod';

/**
 * Shared zod schemas for request bodies and tool inputs. Centralised so the
 * REST routes and the foreman's work-order tools validate against identical
 * shapes. Mirrors the types in types.ts and docs/work-orders.md.
 */

// --- Plan building blocks --------------------------------------------------

export const coordinatesSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number().optional(),
});

export const buildCostLineSchema = z.object({
  itemName: z.string().min(1),
  itemClass: z.string().optional(),
  amount: z.number(),
});

/**
 * A buildable a step requires. The foreman supplies `name` + `requiredCount`
 * (+ optional recipe/notes); the server fills `id`, `buildingClass` and
 * `buildCost`, so those are optional here and accepted on round-trips.
 */
export const buildableSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  buildingClass: z.string().optional(),
  requiredCount: z.number().int().min(0),
  builtCount: z.number().int().min(0).optional(),
  recipeName: z.string().optional(),
  notes: z.string().optional(),
  buildCost: z.array(buildCostLineSchema).optional(),
});

export const workOrderStepSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1),
  description: z.string().optional(),
  checked: z.boolean().optional(),
  order: z.number().int().optional(),
  buildables: z.array(buildableSchema).optional(),
});

export const recipeItemRateSchema = z.object({
  itemName: z.string().min(1),
  perMinute: z.number(),
});

export const recipeAssignmentSchema = z.object({
  id: z.string().optional(),
  machineName: z.string().min(1),
  recipeName: z.string().min(1),
  inputItems: z.array(recipeItemRateSchema).optional(),
  outputItems: z.array(recipeItemRateSchema).optional(),
  notes: z.string().optional(),
});

export const expectedOutputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('item'),
    item: z.string().min(1),
    perMinute: z.number(),
    unit: z.string().optional(),
  }),
  z.object({ kind: z.literal('power'), megawatts: z.number() }),
  z.object({ kind: z.literal('unlock'), schematic: z.string().min(1) }),
  z.object({ kind: z.literal('infrastructure'), description: z.string().min(1) }),
]);

export const locationRecommendationSchema = z.object({
  summary: z.string().min(1),
  coordinates: coordinatesSchema.optional(),
  relativeToPlayer: z.string().optional(),
  rationale: z.string().optional(),
});

export const resourceNodeReferenceSchema = z.object({
  id: z.string().optional(),
  resourceName: z.string().min(1),
  purity: z.enum(['impure', 'normal', 'pure']).optional(),
  coordinates: coordinatesSchema.optional(),
  distanceFromPlayer: z.number().optional(),
  distanceFromWorkOrderLocation: z.number().optional(),
  notes: z.string().optional(),
});

const collectibleKindSchema = z.enum([
  'mercerSphere',
  'somersloop',
  'powerSlugBlue',
  'powerSlugYellow',
  'powerSlugPurple',
  'hardDrive',
]);

export const collectibleOpportunitySchema = z.object({
  id: z.string().optional(),
  kind: collectibleKindSchema,
  coordinates: coordinatesSchema.optional(),
  distance: z.number().optional(),
  reason: z.string().optional(),
  optional: z.boolean(),
});

export const opportunitiesSchema = z.object({
  nearbyCollectiblesFromPlayer: z.array(collectibleOpportunitySchema).optional(),
  nearbyCollectiblesFromWorkOrderLocation: z.array(collectibleOpportunitySchema).optional(),
  overclockingOptions: z
    .array(
      z.object({
        target: z.string().min(1),
        recommendation: z.string().min(1),
        powerShardCount: z.number().int().optional(),
        expectedEffect: z.string().optional(),
        notes: z.string().optional(),
      }),
    )
    .optional(),
  awesomeShopSuggestions: z
    .array(
      z.object({
        itemName: z.string().min(1),
        reason: z.string().min(1),
        priority: z.enum(['low', 'medium', 'high']).optional(),
      }),
    )
    .optional(),
  notes: z.array(z.string()).optional(),
});

export const pioneerFeedbackSchema = z.object({
  enjoyedAspects: z.array(z.string()).default([]),
  didNotEnjoy: z.array(z.string()).default([]),
  freeformNotes: z.string().optional(),
});

const relationshipTypeSchema = z.enum([
  'prerequisite',
  'exploration',
  'hard_drive_hunt',
  'mam_research',
  'resource_gathering',
  'infrastructure_support',
  'corrective_action',
]);

// --- Plan input (create / revise) ------------------------------------------

/** The shared plan fields. Used by create (required title+goal) and revise. */
const planFields = {
  title: z.string().min(1),
  goal: z.string().min(1),
  objective: z.string().optional(),
  strategicSignificance: z.string().optional(),
  successCondition: z.string().optional(),
  tier: z.number().int().min(0).max(9).optional(),
  notes: z.array(z.string()).optional(),
  locationRecommendation: locationRecommendationSchema.optional(),
  resourceNodes: z.array(resourceNodeReferenceSchema).optional(),
  recipes: z.array(recipeAssignmentSchema).optional(),
  expectedOutputs: z.array(expectedOutputSchema).optional(),
  buildSteps: z.array(workOrderStepSchema).optional(),
  opportunities: opportunitiesSchema.optional(),
  blockedReason: z.string().optional(),
  blockedResolutionHint: z.string().optional(),
};

export const workOrderCreateSchema = z.object({
  ...planFields,
  parentWorkOrderId: z.string().optional(),
  relationshipToParent: relationshipTypeSchema.optional(),
});

// --- Explore order input (#207) --------------------------------------------
// The foreman references each collectible by its stable `id` (from nearest_collectibles);
// the server derives kind/coordinates/identity/unlockCost from the world dataset and rejects
// unknown ids. So the input is deliberately thin — no transcribed collectible facts.

export const exploreCollectibleRefSchema = z.object({
  id: z.string().min(1),
  reason: z.string().optional(),
});

export const exploreWaypointSchema = z.object({
  label: z.string().optional(),
  order: z.number().int().optional(),
  coordinates: coordinatesSchema.optional(),
  relativeToPlayer: z.string().optional(),
  collectibles: z.array(exploreCollectibleRefSchema).min(1),
  notes: z.string().optional(),
});

export const exploreOrderCreateSchema = z.object({
  title: planFields.title,
  goal: planFields.goal,
  objective: planFields.objective,
  strategicSignificance: planFields.strategicSignificance,
  successCondition: planFields.successCondition,
  tier: planFields.tier,
  notes: planFields.notes,
  locationRecommendation: planFields.locationRecommendation,
  waypoints: z.array(exploreWaypointSchema).min(1),
  parentWorkOrderId: z.string().optional(),
  relationshipToParent: relationshipTypeSchema.optional(),
});

/** Marks one collectible collected/uncollected on an explore order (Pioneer execution). */
export const collectibleCollectedSchema = z.object({ collected: z.boolean() });

/** Plan patch: every field optional, but at least one must be present. */
export const workOrderPlanPatchSchema = z
  .object({
    title: planFields.title.optional(),
    goal: planFields.goal.optional(),
    objective: planFields.objective,
    strategicSignificance: planFields.strategicSignificance,
    successCondition: planFields.successCondition,
    tier: planFields.tier,
    notes: planFields.notes,
    locationRecommendation: planFields.locationRecommendation,
    resourceNodes: planFields.resourceNodes,
    recipes: planFields.recipes,
    expectedOutputs: planFields.expectedOutputs,
    buildSteps: planFields.buildSteps,
    opportunities: planFields.opportunities,
    blockedReason: planFields.blockedReason,
    blockedResolutionHint: planFields.blockedResolutionHint,
    reason: z.string().optional(),
    changeSummary: z.string().optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, {
    message: 'At least one plan field must be provided.',
  });

// --- Transitions & execution -----------------------------------------------

const actorSchema = z.enum(['Pioneer', 'Foreman', 'System']);

export const transitionSchema = z.object({
  action: z.enum([
    'Start',
    'Pause',
    'Resume',
    'Block',
    'Unblock',
    'Complete',
    'ForceComplete',
    'Cancel',
    'Supersede',
  ]),
  actor: actorSchema.optional(),
  blockedReason: z.string().optional(),
  blockedResolutionHint: z.string().optional(),
  resolutionNote: z.string().optional(),
  cancellationReason: z.string().optional(),
  supersededByWorkOrderId: z.string().optional(),
  supersededReason: z.string().optional(),
  forceCompletionReason: z.string().optional(),
  incompleteItemSummary: z.string().optional(),
  completionSummary: z.string().optional(),
  pioneerFeedback: pioneerFeedbackSchema.optional(),
});

export const stepCheckSchema = z.object({ checked: z.boolean() });
export const buildableCountSchema = z.object({ builtCount: z.number().int().min(0) });
export const logHoursSchema = z.object({ hours: z.number().positive() });
export const acknowledgeSchema = z.object({
  revisionNumber: z.number().int().positive().optional(),
});
export const revertSchema = z.object({ revisionNumber: z.number().int().positive() });

// --- Foreman tool inputs ---------------------------------------------------

/** Most foreman mutation tools target a specific order or default to active. */
export const proposeCompletionSchema = z.object({
  workOrderId: z.string().optional(),
  note: z.string().optional(),
});

export const blockToolSchema = z.object({
  workOrderId: z.string().optional(),
  blockedReason: z.string().min(1),
  blockedResolutionHint: z.string().min(1),
});

export const unblockToolSchema = z.object({
  workOrderId: z.string().optional(),
  resolutionNote: z.string().min(1),
});

export const supersedeToolSchema = z.object({
  workOrderId: z.string().optional(),
  supersededByWorkOrderId: z.string().min(1),
  supersededReason: z.string().min(1),
});

export const reviseToolSchema = z.object({
  workOrderId: z.string().optional(),
  ...{
    title: planFields.title.optional(),
    goal: planFields.goal.optional(),
    objective: planFields.objective,
    strategicSignificance: planFields.strategicSignificance,
    successCondition: planFields.successCondition,
    tier: planFields.tier,
    notes: planFields.notes,
    locationRecommendation: planFields.locationRecommendation,
    resourceNodes: planFields.resourceNodes,
    recipes: planFields.recipes,
    expectedOutputs: planFields.expectedOutputs,
    buildSteps: planFields.buildSteps,
    opportunities: planFields.opportunities,
  },
  changeSummary: z.string().optional(),
});

// --- Foremen, playthroughs & chat ------------------------------------------

export const createForemanSchema = z.object({
  name: z.string().min(1),
  personality: z.string().optional(),
});

export const updateForemanSchema = z
  .object({
    name: z.string().min(1).optional(),
    personality: z.string().optional(),
  })
  .refine((patch) => patch.name !== undefined || patch.personality !== undefined, {
    message: 'Provide name and/or personality.',
  });

/**
 * A client-suppliable id (e.g. a playthrough id when claiming a pre-accounts
 * playthrough). Restricted to a filename-safe charset because the playthrough id
 * becomes part of an on-disk save path — disallowing `/`, `\` and `.` forecloses
 * path traversal at the boundary. Covers Prisma cuids and UUIDs.
 */
const safeClientIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Must contain only letters, digits, hyphen or underscore.');

export const createPlaythroughSchema = z.object({
  id: safeClientIdSchema.optional(),
  foremanId: z.string().min(1),
  name: z.string().optional(),
  pioneerProfile: z.string().optional(),
});

export const updatePlaythroughSchema = z
  .object({
    name: z.string().optional(),
    pioneerProfile: z.string().optional(),
    foremanId: z.string().min(1).optional(),
  })
  .refine(
    (patch) =>
      patch.name !== undefined ||
      patch.pioneerProfile !== undefined ||
      patch.foremanId !== undefined,
    { message: 'Provide name, pioneerProfile and/or foremanId.' },
  );

export const chatSchema = z.object({
  message: z.string().min(1),
  // Optional per-request LLM override (effective only with a client-supplied key).
  provider: z.enum(['anthropic', 'openai']).optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
  // Conversation history window (message count). Honoured only for a BYOK request;
  // subscription/hosted requests always use the server default. Bounded to keep
  // token cost sane.
  historyWindow: z.number().int().min(2).max(100).optional(),
});
