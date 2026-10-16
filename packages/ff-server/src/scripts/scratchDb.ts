// A throwaway SQLite database and save directory for the measurement script, created with the
// same `prisma db push` the tests use, so a measurement never touches a real database.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '@prisma/client';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A scratch database, its save directory, and a cleanup that deletes both. */
export interface ScratchDb {
  prisma: PrismaClient;
  saveDataDir: string;
  cleanup: () => Promise<void>;
}

/**
 * Creates the database in a fresh temp directory. The save directory sits inside it, so
 * sf-mcp must run on the same machine to read uploaded saves by absolute path.
 */
export async function createScratchDb(): Promise<ScratchDb> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-measure-'));
  const url = `file:${path.join(dir, 'measure.db')}`;
  execSync('npx prisma db push', {
    cwd: packageRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
  const prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
  const saveDataDir = path.join(dir, 'saves');
  fs.mkdirSync(saveDataDir);
  return {
    prisma,
    saveDataDir,
    cleanup: async (): Promise<void> => {
      await prisma.$disconnect();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
