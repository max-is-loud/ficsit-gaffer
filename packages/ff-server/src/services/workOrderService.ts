// Persistence and lifecycle for work orders: creation, queries, state transitions, plan revisions
// and reverts, execution progress, collectible reconciliation, audit events, and conversion between
// database rows and API shapes.

import { randomUUID } from 'node:crypto';

import type {
  Prisma,
  PrismaClient,
  WorkOrder as WorkOrderRow,
  WorkOrderAuditEvent as AuditRow,
  WorkOrderRevision as RevisionRow,
} from '@prisma/client';

import type {
  Buildable,
  BuildableDef,
  BuildCostLine,
  CollectibleSyncSummary,
  ExpectedOutput,
  ExploreWaypoint,
  LocationRecommendation,
  OrderType,
  PioneerFeedback,
  RecipeAssignment,
  ResourceNodeReference,
  WorkOrder,
  WorkOrderAuditEvent,
  WorkOrderAuditEventType,
  WorkOrderActor,
  WorkOrderFieldChange,
  WorkOrderOpportunities,
  WorkOrderPlanSnapshot,
  WorkOrderRelationshipType,
  WorkOrderRevision,
  WorkOrderRevisionDiff,
  WorkOrderState,
  WorkOrderStep,
  WorkOrderStepDef,
} from '../types.js';
import {
  transitionEventType,
  validateTransition,
  type WorkOrderAction,
} from './workOrderTransitions.js';

/** A buildable as supplied to create/revise — ids generated if absent; cost server-filled. */
export interface BuildableInput {
  id?: string;
  name: string;
  buildingClass?: string;
  requiredCount: number;
  builtCount?: number;
  recipeName?: string;
  notes?: string;
  buildCost?: BuildCostLine[];
}
export interface WorkOrderStepInput {
  id?: string;
  title: string;
  description?: string;
  checked?: boolean;
  order?: number;
  buildables?: BuildableInput[];
}

/** Plan fields the Foreman supplies when issuing or revising an order. */
export interface WorkOrderPlanInput {
  title: string;
  goal: string;
  objective?: string;
  strategicSignificance?: string;
  successCondition?: string;
  tier?: number;
  notes?: string[];
  locationRecommendation?: LocationRecommendation;
  resourceNodes?: ResourceNodeReference[];
  recipes?: RecipeAssignment[];
  expectedOutputs?: ExpectedOutput[];
  buildSteps?: WorkOrderStepInput[];
  /** Explore orders (#207): the server-derived collection route. */
  orderType?: OrderType;
  waypoints?: ExploreWaypoint[];
  opportunities?: WorkOrderOpportunities;
  blockedReason?: string;
  blockedResolutionHint?: string;
}

export interface CreateWorkOrderInput extends WorkOrderPlanInput {
  parentWorkOrderId?: string;
  relationshipToParent?: WorkOrderRelationshipType;
}

/** A plan patch: any subset of plan fields. Omitted fields are left unchanged. */
export type UpdatePlanInput = Partial<WorkOrderPlanInput>;

/** Extra payload carried by a state transition (per-action required fields). */
export interface TransitionOptions {
  blockedReason?: string;
  blockedResolutionHint?: string;
  resolutionNote?: string;
  cancellationReason?: string;
  supersededByWorkOrderId?: string;
  supersededReason?: string;
  forceCompletionReason?: string;
  incompleteItemSummary?: string;
  completionSummary?: string;
  pioneerFeedback?: PioneerFeedback;
}

export type FailureReason =
  'notFound' | 'terminal' | 'state' | 'actor' | 'requirement' | 'conflict';

export type WorkOrderOutcome =
  { ok: true; order: WorkOrder } | { ok: false; reason: FailureReason; message: string };

/**
 * Persistence and lifecycle for work orders (v2), per docs/work-orders.md.
 *
 * Key invariants:
 * - Sequence numbers are per-playthrough and monotonic (rendered WO-001, …).
 * - At most one `active` order per playthrough, but multiple non-terminal orders may
 *   coexist (a blocked parent + an active child). Creating an order no longer
 *   supersedes the current one — supersession is explicit.
 * - Plan vs execution are separate: plan changes write a new plan-only revision
 *   snapshot and bump `currentRevision`; execution mutations (check/uncheck,
 *   built count, hours) append an audit event ONLY. Reverting restores a plan
 *   and merges current execution state forward by stable id.
 */
export class WorkOrderService {
  public constructor(private readonly prisma: PrismaClient) {}

  // --- Creation ------------------------------------------------------------

  /** Issues a new work order in the `new` state with an initial revision. */
  public async create(
    playthroughId: string,
    input: CreateWorkOrderInput,
    version: string,
    actor: WorkOrderActor = 'Foreman',
  ): Promise<WorkOrder> {
    const buildSteps = normaliseSteps(input.buildSteps ?? []);

    const row = await this.prisma.$transaction(async (tx): Promise<WorkOrderRow> => {
      const aggregate = await tx.workOrder.aggregate({
        where: { playthroughId },
        _max: { sequenceNumber: true },
      });
      const nextSequence = (aggregate._max.sequenceNumber ?? 0) + 1;

      const created = await tx.workOrder.create({
        data: {
          playthroughId,
          sequenceNumber: nextSequence,
          state: 'new',
          version,
          title: input.title,
          goal: input.goal,
          objective: input.objective ?? null,
          strategicSignificance: input.strategicSignificance ?? null,
          successCondition: input.successCondition ?? null,
          tier: input.tier ?? null,
          notes: toJsonOrNull(input.notes),
          locationRecommendation: toJsonOrNull(input.locationRecommendation),
          resourceNodes: toJsonOrNull(input.resourceNodes),
          // machines/buildMaterials columns are retired (#62) — kept empty for the
          // non-nullable column; the live model derives cost from step buildables.
          machines: '[]',
          buildMaterials: '[]',
          recipes: JSON.stringify(input.recipes ?? []),
          expectedOutputs: JSON.stringify(input.expectedOutputs ?? []),
          buildSteps: JSON.stringify(buildSteps),
          orderType: input.orderType ?? 'build',
          waypoints: JSON.stringify(input.waypoints ?? []),
          opportunities: toJsonOrNull(input.opportunities),
          blockedReason: input.blockedReason ?? null,
          blockedResolutionHint: input.blockedResolutionHint ?? null,
          currentRevision: 1,
          // The original issue is implicitly acknowledged — it is the first plan,
          // not a revision for the Pioneer to review. Only later revisions
          // (currentRevision > lastAcknowledgedRevision) raise the banner.
          lastAcknowledgedRevision: 1,
          parentWorkOrderId: input.parentWorkOrderId ?? null,
          relationshipToParent: input.relationshipToParent ?? null,
        },
      });

      await this.writeRevision(tx, created.id, 1, actor, planSnapshotFromRow(created), {
        changeSummary: 'Work order issued.',
      });
      await this.appendAudit(tx, created.id, actor, 'work_order_created', {
        revisionNumber: 1,
      });
      if (created.parentWorkOrderId !== null) {
        await this.appendAudit(tx, created.parentWorkOrderId, actor, 'child_work_order_created', {
          note: `Child ${formatWorkOrderLabel(created.sequenceNumber, created.orderType as OrderType)} created.`,
          details: { childWorkOrderId: created.id },
        });
      }
      return created;
    });

    return this.hydrate(row);
  }

