// The user-scoped save route that previews an uploaded save against the caller's existing
// playthroughs.

import { Router } from 'express';
import multer from 'multer';

import type { AppDeps } from '../deps.js';

/** A Satisfactory `.sav` can be tens of MB; cap uploads generously. */
const MAX_SAVE_BYTES = 64 * 1024 * 1024;

const uploadSave = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SAVE_BYTES },
}).single('save');

/**
 * User-scoped save routes (not tied to one playthrough). Currently the same-game
 * preview: parse an uploaded save's identity and find the caller's playthroughs
 * whose current save looks like the same game, so the client can offer "update
 * existing" vs "create new" before committing the upload. Mounted behind auth.
 */
export function savesRouter(deps: AppDeps): Router {
  const router = Router();

  router.post('/preview', uploadSave, async (req, res) => {
    const file = req.file;
    if (file === undefined) {
      res.status(400).json({ error: "Expected a 'save' file upload." });
      return;
    }
    res.json(await deps.saves.preview(req.user!.id, file.buffer));
  });

  return router;
}
