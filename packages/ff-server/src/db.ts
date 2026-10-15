// Creates the process-wide Prisma client over the better-sqlite3 driver adapter and provides the
// shutdown hook that closes it.

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

/**
 * Single shared Prisma client for the process. Prisma 7 connects through a
 * driver adapter rather than a bundled engine, so the SQLite connection URL is
 * supplied here (from DATABASE_URL) rather than in schema.prisma. One instance
 * is reused across all requests.
 */
const adapter = new PrismaBetterSqlite3({ url: process.env['DATABASE_URL'] ?? 'file:./dev.db' });
export const prisma = new PrismaClient({ adapter });

/** Closes the database connection. Call on graceful shutdown. */
export async function disconnectDb(): Promise<void> {
  await prisma.$disconnect();
}