  // --- Reads ---------------------------------------------------------------

  /** All work orders for a playthrough, oldest first (history order). */
  public async list(playthroughId: string): Promise<WorkOrder[]> {
    const rows = await this.prisma.workOrder.findMany({
      where: { playthroughId },
      orderBy: { sequenceNumber: 'asc' },
    });
    const childIds = childIdMap(rows);
    return rows.map((row) => rowToWorkOrder(row, childIds.get(row.id) ?? []));
  }

  /** The playthrough's current active order, or undefined if none. */
  public async getActive(playthroughId: string): Promise<WorkOrder | undefined> {
    const row = await this.prisma.workOrder.findFirst({
      where: { playthroughId, state: 'active' },
    });
    return row === null ? undefined : this.hydrate(row);
  }

  /**
   * The order the foreman should act on by default: the active one, else the
   * latest non-terminal order. A freshly-issued order is `new` (not `active`)
   * until the Pioneer starts it, so `getActive` alone would miss it — which left
   * the foreman unable to revise/complete an order it had only just issued.
   */
  public async getCurrent(playthroughId: string): Promise<WorkOrder | undefined> {
    const active = await this.prisma.workOrder.findFirst({
      where: { playthroughId, state: 'active' },
    });
    if (active !== null) {
      return this.hydrate(active);
    }
    const latest = await this.prisma.workOrder.findFirst({
      where: { playthroughId, state: { in: ['new', 'paused', 'blocked'] } },
      orderBy: { sequenceNumber: 'desc' },
    });
    return latest === null ? undefined : this.hydrate(latest);
  }

  /** A single order by id, scoped to its playthrough. */
  public async get(playthroughId: string, id: string): Promise<WorkOrder | undefined> {
    const row = await this.prisma.workOrder.findFirst({ where: { id, playthroughId } });
    return row === null ? undefined : this.hydrate(row);
  }

  /** Direct children of an order, oldest first. */
  public async getChildren(playthroughId: string, id: string): Promise<WorkOrder[]> {
    const rows = await this.prisma.workOrder.findMany({
      where: { playthroughId, parentWorkOrderId: id },
      orderBy: { sequenceNumber: 'asc' },
    });
    return Promise.all(rows.map((row) => this.hydrate(row)));
  }

  /** The parent of an order, or undefined if it has none. */
  public async getParent(playthroughId: string, id: string): Promise<WorkOrder | undefined> {
    const row = await this.prisma.workOrder.findFirst({ where: { id, playthroughId } });
    if (row === null || row.parentWorkOrderId === null) {
      return undefined;
    }
    return this.get(playthroughId, row.parentWorkOrderId);
  }

  public async getAuditTrail(playthroughId: string, id: string): Promise<WorkOrderAuditEvent[]> {
    const exists = await this.prisma.workOrder.findFirst({ where: { id, playthroughId } });
    if (exists === null) {
      return [];
    }
    const rows = await this.prisma.workOrderAuditEvent.findMany({
      where: { workOrderId: id },
      orderBy: { timestamp: 'asc' },
    });
    return rows.map(auditRowToEvent);
  }

  public async getRevisions(playthroughId: string, id: string): Promise<WorkOrderRevision[]> {
    const exists = await this.prisma.workOrder.findFirst({ where: { id, playthroughId } });
    if (exists === null) {
      return [];
    }
    const rows = await this.prisma.workOrderRevision.findMany({
      where: { workOrderId: id },
      orderBy: { revisionNumber: 'asc' },
    });
    return rows.map(revisionRowToRevision);
  }

  public async getRevision(
    playthroughId: string,
    id: string,
    revisionNumber: number,
  ): Promise<WorkOrderRevision | undefined> {
    const exists = await this.prisma.workOrder.findFirst({ where: { id, playthroughId } });
    if (exists === null) {
      return undefined;
    }
    const row = await this.prisma.workOrderRevision.findFirst({
      where: { workOrderId: id, revisionNumber },
    });
    return row === null ? undefined : revisionRowToRevision(row);
  }

  /**
   * Field-level diff between two plan revisions (for the "plan revised" banner).
   * Defaults to the latest change: `to` = currentRevision, `from` = to − 1.
   * Returns undefined if the order or either revision is missing.
   */
  public async diffRevisions(
    playthroughId: string,
    id: string,
    fromRevision?: number,
    toRevision?: number,
  ): Promise<WorkOrderRevisionDiff | undefined> {
    const order = await this.prisma.workOrder.findFirst({ where: { id, playthroughId } });
    if (order === null) {
      return undefined;
    }
    const to = toRevision ?? order.currentRevision;
    const from = fromRevision ?? Math.max(1, to - 1);
    const [fromRow, toRow] = await Promise.all([
      this.prisma.workOrderRevision.findFirst({ where: { workOrderId: id, revisionNumber: from } }),
      this.prisma.workOrderRevision.findFirst({ where: { workOrderId: id, revisionNumber: to } }),
    ]);
    if (fromRow === null || toRow === null) {
      return undefined;
    }
    const before = parseJson<WorkOrderPlanSnapshot | null>(fromRow.planSnapshot, null);
    const after = parseJson<WorkOrderPlanSnapshot | null>(toRow.planSnapshot, null);
    if (before === null || after === null) {
      return undefined;
    }
    return { fromRevision: from, toRevision: to, changes: diffSnapshots(before, after) };
  }

