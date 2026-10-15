// REST routes for the user's foreman library (create, list, fetch, update and delete personas).

import { Router, type Request } from 'express';

import type { AppDeps } from '../deps.js';
import { requireForemanOwnership } from '../middleware/auth.js';
import { createForemanSchema, updateForemanSchema } from '../validation.js';

/**
 * Routes for the foreman library: create, list, fetch, update, and delete
 * reusable foreman personas. Every route runs behind {@link requireAuth}
 * (mounted in app.ts); reads/updates/deletes additionally require that the
 * caller owns the foreman, and creation binds it to the caller.
 */
export function foremenRouter(deps: AppDeps): Router {
  const router = Router();
  const ownsForeman = requireForemanOwnership(deps.foremen);

  const foremanId = (req: Request): string => {
    const { foremanId: id = '' } = req.params as { foremanId?: string };
    return id;
  };

  router.post('/', async (req, res) => {
    const parsed = createForemanSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const foreman = await deps.foremen.create({ ...parsed.data, userId: req.user!.id });
    res.status(201).json(foreman);
  });

  // List the caller's own foremen, most recently updated first.
  router.get('/', async (req, res) => {
    res.json(await deps.foremen.listForUser(req.user!.id));
  });

  router.get('/:foremanId', ownsForeman, async (req, res) => {
    const foreman = await deps.foremen.get(foremanId(req));
    if (foreman === undefined) {
      res.status(404).json({ error: 'Foreman not found.' });
      return;
    }
    res.json(foreman);
  });

  router.patch('/:foremanId', ownsForeman, async (req, res) => {
    const parsed = updateForemanSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const foreman = await deps.foremen.update(foremanId(req), parsed.data);
    if (foreman === undefined) {
      res.status(404).json({ error: 'Foreman not found.' });
      return;
    }
    res.json(foreman);
  });

  // Delete a foreman. A foreman still attached to a playthrough cannot be
  // deleted (the FK restricts it) — surface that as 409 rather than 500.
  router.delete('/:foremanId', ownsForeman, async (req, res) => {
    try {
      const deleted = await deps.foremen.delete(foremanId(req));
      if (!deleted) {
        res.status(404).json({ error: 'Foreman not found.' });
        return;
      }
      res.status(204).end();
    } catch {
      res.status(409).json({ error: 'Foreman is still attached to a playthrough.' });
    }
  });

  return router;
}
