// REST routes for playthroughs: lifecycle and claiming, message history, and the upload, listing,
// activation and deletion of save versions.

import { Router, type Request } from 'express';
import multer from 'multer';

import type { AppDeps } from '../deps.js';
import { requirePlaythroughOwnership } from '../middleware/auth.js';
import { createPlaythroughSchema, updatePlaythroughSchema } from '../validation.js';

/** Number of recent messages re-hydrated into the chat view on load/switch. */
const MESSAGE_HISTORY_CAP = 500;

/** A Satisfactory `.sav` can be tens of MB; cap uploads generously. */
const MAX_SAVE_BYTES = 64 * 1024 * 1024;

// In-memory upload: the save bytes are handed straight to the SaveService, which
// writes them to the data volume — no temp files on disk.
const uploadSave = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SAVE_BYTES },
}).single('save');

/**
 * Routes for playthrough lifecycle: create, list, fetch, update, and claim.
 * Every route runs behind {@link requireAuth} (mounted in app.ts), so `req.user`
 * is always present. Reads and updates additionally require that the caller owns
 * the playthrough; creation binds the new playthrough to the caller.
 */
export function playthroughsRouter(deps: AppDeps): Router {
  const router = Router();
  const ownsPlaythrough = requirePlaythroughOwnership(deps.playthroughs);

  const playthroughId = (req: Request): string => {
    const { playthroughId: id = '' } = req.params as { playthroughId?: string };
    return id;
  };

  // Create a playthrough owned by the caller, attached to one of their foremen.
  // A client that already holds a local anonymous playthrough id should claim it
  // instead (see POST /:playthroughId/claim).
  router.post('/', async (req, res) => {
    const parsed = createPlaythroughSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (parsed.data.id !== undefined) {
      // The live bridge is bound by playthrough id. Never let a client choose that
      // id, or deleting the linked playthrough would let anyone re-create it and
      // inherit the world's observations.
      if (parsed.data.id === deps.liveState?.binding.playthroughId) {
        res.status(409).json({ error: 'Playthrough id is reserved.' });
        return;
      }
      const existing = await deps.playthroughs.get(parsed.data.id);
      if (existing !== undefined) {
        res.status(409).json({ error: `Playthrough '${parsed.data.id}' already exists.` });
        return;
      }
    }
    // The attached foreman must exist and belong to the caller.
    const owner = await deps.foremen.findOwnerId(parsed.data.foremanId);
    if (owner === undefined) {
      res.status(404).json({ error: 'Foreman not found.' });
      return;
    }
    if (owner.userId !== req.user!.id) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }
    const playthrough = await deps.playthroughs.create({ ...parsed.data, userId: req.user!.id });
    res.status(201).json(playthrough);
  });

  // List the caller's own playthroughs, most recently updated first.
  router.get('/', async (req, res) => {
    res.json(await deps.playthroughs.listForUser(req.user!.id));
  });

  // Claim a pre-accounts anonymous playthrough (one created before sign-in) for
  // the caller. Idempotent if already owned; 403 if owned by another user.
  router.post('/:playthroughId/claim', async (req, res) => {
    // The live-bridge playthrough must already be owned: claiming an unowned row
    // under that id would hand the linked world's observations to the claimer.
    if (playthroughId(req) === deps.liveState?.binding.playthroughId) {
      const owner = await deps.playthroughs.findOwnerId(playthroughId(req));
      if (owner?.userId !== req.user!.id) {
        res.status(403).json({ error: 'Forbidden.' });
        return;
      }
    }
    const result = await deps.playthroughs.claim(playthroughId(req), req.user!.id);
    if (result.ok) {
      res.json(result.playthrough);
      return;
    }
    if (result.reason === 'notFound') {
      res.status(404).json({ error: 'Playthrough not found.' });
      return;
    }
    res.status(403).json({ error: 'Forbidden.' });
  });

  router.get('/:playthroughId', ownsPlaythrough, async (req, res) => {
    const playthrough = await deps.playthroughs.get(playthroughId(req));
    if (playthrough === undefined) {
      res.status(404).json({ error: 'Playthrough not found.' });
      return;
    }
    res.json(playthrough);
  });

  // Update name, pioneer profile, and/or attached foreman. Takes effect on the
  // next message. A foreman swap must target one the caller owns.
  router.patch('/:playthroughId', ownsPlaythrough, async (req, res) => {
    const parsed = updatePlaythroughSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    if (parsed.data.foremanId !== undefined) {
      const owner = await deps.foremen.findOwnerId(parsed.data.foremanId);
      if (owner === undefined) {
        res.status(404).json({ error: 'Foreman not found.' });
        return;
      }
      if (owner.userId !== req.user!.id) {
        res.status(403).json({ error: 'Forbidden.' });
        return;
      }
    }
    const playthrough = await deps.playthroughs.update(playthroughId(req), parsed.data);
    if (playthrough === undefined) {
      res.status(404).json({ error: 'Playthrough not found.' });
      return;
    }
    res.json(playthrough);
  });

  // Delete a playthrough: cascades its messages + work orders, and removes its
  // stored save files from disk. Idempotent-ish — a missing one is 404.
  router.delete('/:playthroughId', ownsPlaythrough, async (req, res) => {
    const id = playthroughId(req);
    deps.saves.removeSaveDir(id);
    const deleted = await deps.playthroughs.delete(id);
    if (!deleted) {
      res.status(404).json({ error: 'Playthrough not found.' });
      return;
    }
    res.status(204).end();
  });

  // Chat history for re-hydrating the conversation on load / switch.
  router.get('/:playthroughId/messages', ownsPlaythrough, async (req, res) => {
    res.json(await deps.playthroughs.listMessages(playthroughId(req), MESSAGE_HISTORY_CAP));
  });

  // Upload the playthrough's save: appends a new version and makes it current.
  // Multer runs after the ownership check so an unauthorised caller's file is
  // never read. Metadata is parsed and the playthrough name seeded from it.
  router.post('/:playthroughId/save', ownsPlaythrough, uploadSave, async (req, res) => {
    const file = req.file;
    if (file === undefined) {
      res.status(400).json({ error: "Expected a 'save' file upload." });
      return;
    }
    const result = await deps.saves.addVersion(playthroughId(req), {
      fileName: file.originalname,
      bytes: file.buffer,
    });
    res.status(201).json(result);
  });

  // History of a playthrough's uploaded save versions, newest first.
  router.get('/:playthroughId/saves', ownsPlaythrough, async (req, res) => {
    res.json(await deps.saves.listSaves(playthroughId(req)));
  });

  // Re-activate an older version as the current save (what feeds the foreman).
  router.post('/:playthroughId/saves/:saveId/activate', ownsPlaythrough, async (req, res) => {
    const { saveId = '' } = req.params as { saveId?: string };
    const save = await deps.saves.setCurrentSave(playthroughId(req), saveId);
    if (save === undefined) {
      res.status(404).json({ error: 'Save not found for this playthrough.' });
      return;
    }
    res.json(save);
  });

  // Delete a save version. If it was current, the newest remaining is promoted.
  router.delete('/:playthroughId/saves/:saveId', ownsPlaythrough, async (req, res) => {
    const { saveId = '' } = req.params as { saveId?: string };
    const deleted = await deps.saves.deleteSave(playthroughId(req), saveId);
    if (!deleted) {
      res.status(404).json({ error: 'Save not found for this playthrough.' });
      return;
    }
    res.status(204).end();
  });

  return router;
}