  // --- State transitions ---------------------------------------------------

  /**
   * Applies a state transition, validating against the current state and actor.
   * Enforces the single-active invariant when entering `active`. Sets the
   * relevant operational timestamp and appends an audit event. Required
   * per-action fields (block reason, cancellation reason, …) are checked here.
   */
  public async transition(
    playthroughId: string,
    id: string,
    action: WorkOrderAction,
    actor: WorkOrderActor,
    opts: TransitionOptions = {},
  ): Promise<WorkOrderOutcome> {
    return this.prisma.$transaction(async (tx): Promise<WorkOrderOutcome> => {
      const row = await tx.workOrder.findFirst({ where: { id, playthroughId } });
      if (row === null) {
        return notFound();
      }
      const current = row.state as WorkOrderState;
      const result = validateTransition(current, action, actor);
      if (!result.ok) {
        return { ok: false, reason: result.reason, message: result.message };
      }

      const missing = missingRequirement(action, opts);
      if (missing !== undefined) {
        return { ok: false, reason: 'requirement', message: missing };
      }

      // Single-active invariant: only one `active` order per playthrough.
      if (result.to === 'active') {
        const otherActive = await tx.workOrder.findFirst({
          where: { playthroughId, state: 'active', id: { not: id } },
        });
        if (otherActive !== null) {
          return {
            ok: false,
            reason: 'conflict',
            message: `Another work order (${formatWorkOrderLabel(otherActive.sequenceNumber)}) is already active. Pause or close it first.`,
          };
        }
      }

      const now = new Date();
      const data: Prisma.WorkOrderUpdateInput = { state: result.to };
      const details: Record<string, unknown> = {};

      switch (action) {
        case 'Start':
          if (row.startedAt === null) {
            data.startedAt = now;
          }
          break;
        case 'Pause':
          data.pausedAt = now;
          break;
        case 'Block':
          data.blockedAt = now;
          data.blockedReason = opts.blockedReason ?? null;
          data.blockedResolutionHint = opts.blockedResolutionHint ?? null;
          details.blockedReason = opts.blockedReason;
          details.blockedResolutionHint = opts.blockedResolutionHint;
          break;
        case 'Unblock':
          data.blockedReason = null;
          data.blockedResolutionHint = null;
          details.resolutionNote = opts.resolutionNote;
          break;
        case 'Complete':
        case 'ForceComplete':
          data.completedAt = now;
          if (opts.completionSummary !== undefined) {
            data.completionSummary = opts.completionSummary;
          }
          if (opts.pioneerFeedback !== undefined) {
            data.pioneerFeedback = JSON.stringify(opts.pioneerFeedback);
          }
          if (action === 'ForceComplete') {
            details.forceCompletionReason = opts.forceCompletionReason;
            details.incompleteItemSummary = opts.incompleteItemSummary;
          }
          break;
        case 'Cancel':
          details.cancellationReason = opts.cancellationReason;
          break;
        case 'Supersede':
          details.supersededByWorkOrderId = opts.supersededByWorkOrderId;
          details.supersededReason = opts.supersededReason;
          break;
        default:
          break;
      }

      const updated = await tx.workOrder.update({ where: { id }, data });
      await this.appendAudit(
        tx,
        id,
        actor,
        transitionEventType(action) as WorkOrderAuditEventType,
        {
          note: opts.resolutionNote,
          details: Object.keys(details).length > 0 ? details : undefined,
        },
      );

      // Auto-unblock the parent when a child completes and resolves its block.
      if (
        (action === 'Complete' || action === 'ForceComplete') &&
        updated.parentWorkOrderId !== null
      ) {
        await this.onChildCompleted(tx, playthroughId, updated);
      }

      return { ok: true, order: await this.hydrateTx(tx, updated) };
    });
  }

  // --- Plan revision -------------------------------------------------------

  /**
   * Applies a Foreman plan edit: merges the patch over the current plan, merges
   * execution state forward by stable id for any replaced checklist, writes a
   * new plan-only revision snapshot, bumps `currentRevision`, and appends a
   * `work_order_revised` audit event. Non-terminal orders only.
   */
  public async updatePlan(
    playthroughId: string,
    id: string,
    patch: UpdatePlanInput,
    actor: WorkOrderActor = 'Foreman',
    meta: { reason?: string; changeSummary?: string } = {},
  ): Promise<WorkOrderOutcome> {
    return this.prisma.$transaction(async (tx): Promise<WorkOrderOutcome> => {
      const row = await tx.workOrder.findFirst({ where: { id, playthroughId } });
      if (row === null) {
        return notFound();
      }
      if (isTerminalState(row.state)) {
        return {
          ok: false,
          reason: 'terminal',
          message: `Work order is ${row.state} (terminal) and cannot be revised.`,
        };
      }

      const data: Prisma.WorkOrderUpdateInput = {};
      assignPlainPlanFields(data, patch);

      // Steps merge execution state forward by id (step checked + per-buildable
      // built counts) when replaced.
      if (patch.buildSteps !== undefined) {
        data.buildSteps = JSON.stringify(
          mergeSteps(normaliseSteps(patch.buildSteps), parseSteps(row.buildSteps)),
        );
      }

      const previousRevision = row.currentRevision;
      const nextRevision = previousRevision + 1;
      data.currentRevision = nextRevision;

      const updated = await tx.workOrder.update({ where: { id }, data });
      await this.writeRevision(tx, id, nextRevision, actor, planSnapshotFromRow(updated), {
        reason: meta.reason,
        changeSummary: meta.changeSummary,
      });
      await this.appendAudit(tx, id, actor, 'work_order_revised', {
        revisionNumber: nextRevision,
        previousRevisionNumber: previousRevision,
        note: meta.changeSummary,
      });
      // More specific audit events alongside the generic revision, so the trail
      // distinguishes a recipe swap or a build-plan adaptation at a glance.
      if (patch.recipes !== undefined) {
        await this.appendAudit(tx, id, actor, 'recipe_choice_changed', {
          revisionNumber: nextRevision,
          note: meta.changeSummary,
        });
      }
      if (patch.buildSteps !== undefined || patch.expectedOutputs !== undefined) {
        await this.appendAudit(tx, id, actor, 'build_plan_adapted', {
          revisionNumber: nextRevision,
          note: meta.changeSummary,
        });
      }

      return { ok: true, order: await this.hydrateTx(tx, updated) };
    });
  }

