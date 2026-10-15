// Vitest config for sf-save-data-graph: Node environment, picks up test/**/*.test.ts.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
