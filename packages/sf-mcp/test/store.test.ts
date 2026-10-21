import { describe, expect, it } from 'vitest';

import { emptySaveState } from '@foreman/sf-save-data';
import { buildSaveGraph } from '@foreman/sf-save-data-graph';
import { SaveStore, type LoadedSave } from '../src/store/saveStore.js';

const NOW = '2026-01-01T00:00:00.000Z';

/** A LoadedSave wrapping a named state and its (empty) projected graph — for the seam-injected tests. */
function loaded(name: string): LoadedSave {
  const state = emptySaveState('v', name, NOW);
  return { state, graph: buildSaveGraph(state) };
}

describe('SaveStore', () => {
  it('serves an empty state and empty graph when no save path is configured', () => {
    const store = new SaveStore(undefined);
    const state = store.getState();
    expect(store.version).toBe('unknown');
    expect(store.saveName).toBe('none');
    expect(state.recipes).toEqual([]);
    expect(store.getGraph().stats().actors).toBe(0);
    expect(store.loaded).toBe(false);
  });

  it('is loaded only once a parse succeeds, and stays loaded after a later failure', () => {
    let mtime = 1;
    let readable = false;
    const store = new SaveStore('save.sav', {
      statMtime: () => mtime,
      load: () => {
        if (!readable) {
          throw new Error('truncated');
        }
        return loaded('A');
      },
      now: () => NOW,
    });
    expect(store.loaded).toBe(false);
    readable = true;
    mtime = 2;
    store.getState();
    expect(store.loaded).toBe(true);
    readable = false;
    mtime = 3;
    expect(store.getState().saveName).toBe('A');
    expect(store.loaded).toBe(true);
    expect(SaveStore.fromState(emptySaveState('v', 'F', NOW)).loaded).toBe(true);
  });

  it('re-parses only when the file mtime changes', () => {
    const saves: LoadedSave[] = [loaded('A'), loaded('B')];
    let mtime = 1;
    let loads = 0;
    const store = new SaveStore('save.sav', {
      statMtime: () => mtime,
      load: () => saves[Math.min(loads++, saves.length - 1)] as LoadedSave,
      now: () => NOW,
    });
    expect(store.saveName).toBe('A'); // initial load
    expect(store.getState().saveName).toBe('A'); // same mtime → no reload
    expect(loads).toBe(1);
    mtime = 2;
    expect(store.getState().saveName).toBe('B'); // mtime changed → reload
    expect(loads).toBe(2);
  });

  it('rebuilds the graph alongside the state, gated on mtime', () => {
    const stateA = emptySaveState('v', 'A', NOW);
    const stateB = emptySaveState('v', 'B', NOW);
    stateB.topology.buildables.push({
      instanceName: 'Persistent_Level:PersistentLevel.Build_StorageContainerMk1_C_1',
      classKey: 'Build_StorageContainerMk1_C',
    });
    const scenes: LoadedSave[] = [
      { state: stateA, graph: buildSaveGraph(stateA) },
      { state: stateB, graph: buildSaveGraph(stateB) },
    ];
    let mtime = 1;
    let loads = 0;
    const store = new SaveStore('save.sav', {
      statMtime: () => mtime,
      load: () => scenes[Math.min(loads++, scenes.length - 1)] as LoadedSave,
      now: () => NOW,
    });
    expect(store.getGraph().stats().actors).toBe(0); // initial
    expect(store.getGraph().stats().actors).toBe(0); // same mtime → no rebuild
    expect(loads).toBe(1);
    mtime = 2;
    expect(store.getGraph().stats().actors).toBe(1); // mtime changed → rebuilt
    expect(loads).toBe(2);
  });

  it('keeps the previous state and graph when a re-parse throws', () => {
    let mtime = 1;
    let mode: 'ok' | 'throw' = 'ok';
    const store = new SaveStore('save.sav', {
      statMtime: () => mtime,
      load: (): LoadedSave => {
        if (mode === 'throw') {
          throw new Error('corrupt');
        }
        return loaded('GOOD');
      },
      now: () => NOW,
    });
    expect(store.saveName).toBe('GOOD');
    mode = 'throw';
    mtime = 2;
    expect(() => store.getState()).not.toThrow();
    expect(() => store.getGraph()).not.toThrow();
    expect(store.saveName).toBe('GOOD'); // unchanged
  });
});