  /** Marks the current (or a given) revision acknowledged by the Pioneer. */
  public async acknowledgeRevision(
    playthroughId: string,
    id: string,
    revisionNumber?: number,
    actor: WorkOrderActor = 'Pioneer',
  ): Promise<WorkOrderOutcome> {
    return this.prisma.$transaction(async (tx): Promise<WorkOrderOutcome> => {
      const row = await tx.workOrder.findFirst({ where: { id, playthroughId } });
      if (row === null) {
        return notFound();
      }
      const ack = revisionNumber ?? row.currentRevision;
      const updated = await tx.workOrder.update({
        where: { id },
        data: { lastAcknowledgedRevision: ack },
      });
      await this.appendAudit(tx, id, actor, 'revision_acknowledged', { revisionNumber: ack });
      return { ok: true, order: await this.hydrateTx(tx, updated) };
    });
  }

  /**
   * Reverts a non-terminal order to a previous plan revision. Restores the
   * plan ONLY: a new revision is created carrying the target snapshot, and the
   * Pioneer's execution state (checked flags, built counts, hours) is merged
   * forward by id and preserved. History is never deleted.
   */
  public async revertToRevision(
    playthroughId: string,
    id: string,
    revisionNumber: number,
    actor: WorkOrderActor = 'Pioneer',
  ): Promise<WorkOrderOutcome> {
    return this.prisma.$transaction(async (tx): Promise<WorkOrderOutcome> => {
      const row = await tx.workOrder.findFirst({ where: { id, playthroughId } });
      if (row === null) {
        return notFound();
      }
      if (isTerminalState(row.state)) {
        return {
          ok: false,
          reason: 'terminal',
          message: `Work order is ${row.state} (terminal) and cannot be reverted.`,
        };
      }
      const target = await tx.workOrderRevision.findFirst({
        where: { workOrderId: id, revisionNumber },
      });
      if (target === null) {
        return { ok: false, reason: 'notFound', message: `Revision ${revisionNumber} not found.` };
      }

      const snapshot = parseJson<WorkOrderPlanSnapshot | null>(target.planSnapshot, null);
      if (snapshot === null) {
        return { ok: false, reason: 'state', message: 'Stored snapshot could not be read.' };
      }

      const previousRevision = row.currentRevision;
      const nextRevision = previousRevision + 1;

      const data: Prisma.WorkOrderUpdateInput = {
        title: snapshot.title,
        goal: snapshot.goal,
        objective: snapshot.objective ?? null,
        strategicSignificance: snapshot.strategicSignificance ?? null,
        successCondition: snapshot.successCondition ?? null,
        tier: snapshot.tier ?? null,
        notes: toJsonOrNull(snapshot.notes),
        locationRecommendation: toJsonOrNull(snapshot.locationRecommendation),
        resourceNodes: toJsonOrNull(snapshot.resourceNodes),
        recipes: JSON.stringify(snapshot.recipes ?? []),
        expectedOutputs: JSON.stringify(snapshot.expectedOutputs ?? []),
        opportunities: toJsonOrNull(snapshot.opportunities),
        blockedReason: snapshot.blockedReason ?? null,
        blockedResolutionHint: snapshot.blockedResolutionHint ?? null,
        relationshipToParent: snapshot.relationshipToParent ?? null,
        // Merge execution state forward from the live row by stable id (step checked +
        // per-buildable built counts).
        buildSteps: JSON.stringify(
          mergeSteps(stepsFromDefs(snapshot.buildSteps), parseSteps(row.buildSteps)),
        ),
        currentRevision: nextRevision,
      };

      const updated = await tx.workOrder.update({ where: { id }, data });
      await this.writeRevision(tx, id, nextRevision, actor, planSnapshotFromRow(updated), {
        reason: `Reverted to revision ${revisionNumber}.`,
        changeSummary: `Restored plan from revision ${revisionNumber}; execution progress preserved.`,
      });
      await this.appendAudit(tx, id, actor, 'reverted_to_revision', {
        revisionNumber: nextRevision,
        previousRevisionNumber: previousRevision,
        note: `Restored plan from revision ${revisionNumber}.`,
        details: { restoredFromRevision: revisionNumber },
      });
      return { ok: true, order: await this.hydrateTx(tx, updated) };
    });
  }

  // --- Execution mutations (audit-only, no revision) -----------------------

  public async setStepChecked(
    playthroughId: string,
    id: string,
    stepId: string,
    checked: boolean,
    actor: WorkOrderActor = 'Pioneer',
  ): Promise<WorkOrderOutcome> {
    return this.mutateChecklist(playthroughId, id, actor, (row) => {
      const items = parseSteps(row.buildSteps);
      const item = items.find((s) => s.id === stepId);
      if (item === undefined) {
        return { error: `Step '${stepId}' not found.` };
      }
      item.checked = checked;
      return {
        data: { buildSteps: JSON.stringify(items) },
        eventType: checked ? 'step_checked' : 'step_unchecked',
        details: { stepId, title: item.title },
      };
    });
  }

  public async setBuildableBuiltCount(
    playthroughId: string,
    id: string,
    stepId: string,
    buildableId: string,
    builtCount: number,
    actor: WorkOrderActor = 'Pioneer',
  ): Promise<WorkOrderOutcome> {
    return this.mutateChecklist(playthroughId, id, actor, (row) => {
      const steps = parseSteps(row.buildSteps);
      const step = steps.find((s) => s.id === stepId);
      if (step === undefined) {
        return { error: `Step '${stepId}' not found.` };
      }
      const item = step.buildables.find((b) => b.id === buildableId);
      if (item === undefined) {
        return { error: `Buildable '${buildableId}' not found in step '${stepId}'.` };
      }
      const previous = item.builtCount;
      item.builtCount = builtCount;
      return {
        data: { buildSteps: JSON.stringify(steps) },
        eventType: 'buildable_built_count_changed',
        details: { stepId, buildableId, name: item.name, from: previous, to: builtCount },
      };
    });
  }

