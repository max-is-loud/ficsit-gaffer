// Vitest config for sf-mcp: Node environment, picks up test/**/*.test.ts.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // No tests yet — this is a scaffold. Keeps `npm test` green until v1 lands.
    passWithNoTests: true,
  },
});
