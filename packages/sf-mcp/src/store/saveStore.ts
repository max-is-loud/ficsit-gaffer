// Holds one save file’s parsed SaveState and connection graph, re-parsing only when the file’s
// mtime changes and keeping the previous state if a parse fails; the registry that picks a store
// per request is in registry.ts.

import path from 'node:path';

import { logger } from '../logger.js';
import { emptySaveState, normaliseSave, type SaveState } from '@foreman/sf-save-data';
import { parseSaveFile } from '@foreman/sf-save-data';
import { statMtimeMs } from '@foreman/sf-save-data';
import { buildSaveGraph, type SaveGraph } from '@foreman/sf-save-data-graph';

/** Both artifacts produced from a single parse of a save file. */
export interface LoadedSave {
  state: SaveState;
  graph: SaveGraph;
}

/** Injectable seams so the store can be unit-tested without real file I/O. */
export interface SaveStoreDeps {
  statMtime?: (filePath: string) => number;
  load?: (filePath: string) => LoadedSave;
  now?: () => string;
}

/**
 * Holds the current normalised `SaveState` and its connection graph, parsing the
 * save once and re-parsing lazily when the file's mtime changes — so the foreman
 * sees progress as the pioneer plays without a restart. The graph (#122) is the
 * substrate for relational save tools (power #68, production #126); it is a pure
 * projection of `state.topology`, so it is built directly from the normalised state
 * (one parse, one source of truth — the two can never drift). If parsing fails it
 * keeps the previous state/graph. With no save path configured it serves an empty
 * state and empty graph (never crashes).
 */
export class SaveStore {
  private current: SaveState;
  private currentGraph: SaveGraph;
  private loadedMtimeMs = Number.NaN;
  private readonly statMtime: (filePath: string) => number;
  private readonly load: (filePath: string) => LoadedSave;
  private readonly now: () => string;

  public constructor(
    private readonly savePath: string | undefined,
    deps: SaveStoreDeps = {},
  ) {
    this.statMtime = deps.statMtime ?? statMtimeMs;
    this.now = deps.now ?? (() => new Date().toISOString());
    // Parse once, normalise, then project the graph from that one state — so the
    // state and graph can never disagree. The save model carries raw class names
    // only; display-name resolution happens at the query layer (selectors), so no
    // game-data is needed here — the graph is agnostic too.
    this.load =
      deps.load ??
      ((filePath: string): LoadedSave => {
        const raw = parseSaveFile(filePath, path.basename(filePath));
        const { state } = normaliseSave(raw, this.now());
        return { state, graph: buildSaveGraph(state) };
      });
    const emptyState = emptySaveState(
      'unknown',
      savePath === undefined ? 'none' : path.basename(savePath),
      this.now(),
    );
    this.current = emptyState;
    this.currentGraph = buildSaveGraph(emptyState);
    this.refresh();
  }

  /** Builds a store directly from a state (and optional graph) — for tests and fixtures (no I/O). */
  public static fromState(state: SaveState, graph?: SaveGraph): SaveStore {
    const store = new SaveStore(undefined);
    store.current = state;
    if (graph !== undefined) {
      store.currentGraph = graph;
    }
    return store;
  }

  public get version(): string {
    return this.current.version;
  }

  public get saveName(): string {
    return this.current.saveName;
  }

  /** The current state, re-parsing first if the save file changed on disk. */
  public getState(): SaveState {
    this.refresh();
    return this.current;
  }

  /** The current connection graph, re-building first if the save file changed on disk. */
  public getGraph(): SaveGraph {
    this.refresh();
    return this.currentGraph;
  }

  private refresh(): void {
    if (this.savePath === undefined) {
      return;
    }
    let mtime: number;
    try {
      mtime = this.statMtime(this.savePath);
    } catch (error) {
      logger.error(`Could not stat save file '${this.savePath}':`, error);
      return;
    }
    if (mtime === this.loadedMtimeMs) {
      return;
    }
    try {
      const loaded = this.load(this.savePath);
      this.current = loaded.state;
      this.currentGraph = loaded.graph;
      this.loadedMtimeMs = mtime;
      logger.info(
        `Loaded save '${this.current.saveName}' (${this.current.version}); ` +
          `${this.current.warnings.length} parse warning(s).`,
      );
    } catch (error) {
      logger.error(`Failed to parse save file '${this.savePath}' — keeping previous state:`, error);
    }
  }
}