  /** Marks one explore-order collectible collected/uncollected (per-collectible execution). */
  public async markCollectibleCollected(
    playthroughId: string,
    id: string,
    waypointId: string,
    collectibleId: string,
    collected: boolean,
    actor: WorkOrderActor = 'Pioneer',
  ): Promise<WorkOrderOutcome> {
    return this.mutateChecklist(playthroughId, id, actor, (row) => {
      const waypoints = parseJson<ExploreWaypoint[]>(row.waypoints, []);
      const waypoint = waypoints.find((w) => w.id === waypointId);
      if (waypoint === undefined) {
        return { error: `Waypoint '${waypointId}' not found.` };
      }
      const item = waypoint.collectibles.find((c) => c.id === collectibleId);
      if (item === undefined) {
        return { error: `Collectible '${collectibleId}' not found in waypoint '${waypointId}'.` };
      }
      const previous = item.collected;
      item.collected = collected;
      return {
        data: { waypoints: JSON.stringify(waypoints) },
        eventType: 'collectible_collected',
        details: { waypointId, collectibleId, kind: item.kind, from: previous, to: collected },
      };
    });
  }

  /**
   * Reconciles active explore orders against a re-uploaded save (#209-B): marks a collectible
   * collected when its guid is in the save's collected-pickup set or its schematic is unlocked.
   * MONOTONIC — only un-collected→collected (a save can't un-collect), so recorded progress is
   * never erased. Writes a `System` audit event per changed order and returns a summary.
   */
  public async reconcileCollectibles(
    playthroughId: string,
    collectedGuids: Set<string>,
    unlockedSchematics: Set<string>,
  ): Promise<CollectibleSyncSummary> {
    const rows = await this.prisma.workOrder.findMany({
      where: { playthroughId, orderType: 'explore' },
    });
    const summary: CollectibleSyncSummary = { synced: 0, orders: [] };
    for (const row of rows) {
      if (isTerminalState(row.state)) {
        continue;
      }
      const waypoints = parseJson<ExploreWaypoint[]>(row.waypoints, []);
      let changed = 0;
      for (const waypoint of waypoints) {
        for (const c of waypoint.collectibles) {
          if (c.collected) {
            continue;
          }
          const nowCollected =
            (c.guid !== undefined && collectedGuids.has(c.guid)) ||
            (c.schematic !== undefined && unlockedSchematics.has(c.schematic));
          if (nowCollected) {
            c.collected = true;
            changed += 1;
          }
        }
      }
      if (changed > 0) {
        await this.prisma.$transaction(async (tx) => {
          await tx.workOrder.update({
            where: { id: row.id },
            data: { waypoints: JSON.stringify(waypoints) },
          });
          await this.appendAudit(tx, row.id, 'System', 'collectible_collected', {
            note: `Save synced: ${changed} collectible(s) marked collected on re-upload.`,
            details: { syncedCount: changed, source: 'save_reupload' },
          });
        });
        summary.synced += changed;
        summary.orders.push({
          id: row.id,
          label: formatWorkOrderLabel(row.sequenceNumber, 'explore'),
          collected: changed,
        });
      }
    }
    return summary;
  }

  /** Adds to the manually-logged hours total. */
  public async logHours(
    playthroughId: string,
    id: string,
    hours: number,
    actor: WorkOrderActor = 'Pioneer',
  ): Promise<WorkOrderOutcome> {
    return this.mutateChecklist(playthroughId, id, actor, (row) => {
      const total = (row.hoursLogged ?? 0) + hours;
      return {
        data: { hoursLogged: total },
        eventType: 'hours_logged',
        details: { added: hours, total },
      };
    });
  }

  /**
   * The Foreman proposes completion (Option A) — it records the suggestion but
   * does NOT complete the order. Only the Pioneer may complete.
   */
  public async proposeCompletion(
    playthroughId: string,
    id: string,
    note?: string,
    actor: WorkOrderActor = 'Foreman',
  ): Promise<WorkOrderOutcome> {
    return this.prisma.$transaction(async (tx): Promise<WorkOrderOutcome> => {
      const row = await tx.workOrder.findFirst({ where: { id, playthroughId } });
      if (row === null) {
        return notFound();
      }
      if (isTerminalState(row.state)) {
        return {
          ok: false,
          reason: 'terminal',
          message: `Work order is ${row.state} (terminal).`,
        };
      }
      if (row.state === 'new') {
        // Completion only makes sense once work is under way: the pioneer must
        // start it first (Complete is allowed only from `active`). Proposing
        // completion of an unstarted order is nonsensical.
        return {
          ok: false,
          reason: 'state',
          message: `${formatWorkOrderLabel(row.sequenceNumber)} hasn't been started yet — it can't be completed until the pioneer starts it.`,
        };
      }
      await this.appendAudit(tx, id, actor, 'completion_proposed', { note });
      return { ok: true, order: await this.hydrateTx(tx, row) };
    });
  }

  // --- Internals -----------------------------------------------------------

  private async mutateChecklist(
    playthroughId: string,
    id: string,
    actor: WorkOrderActor,
    apply: (row: WorkOrderRow) =>
      | { error: string }
      | {
          data: Prisma.WorkOrderUpdateInput;
          eventType: WorkOrderAuditEventType;
          details?: unknown;
        },
  ): Promise<WorkOrderOutcome> {
    return this.prisma.$transaction(async (tx): Promise<WorkOrderOutcome> => {
      const row = await tx.workOrder.findFirst({ where: { id, playthroughId } });
      if (row === null) {
        return notFound();
      }
      if (isTerminalState(row.state)) {
        return {
          ok: false,
          reason: 'terminal',
          message: `Work order is ${row.state} (terminal); execution state is locked.`,
        };
      }
      const result = apply(row);
      if ('error' in result) {
        return { ok: false, reason: 'notFound', message: result.error };
      }
      const updated = await tx.workOrder.update({ where: { id }, data: result.data });
      await this.appendAudit(tx, id, actor, result.eventType, { details: result.details });
      return { ok: true, order: await this.hydrateTx(tx, updated) };
    });
  }

