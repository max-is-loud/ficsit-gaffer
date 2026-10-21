// Resolves which SaveStore serves a request: the default store, or an LRU-cached per-path store
// restricted to the allowed saves directory. Parsing and reload-on-change belong to saveStore.ts.

import path from 'node:path';

import { logger } from '../logger.js';
import { SaveStore, type SaveStoreDeps } from './saveStore.js';

const DEFAULT_MAX_ENTRIES = 5;

/** True when `target` resolves to a path inside `baseDir` (no traversal out). */
function isWithin(baseDir: string, target: string): boolean {
  const rel = path.relative(baseDir, target);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * Resolves a {@link SaveStore} per request. Without a `savePath` it serves the
 * single store configured from `SAVE_FILE_PATH` (the legacy/dev behaviour). With
 * a `savePath` — the host injects the active playthrough's save — it serves an
 * LRU-cached store keyed by that path; each store keeps its own mtime-gated
 * parse, so a save is parsed once and re-parsed only when its file changes (a
 * re-upload), never per request. Paths outside the allowed base dir are refused
 * (defends against a tool argument trying to read arbitrary files).
 */
export class SaveStoreRegistry {
  private readonly cache = new Map<string, SaveStore>();

  public constructor(
    private readonly defaultStore: SaveStore,
    private readonly allowedBaseDir: string | undefined,
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES,
    private readonly storeDeps: SaveStoreDeps = {},
  ) {}

  /** True when `savePath` lies inside the allowed save directory, so `resolve` would honour it. */
  public allows(savePath: string): boolean {
    return (
      this.allowedBaseDir !== undefined && isWithin(this.allowedBaseDir, path.resolve(savePath))
    );
  }

  public resolve(savePath?: string): SaveStore {
    if (savePath === undefined || savePath.trim().length === 0) {
      return this.defaultStore;
    }
    const abs = path.resolve(savePath);
    if (!this.allows(abs)) {
      logger.warn(
        `Ignoring savePath '${savePath}' (outside the allowed save directory); using the default save.`,
      );
      return this.defaultStore;
    }
    const existing = this.cache.get(abs);
    if (existing !== undefined) {
      // Bump recency (Map preserves insertion order → front is least-recent).
      this.cache.delete(abs);
      this.cache.set(abs, existing);
      return existing;
    }
    const store = new SaveStore(abs, this.storeDeps);
    this.cache.set(abs, store);
    if (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    return store;
  }
}
