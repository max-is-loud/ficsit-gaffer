import { describe, expect, it } from 'vitest';

import { normaliseSave } from '../src/normalise/index.js';
import { makeSave } from './fixtures/save.js';

describe('save timestamp', () => {
  it('reads the in-game save time (unix milliseconds from the parser) as ISO UTC', () => {
    const save = makeSave({
      objects: [],
      header: { sessionName: 'S', saveDateTime: String(Date.UTC(2026, 9, 14, 21, 3, 0)) },
    });
    expect(normaliseSave(save, 'now').state.savedAt).toBe('2026-10-14T21:03:00.000Z');
  });

  it('leaves savedAt unset and warns for an unusable value', () => {
    const save = makeSave({ objects: [], header: { sessionName: 'S', saveDateTime: 'garbage' } });
    const { state, warnings } = normaliseSave(save, 'now');
    expect(state.savedAt).toBeUndefined();
    expect(warnings).toContain("Unreadable save timestamp 'garbage'; save time unknown.");
  });

  it('treats a zero timestamp (no time recorded) as unknown without a warning', () => {
    const save = makeSave({ objects: [], header: { sessionName: 'S', saveDateTime: '0' } });
    const { state, warnings } = normaliseSave(save, 'now');
    expect(state.savedAt).toBeUndefined();
    expect(warnings.some((warning) => warning.includes('timestamp'))).toBe(false);
  });
});