  /** Auto-unblock the parent when a child completes (with audit on the parent). */
  private async onChildCompleted(
    tx: Prisma.TransactionClient,
    playthroughId: string,
    child: WorkOrderRow,
  ): Promise<void> {
    if (child.parentWorkOrderId === null) {
      return;
    }
    const parent = await tx.workOrder.findFirst({
      where: { id: child.parentWorkOrderId, playthroughId },
    });
    if (parent === null) {
      return;
    }
    await this.appendAudit(tx, parent.id, 'System', 'child_work_order_completed', {
      note: `Child ${formatWorkOrderLabel(child.sequenceNumber)} completed.`,
      details: { childWorkOrderId: child.id },
    });
    if (parent.state !== 'blocked') {
      return;
    }
    // Only auto-unblock when no other order is currently active.
    const otherActive = await tx.workOrder.findFirst({
      where: { playthroughId, state: 'active', id: { not: parent.id } },
    });
    if (otherActive !== null) {
      return;
    }
    await tx.workOrder.update({
      where: { id: parent.id },
      data: { state: 'active', blockedReason: null, blockedResolutionHint: null },
    });
    await this.appendAudit(tx, parent.id, 'System', 'unblocked', {
      note: `Auto-unblocked: child ${formatWorkOrderLabel(child.sequenceNumber)} resolved the blocker.`,
      details: { childWorkOrderId: child.id },
    });
  }

  private async writeRevision(
    tx: Prisma.TransactionClient,
    workOrderId: string,
    revisionNumber: number,
    createdBy: WorkOrderActor,
    snapshot: WorkOrderPlanSnapshot,
    meta: { reason?: string; changeSummary?: string } = {},
  ): Promise<void> {
    await tx.workOrderRevision.create({
      data: {
        workOrderId,
        revisionNumber,
        createdBy,
        reason: meta.reason ?? null,
        changeSummary: meta.changeSummary ?? null,
        planSnapshot: JSON.stringify(snapshot),
      },
    });
  }

  private async appendAudit(
    tx: Prisma.TransactionClient,
    workOrderId: string,
    actor: WorkOrderActor,
    eventType: WorkOrderAuditEventType,
    extra: {
      revisionNumber?: number;
      previousRevisionNumber?: number;
      note?: string;
      details?: unknown;
    } = {},
  ): Promise<void> {
    await tx.workOrderAuditEvent.create({
      data: {
        workOrderId,
        actor,
        eventType,
        revisionNumber: extra.revisionNumber ?? null,
        previousRevisionNumber: extra.previousRevisionNumber ?? null,
        note: extra.note ?? null,
        details: extra.details === undefined ? null : JSON.stringify(extra.details),
      },
    });
  }

  /** Maps a row to the API shape, fetching derived child ids. */
  private async hydrate(row: WorkOrderRow): Promise<WorkOrder> {
    const children = await this.prisma.workOrder.findMany({
      where: { parentWorkOrderId: row.id },
      select: { id: true },
    });
    return rowToWorkOrder(
      row,
      children.map((c) => c.id),
    );
  }

  private async hydrateTx(tx: Prisma.TransactionClient, row: WorkOrderRow): Promise<WorkOrder> {
    const children = await tx.workOrder.findMany({
      where: { parentWorkOrderId: row.id },
      select: { id: true },
    });
    return rowToWorkOrder(
      row,
      children.map((c) => c.id),
    );
  }
}

// --- Required-field validation per action ----------------------------------

function missingRequirement(action: WorkOrderAction, opts: TransitionOptions): string | undefined {
  switch (action) {
    case 'Block':
      if (!opts.blockedReason || !opts.blockedResolutionHint) {
        return 'Block requires blockedReason and blockedResolutionHint.';
      }
      break;
    case 'Unblock':
      if (!opts.resolutionNote) {
        return 'Unblock requires a resolutionNote.';
      }
      break;
    case 'Cancel':
      if (!opts.cancellationReason) {
        return 'Cancel requires a cancellationReason.';
      }
      break;
    case 'Supersede':
      if (!opts.supersededByWorkOrderId || !opts.supersededReason) {
        return 'Supersede requires supersededByWorkOrderId and supersededReason.';
      }
      break;
    case 'ForceComplete':
      if (!opts.forceCompletionReason || !opts.incompleteItemSummary) {
        return 'ForceComplete requires forceCompletionReason and incompleteItemSummary.';
      }
      break;
    default:
      break;
  }
  return undefined;
}

// --- Pure mapping & normalisation helpers -----------------------------------

/** Renders a sequence number as the human-readable WO-001 form. */
export function formatWorkOrderLabel(
  sequenceNumber: number,
  orderType: OrderType = 'build',
): string {
  const prefix = orderType === 'explore' ? 'EO' : 'WO';
  return `${prefix}-${String(sequenceNumber).padStart(3, '0')}`;
}

function isTerminalState(state: string): boolean {
  return state === 'completed' || state === 'cancelled' || state === 'superseded';
}

function notFound(): WorkOrderOutcome {
  return { ok: false, reason: 'notFound', message: 'Work order not found.' };
}

function normaliseBuildable(b: BuildableInput): Buildable {
  return {
    id: b.id ?? randomUUID(),
    name: b.name,
    requiredCount: b.requiredCount,
    builtCount: b.builtCount ?? 0,
    buildCost: b.buildCost ?? [],
    ...(b.buildingClass !== undefined ? { buildingClass: b.buildingClass } : {}),
    ...(b.recipeName !== undefined ? { recipeName: b.recipeName } : {}),
    ...(b.notes !== undefined ? { notes: b.notes } : {}),
  };
}

function normaliseSteps(input: WorkOrderStepInput[]): WorkOrderStep[] {
  return input.map((s, index) => ({
    id: s.id ?? randomUUID(),
    title: s.title,
    checked: s.checked ?? false,
    order: s.order ?? index,
    buildables: (s.buildables ?? []).map(normaliseBuildable),
    ...(s.description !== undefined ? { description: s.description } : {}),
  }));
}

/**
 * Carry execution state forward across a revision by id: incoming defs win on
 * structure, but a step's `checked` and each surviving buildable's `builtCount`
 * (matched by buildable id) are preserved from the existing order.
 */
