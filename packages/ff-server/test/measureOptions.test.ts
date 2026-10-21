import { describe, expect, it } from 'vitest';

import { integerOption } from '../src/scripts/measureOptions.js';

describe('integerOption', () => {
  it('accepts whole numbers at or above the minimum', () => {
    expect(integerOption('runs', '3', 1)).toBe(3);
    expect(integerOption('trace-result-chars', '0', 0)).toBe(0);
  });

  it.each(['0', 'abc', '1.5', '2e3', '-1', '', ' 3'])("rejects '%s' for --runs", (value) => {
    expect(() => integerOption('runs', value, 1)).toThrow(
      `--runs must be a whole number of at least 1; got '${value}'.`,
    );
  });
});
