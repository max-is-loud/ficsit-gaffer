// Express middleware that requires a Better Auth session and checks that the caller owns the
// playthrough or foreman named in the route.

import { fromNodeHeaders } from 'better-auth/node';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { Auth, AuthUser } from '../auth.js';
import type { ForemanService } from '../services/foremanService.js';
import type { PlaythroughService } from '../services/playthroughService.js';

declare global {
  namespace Express {
    interface Request {
      /** The authenticated user, populated by {@link requireAuth}. */
      user?: AuthUser;
    }
  }
}

/**
 * Rejects unauthenticated requests. Resolves the Better Auth session from the
 * request's cookies and attaches the user to `req.user`; responds 401 when no
 * valid session is present. Mount on the protected `/api/*` routers (not on
 * `/api/auth/*`, which Better Auth owns, nor `/health`).
 */
export function requireAuth(auth: Auth): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    auth.api
      .getSession({ headers: fromNodeHeaders(req.headers) })
      .then((session) => {
        if (session?.user === undefined || session.user === null) {
          res.status(401).json({ error: 'Authentication required.' });
          return;
        }
        req.user = session.user;
        next();
      })
      .catch(next);
  };
}

/** Looks up the owning user id of a resource by id (null if unclaimed). */
interface OwnableService {
  findOwnerId(id: string): Promise<{ userId: string | null } | undefined>;
}

/**
 * Guards an owned, id-scoped route: the authenticated user must own the resource
 * named by `req.params[paramName]`. A missing resource is 404; one owned by
 * someone else (or not yet claimed) is 403. Must run after {@link requireAuth}.
 */
function requireOwnership(
  service: OwnableService,
  paramName: string,
  notFound: string,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const userId = req.user?.id;
    if (userId === undefined) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const id = typeof req.params[paramName] === 'string' ? req.params[paramName] : '';
    service
      .findOwnerId(id)
      .then((ownership) => {
        if (ownership === undefined) {
          res.status(404).json({ error: notFound });
          return;
        }
        if (ownership.userId !== userId) {
          res.status(403).json({ error: 'Forbidden.' });
          return;
        }
        next();
      })
      .catch(next);
  };
}

/** Guards a playthrough-scoped route (`:playthroughId`). */
export function requirePlaythroughOwnership(playthroughs: PlaythroughService): RequestHandler {
  return requireOwnership(playthroughs, 'playthroughId', 'Playthrough not found.');
}

/** Guards a foreman-scoped route (`:foremanId`). */
export function requireForemanOwnership(foremen: ForemanService): RequestHandler {
  return requireOwnership(foremen, 'foremanId', 'Foreman not found.');
}