function mergeSteps(incoming: WorkOrderStep[], existing: WorkOrderStep[]): WorkOrderStep[] {
  const stepById = new Map(existing.map((s) => [s.id, s]));
  return incoming.map((s) => {
    const prev = stepById.get(s.id);
    const prevBuildables = new Map((prev?.buildables ?? []).map((b) => [b.id, b]));
    return {
      ...s,
      checked: prev?.checked ?? s.checked,
      buildables: s.buildables.map((b) => ({
        ...b,
        builtCount: prevBuildables.get(b.id)?.builtCount ?? b.builtCount,
      })),
    };
  });
}

function buildableFromDef(d: BuildableDef): Buildable {
  return { ...d, builtCount: 0 };
}
function stepsFromDefs(defs: WorkOrderPlanSnapshot['buildSteps']): WorkOrderStep[] {
  return defs.map((d) => ({
    ...d,
    checked: false,
    buildables: (d.buildables ?? []).map(buildableFromDef),
  }));
}

function assignPlainPlanFields(data: Prisma.WorkOrderUpdateInput, patch: UpdatePlanInput): void {
  if (patch.title !== undefined) {
    data.title = patch.title;
  }
  if (patch.goal !== undefined) {
    data.goal = patch.goal;
  }
  if (patch.objective !== undefined) {
    data.objective = patch.objective;
  }
  if (patch.strategicSignificance !== undefined) {
    data.strategicSignificance = patch.strategicSignificance;
  }
  if (patch.successCondition !== undefined) {
    data.successCondition = patch.successCondition;
  }
  if (patch.tier !== undefined) {
    data.tier = patch.tier;
  }
  if (patch.notes !== undefined) {
    data.notes = toJsonOrNull(patch.notes);
  }
  if (patch.locationRecommendation !== undefined) {
    data.locationRecommendation = toJsonOrNull(patch.locationRecommendation);
  }
  if (patch.resourceNodes !== undefined) {
    data.resourceNodes = toJsonOrNull(patch.resourceNodes);
  }
  if (patch.recipes !== undefined) {
    data.recipes = JSON.stringify(patch.recipes);
  }
  if (patch.expectedOutputs !== undefined) {
    data.expectedOutputs = JSON.stringify(patch.expectedOutputs);
  }
  if (patch.opportunities !== undefined) {
    data.opportunities = toJsonOrNull(patch.opportunities);
  }
  if (patch.blockedReason !== undefined) {
    data.blockedReason = patch.blockedReason;
  }
  if (patch.blockedResolutionHint !== undefined) {
    data.blockedResolutionHint = patch.blockedResolutionHint;
  }
}

/**
 * Parses stored steps, tolerating the pre-#62 shape: a step without `buildables`
 * (old orders predating the redesign) defaults to an empty buildables list, and any
 * stored buildable missing `buildCost` defaults to `[]` — so old orders render
 * without crashing rather than needing a migration.
 */
function parseSteps(raw: string): WorkOrderStep[] {
  return parseJson<WorkOrderStep[]>(raw, []).map((s) => ({
    ...s,
    buildables: (s.buildables ?? []).map((b) => ({ ...b, buildCost: b.buildCost ?? [] })),
  }));
}

/** Derives a plan-only snapshot from a stored row (strips execution state). */
function planSnapshotFromRow(row: WorkOrderRow): WorkOrderPlanSnapshot {
  const buildSteps = parseSteps(row.buildSteps).map((s) => {
    const def: WorkOrderStepDef = {
      id: s.id,
      title: s.title,
      order: s.order,
      buildables: s.buildables.map((b) => {
        const bd: BuildableDef = {
          id: b.id,
          name: b.name,
          requiredCount: b.requiredCount,
          buildCost: b.buildCost,
        };
        if (b.buildingClass !== undefined) {
          bd.buildingClass = b.buildingClass;
        }
        if (b.recipeName !== undefined) {
          bd.recipeName = b.recipeName;
        }
        if (b.notes !== undefined) {
          bd.notes = b.notes;
        }
        return bd;
      }),
    };
    if (s.description !== undefined) {
      def.description = s.description;
    }
    return def;
  });

  const snapshot: WorkOrderPlanSnapshot = {
    orderType: row.orderType as OrderType,
    title: row.title,
    goal: row.goal,
    buildSteps,
    recipes: parseJson<RecipeAssignment[]>(row.recipes, []),
    expectedOutputs: parseJson<ExpectedOutput[]>(row.expectedOutputs, []),
  };
  const waypoints = parseJson<ExploreWaypoint[]>(row.waypoints, []);
  if (waypoints.length > 0) {
    snapshot.waypoints = waypoints;
  }
  if (row.objective !== null) {
    snapshot.objective = row.objective;
  }
  if (row.strategicSignificance !== null) {
    snapshot.strategicSignificance = row.strategicSignificance;
  }
  if (row.successCondition !== null) {
    snapshot.successCondition = row.successCondition;
  }
  if (row.tier !== null) {
    snapshot.tier = row.tier;
  }
  if (row.notes !== null) {
    snapshot.notes = parseJson<string[]>(row.notes, []);
  }
  if (row.locationRecommendation !== null) {
    const loc = parseJson<LocationRecommendation | null>(row.locationRecommendation, null);
    if (loc !== null) {
      snapshot.locationRecommendation = loc;
    }
  }
  if (row.resourceNodes !== null) {
    snapshot.resourceNodes = parseJson<ResourceNodeReference[]>(row.resourceNodes, []);
  }
  if (row.opportunities !== null) {
    const opp = parseJson<WorkOrderOpportunities | null>(row.opportunities, null);
    if (opp !== null) {
      snapshot.opportunities = opp;
    }
  }
  if (row.blockedReason !== null) {
    snapshot.blockedReason = row.blockedReason;
  }
  if (row.blockedResolutionHint !== null) {
    snapshot.blockedResolutionHint = row.blockedResolutionHint;
  }
  if (row.relationshipToParent !== null) {
    snapshot.relationshipToParent = row.relationshipToParent as WorkOrderRelationshipType;
  }
  if (row.parentWorkOrderId !== null) {
    snapshot.parentWorkOrderId = row.parentWorkOrderId;
  }
  return snapshot;
}

