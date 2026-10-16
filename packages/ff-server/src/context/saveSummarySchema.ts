// The zod schema and type for sf-mcp's get_save_summary payload. ff-server does not depend on
// sf-mcp, so the wire shape is checked here; anything that does not match yields no summary block.

import { z } from 'zod';

const vec = z.object({ x: z.number(), y: z.number(), z: z.number() });

/** The `summary` object get_save_summary returns (metres, per minute, MW). */
export const saveSummarySchema = z.object({
  save: z.object({
    saveName: z.string(),
    version: z.string(),
    savedAt: z.string().optional(),
    playDurationSeconds: z.number().optional(),
  }),
  player: z.object({
    position: vec.optional(),
    biome: z.string().optional(),
    within: z.string().optional(),
    hub: vec.optional(),
  }),
  progress: z.object({
    highestTier: z.number(),
    tierMilestones: z.array(z.string()),
    spaceElevatorPhase: z.number().optional(),
    mamTrees: z.array(z.string()),
  }),
  recipes: z.object({
    standardCount: z.number(),
    alternateCount: z.number(),
    alternates: z.array(z.string()),
    alternatesOmitted: z.number(),
  }),
  power: z.object({
    capacityMw: z.number(),
    consumptionMw: z.number(),
    headroomMw: z.number(),
    circuits: z.number(),
    overloadedCircuits: z.number(),
    generators: z.array(z.object({ type: z.string(), count: z.number(), mw: z.number() })),
  }),
  production: z.array(
    z.object({
      item: z.string(),
      perMinute: z.number(),
      machines: z.number(),
      unit: z.literal('m³').optional(),
    }),
  ),
  storage: z.array(z.object({ item: z.string(), quantity: z.number() })),
  nearbyResources: z.array(
    z.object({
      resource: z.string(),
      purity: z.string().nullable(),
      distanceMetres: z.number(),
      bearing: z.string(),
      biome: z.string().nullable(),
    }),
  ),
});

export type SaveSummary = z.infer<typeof saveSummarySchema>;
