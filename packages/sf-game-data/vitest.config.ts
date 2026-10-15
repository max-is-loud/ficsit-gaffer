// Vitest config for sf-game-data: Node environment, picks up test/**/*.test.ts.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