/** Maps a database row to the API WorkOrder shape, decoding JSON fields. */
export function rowToWorkOrder(row: WorkOrderRow, childWorkOrderIds: string[] = []): WorkOrder {
  const order: WorkOrder = {
    id: row.id,
    sequenceNumber: row.sequenceNumber,
    orderType: row.orderType as OrderType,
    version: row.version,
    state: row.state as WorkOrderState,
    title: row.title,
    goal: row.goal,
    recipes: parseJson<RecipeAssignment[]>(row.recipes, []),
    expectedOutputs: parseJson<ExpectedOutput[]>(row.expectedOutputs, []),
    buildSteps: parseSteps(row.buildSteps),
    currentRevision: row.currentRevision,
    hasUnacknowledgedRevision: row.currentRevision > (row.lastAcknowledgedRevision ?? 0),
    childWorkOrderIds,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  const waypoints = parseJson<ExploreWaypoint[]>(row.waypoints, []);
  if (waypoints.length > 0) {
    order.waypoints = waypoints;
  }
  if (row.objective !== null) {
    order.objective = row.objective;
  }
  if (row.strategicSignificance !== null) {
    order.strategicSignificance = row.strategicSignificance;
  }
  if (row.successCondition !== null) {
    order.successCondition = row.successCondition;
  }
  if (row.tier !== null) {
    order.tier = row.tier;
  }
  if (row.notes !== null) {
    order.notes = parseJson<string[]>(row.notes, []);
  }
  if (row.locationRecommendation !== null) {
    const loc = parseJson<LocationRecommendation | null>(row.locationRecommendation, null);
    if (loc !== null) {
      order.locationRecommendation = loc;
    }
  }
  if (row.resourceNodes !== null) {
    order.resourceNodes = parseJson<ResourceNodeReference[]>(row.resourceNodes, []);
  }
  if (row.opportunities !== null) {
    const opp = parseJson<WorkOrderOpportunities | null>(row.opportunities, null);
    if (opp !== null) {
      order.opportunities = opp;
    }
  }
  if (row.blockedReason !== null) {
    order.blockedReason = row.blockedReason;
  }
  if (row.blockedResolutionHint !== null) {
    order.blockedResolutionHint = row.blockedResolutionHint;
  }
  if (row.startedAt !== null) {
    order.startedAt = row.startedAt.toISOString();
  }
  if (row.pausedAt !== null) {
    order.pausedAt = row.pausedAt.toISOString();
  }
  if (row.blockedAt !== null) {
    order.blockedAt = row.blockedAt.toISOString();
  }
  if (row.completedAt !== null) {
    order.completedAt = row.completedAt.toISOString();
  }
  if (row.hoursLogged !== null) {
    order.hoursLogged = row.hoursLogged;
  }
  if (row.completionSummary !== null) {
    order.completionSummary = row.completionSummary;
  }
  if (row.pioneerFeedback !== null) {
    const feedback = parseJson<PioneerFeedback | null>(row.pioneerFeedback, null);
    if (feedback !== null) {
      order.pioneerFeedback = feedback;
    }
  }
  if (row.lastAcknowledgedRevision !== null) {
    order.lastAcknowledgedRevision = row.lastAcknowledgedRevision;
  }
  if (row.parentWorkOrderId !== null) {
    order.parentWorkOrderId = row.parentWorkOrderId;
  }
  if (row.relationshipToParent !== null) {
    order.relationshipToParent = row.relationshipToParent as WorkOrderRelationshipType;
  }
  return order;
}

function auditRowToEvent(row: AuditRow): WorkOrderAuditEvent {
  const event: WorkOrderAuditEvent = {
    id: row.id,
    workOrderId: row.workOrderId,
    timestamp: row.timestamp.toISOString(),
    actor: row.actor as WorkOrderActor,
    eventType: row.eventType as WorkOrderAuditEventType,
  };
  if (row.revisionNumber !== null) {
    event.revisionNumber = row.revisionNumber;
  }
  if (row.previousRevisionNumber !== null) {
    event.previousRevisionNumber = row.previousRevisionNumber;
  }
  if (row.note !== null) {
    event.note = row.note;
  }
  if (row.details !== null) {
    event.details = parseJson<unknown>(row.details, undefined);
  }
  return event;
}

function revisionRowToRevision(row: RevisionRow): WorkOrderRevision {
  const revision: WorkOrderRevision = {
    id: row.id,
    workOrderId: row.workOrderId,
    revisionNumber: row.revisionNumber,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy as WorkOrderActor,
    planSnapshot: parseJson<WorkOrderPlanSnapshot>(row.planSnapshot, {} as WorkOrderPlanSnapshot),
  };
  if (row.reason !== null) {
    revision.reason = row.reason;
  }
  if (row.changeSummary !== null) {
    revision.changeSummary = row.changeSummary;
  }
  return revision;
}

/** Builds parentId → child-id[] for a batch of rows (avoids N+1 in list()). */
function childIdMap(rows: WorkOrderRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const row of rows) {
    if (row.parentWorkOrderId !== null) {
      const list = map.get(row.parentWorkOrderId) ?? [];
      list.push(row.id);
      map.set(row.parentWorkOrderId, list);
    }
  }
  return map;
}

/** Plan fields compared by the revision diff, in display order. */
const DIFF_FIELDS: readonly (keyof WorkOrderPlanSnapshot)[] = [
  'title',
  'goal',
  'objective',
  'strategicSignificance',
  'successCondition',
  'tier',
  'notes',
  'locationRecommendation',
  'resourceNodes',
  'recipes',
  'expectedOutputs',
  'buildSteps',
  'opportunities',
  'blockedReason',
  'blockedResolutionHint',
  'relationshipToParent',
];

/** Field-level diff of two plan snapshots: one entry per field that differs. */
function diffSnapshots(
  before: WorkOrderPlanSnapshot,
  after: WorkOrderPlanSnapshot,
): WorkOrderFieldChange[] {
  const changes: WorkOrderFieldChange[] = [];
  for (const field of DIFF_FIELDS) {
    const a = before[field];
    const b = after[field];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) {
      changes.push({ field, before: a ?? null, after: b ?? null });
    }
  }
  return changes;
}

function toJsonOrNull(value: unknown): string | null {
  return value === undefined || value === null ? null : JSON.stringify(value);
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
