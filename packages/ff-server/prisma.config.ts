// Prisma CLI configuration: tells `prisma generate` and `prisma migrate` where the schema, the
// migrations and the datasource URL are.

import { defineConfig } from 'prisma/config';

/**
 * Prisma 7 configuration. The datasource connection URL lives here rather than
 * in schema.prisma (where `url` is no longer permitted); the runtime connection
 * is made via a driver adapter in src/db.ts. DATABASE_URL is supplied by the
 * environment (`file:/data/foreman.db` in the Docker image, a per-suite temp
 * file in tests); we fall back to the documented `file:./dev.db` local default
 * so `prisma generate` (which never connects) and local CLI commands work
 * without the var being set.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env['DATABASE_URL'] ?? 'file:./dev.db',
  },
});
