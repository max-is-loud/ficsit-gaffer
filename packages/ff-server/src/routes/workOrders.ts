// REST routes for a playthrough's work orders: creation and reads, plan edits, transitions,
// revisions, audit trail and the Pioneer's execution progress.

import { Router, type Response } from 'express';

import type { AppDeps } from '../deps.js';
import type { WorkOrderOutcome } from '../services/workOrderService.js';
import type { WorkOrderAction } from '../services/workOrderTransitions.js';
import {
  acknowledgeSchema,
  buildableCountSchema,
  collectibleCollectedSchema,
  logHoursSchema,
  revertSchema,
  stepCheckSchema,
  transitionSchema,
  workOrderCreateSchema,
  workOrderPlanPatchSchema,
} from '../validation.js';

/**
 * Routes for work orders (v2), mounted under
 * /api/playthroughs/:playthroughId/work-orders. The plan is edited via /plan
 * (Foreman), lifecycle via /transitions, and execution progress via the
 * materials/steps/machines/hours endpoints (Pioneer). `mergeParams` exposes the
 * parent :playthroughId. See docs/work-orders.md.
 */
export function workOrdersRouter(deps: AppDeps): Router {
  const router = Router({ mergeParams: true });

  const playthroughId = (req: { params: Record<string, string> }): string =>
    req.params.playthroughId ?? '';

  // --- Creation & reads ----------------------------------------------------

  router.post('/', async (req, res) => {
    const playthrough = await deps.playthroughs.get(playthroughId(req));
    if (playthrough === undefined) {
      res.status(404).json({ error: 'Playthrough not found.' });
      return;
    }
    const parsed = workOrderCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const order = await deps.workOrders.create(playthrough.id, parsed.data, deps.mcp.gameVersion);
    res.status(201).json(order);
  });

  router.get('/', async (req, res) => {
    const playthrough = await deps.playthroughs.get(playthroughId(req));
    if (playthrough === undefined) {
      res.status(404).json({ error: 'Playthrough not found.' });
      return;
    }
    res.json(await deps.workOrders.list(playthrough.id));
  });

  router.get('/active', async (req, res) => {
    const playthrough = await deps.playthroughs.get(playthroughId(req));
    if (playthrough === undefined) {
      res.status(404).json({ error: 'Playthrough not found.' });
      return;
    }
    const active = await deps.workOrders.getActive(playthrough.id);
    if (active === undefined) {
      res.status(404).json({ error: 'No active work order.' });
      return;
    }
    res.json(active);
  });

  router.get('/:id', async (req, res) => {
    const order = await deps.workOrders.get(playthroughId(req), req.params.id);
    if (order === undefined) {
      res.status(404).json({ error: 'Work order not found.' });
      return;
    }
    res.json(order);
  });

  router.get('/:id/children', async (req, res) => {
    res.json(await deps.workOrders.getChildren(playthroughId(req), req.params.id));
  });

  router.get('/:id/parent', async (req, res) => {
    const parent = await deps.workOrders.getParent(playthroughId(req), req.params.id);
    if (parent === undefined) {
      res.status(404).json({ error: 'No parent work order.' });
      return;
    }
    res.json(parent);
  });

  router.get('/:id/audit', async (req, res) => {
    res.json(await deps.workOrders.getAuditTrail(playthroughId(req), req.params.id));
  });

  router.get('/:id/revisions', async (req, res) => {
    res.json(await deps.workOrders.getRevisions(playthroughId(req), req.params.id));
  });

  // Field-level diff between two revisions. ?from=&to= optional; defaults to the
  // latest change (to = current revision, from = to − 1). Registered before the
  // `:n` route so "diff" is not parsed as a revision number.
  router.get('/:id/revisions/diff', async (req, res) => {
    const from = req.query.from !== undefined ? Number(req.query.from) : undefined;
    const to = req.query.to !== undefined ? Number(req.query.to) : undefined;
    if (
      (from !== undefined && !Number.isInteger(from)) ||
      (to !== undefined && !Number.isInteger(to))
    ) {
      res.status(400).json({ error: 'from/to must be integers.' });
      return;
    }
    const diff = await deps.workOrders.diffRevisions(playthroughId(req), req.params.id, from, to);
    if (diff === undefined) {
      res.status(404).json({ error: 'Work order or revision not found.' });
      return;
    }
    res.json(diff);
  });

  router.get('/:id/revisions/:n', async (req, res) => {
    const n = Number(req.params.n);
    if (!Number.isInteger(n)) {
      res.status(400).json({ error: 'Revision number must be an integer.' });
      return;
    }
    const revision = await deps.workOrders.getRevision(playthroughId(req), req.params.id, n);
    if (revision === undefined) {
      res.status(404).json({ error: 'Revision not found.' });
      return;
    }
    res.json(revision);
  });

  // --- Plan edit (Foreman) -------------------------------------------------

  router.patch('/:id/plan', async (req, res) => {
    const parsed = workOrderPlanPatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { reason, changeSummary, ...patch } = parsed.data;
    const meta: { reason?: string; changeSummary?: string } = {};
    if (reason !== undefined) {
      meta.reason = reason;
    }
    if (changeSummary !== undefined) {
      meta.changeSummary = changeSummary;
    }
    const outcome = await deps.workOrders.updatePlan(
      playthroughId(req),
      req.params.id,
      patch,
      'Foreman',
      meta,
    );
    respond(res, outcome);
  });

  // --- Lifecycle transitions ----------------------------------------------

  router.post('/:id/transitions', async (req, res) => {
    const parsed = transitionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { action, actor, ...opts } = parsed.data;
    const outcome = await deps.workOrders.transition(
      playthroughId(req),
      req.params.id,
      action as WorkOrderAction,
      actor ?? 'Pioneer',
      opts,
    );
    respond(res, outcome);
  });

  // --- Execution mutations (Pioneer; audit-only, no revision) --------------

  router.patch('/:id/steps/:stepId', async (req, res) => {
    const parsed = stepCheckSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const outcome = await deps.workOrders.setStepChecked(
      playthroughId(req),
      req.params.id,
      req.params.stepId,
      parsed.data.checked,
    );
    respond(res, outcome);
  });

  router.patch('/:id/steps/:stepId/buildables/:buildableId', async (req, res) => {
    const parsed = buildableCountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const outcome = await deps.workOrders.setBuildableBuiltCount(
      playthroughId(req),
      req.params.id,
      req.params.stepId,
      req.params.buildableId,
      parsed.data.builtCount,
    );
    respond(res, outcome);
  });

  // Explore orders (#207): mark one collectible on a waypoint collected/uncollected.
  router.patch('/:id/waypoints/:waypointId/collectibles/:collectibleId', async (req, res) => {
    const parsed = collectibleCollectedSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const outcome = await deps.workOrders.markCollectibleCollected(
      playthroughId(req),
      req.params.id,
      req.params.waypointId,
      req.params.collectibleId,
      parsed.data.collected,
    );
    respond(res, outcome);
  });

  router.post('/:id/hours', async (req, res) => {
    const parsed = logHoursSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const outcome = await deps.workOrders.logHours(
      playthroughId(req),
      req.params.id,
      parsed.data.hours,
    );
    respond(res, outcome);
  });

  // --- Revisions: acknowledge & revert ------------------------------------

  router.post('/:id/acknowledge', async (req, res) => {
    const parsed = acknowledgeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const outcome = await deps.workOrders.acknowledgeRevision(
      playthroughId(req),
      req.params.id,
      parsed.data.revisionNumber,
    );
    respond(res, outcome);
  });

  router.post('/:id/revert', async (req, res) => {
    const parsed = revertSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const outcome = await deps.workOrders.revertToRevision(
      playthroughId(req),
      req.params.id,
      parsed.data.revisionNumber,
    );
    respond(res, outcome);
  });

  return router;
}

/** Maps a service outcome to an HTTP response. */
function respond(res: Response, outcome: WorkOrderOutcome): void {
  if (outcome.ok) {
    res.json(outcome.order);
    return;
  }
  res.status(statusFor(outcome.reason)).json({ error: outcome.message });
}

function statusFor(reason: Exclude<WorkOrderOutcome, { ok: true }>['reason']): number {
  switch (reason) {
    case 'notFound':
      return 404;
    case 'actor':
      return 403;
    case 'requirement':
      return 400;
    case 'terminal':
    case 'state':
    case 'conflict':
      return 409;
    default:
      return 400;
  }
}
