// Builds the Better Auth instance (email and password with TOTP two-factor) over a Prisma client,
// and resolves its signing secret and the per-request set of trusted origins.

import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { PrismaClient } from '@prisma/client';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { twoFactor } from 'better-auth/plugins';

import { logger } from './logger.js';

const SECRET_FILE = '.better-auth-secret';

/**
 * Where an auto-generated secret is persisted: alongside a `file:` SQLite
 * database (so it lives in the same data volume and survives restarts), or the
 * working directory otherwise.
 */
function secretFilePath(databaseUrl: string | undefined): string {
  const url = databaseUrl?.trim() ?? '';
  if (url.startsWith('file:')) {
    const dbPath = url.slice('file:'.length);
    return path.join(path.dirname(path.resolve(dbPath)), SECRET_FILE);
  }
  return path.resolve(process.cwd(), SECRET_FILE);
}

/**
 * Resolves the Better Auth signing secret. An explicit `BETTER_AUTH_SECRET`
 * always wins. Otherwise — so a self-hosted deployment keeps "just working"
 * rather than crash-looping on Better Auth's production default-secret guard — a
 * strong secret is generated once and persisted next to the database, stable
 * across restarts so existing sessions survive. Operators should still set
 * `BETTER_AUTH_SECRET` explicitly for multi-instance or Postgres deployments.
 */
function resolveAuthSecret(): string {
  const explicit = process.env['BETTER_AUTH_SECRET']?.trim();
  if (explicit !== undefined && explicit.length > 0) {
    return explicit;
  }
  // Tests run with isProduction=false, so the default-secret guard never fires;
  // return a fixed value rather than writing a file into the working tree.
  if (process.env['NODE_ENV'] === 'test') {
    return 'foreman-test-secret-not-for-production-0123456789';
  }
  const file = secretFilePath(process.env['DATABASE_URL']);
  try {
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, 'utf8').trim();
      if (existing.length > 0) {
        return existing;
      }
    }
    const generated = randomBytes(32).toString('base64url');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, generated, { mode: 0o600 });
    logger.warn(
      `BETTER_AUTH_SECRET is not set; generated one and persisted it at ${file}. ` +
        'Set BETTER_AUTH_SECRET to manage it yourself (required for multi-instance or Postgres deployments).',
    );
    return generated;
  } catch (error) {
    logger.warn(
      'BETTER_AUTH_SECRET is not set and a persistent secret could not be written; ' +
        'falling back to an ephemeral secret (sessions reset on restart). Set BETTER_AUTH_SECRET.',
      error,
    );
    return randomBytes(32).toString('base64url');
  }
}

/**
 * Maps the database URL to the Prisma provider Better Auth's adapter expects.
 * Mirrors the dev-SQLite / prod-Postgres split the rest of the server uses;
 * anything that isn't a Postgres URL is treated as SQLite (the local default).
 */
function providerFor(databaseUrl: string | undefined): 'sqlite' | 'postgresql' {
  const url = databaseUrl?.trim().toLowerCase() ?? '';
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    return 'postgresql';
  }
  return 'sqlite';
}

/** Comma-separated origins permitted to send credentialed requests. */
function parseTrustedOrigins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Trusted origins, resolved per request. Better Auth rejects any state-changing
 * request whose `Origin` is not trusted (CSRF protection). Behind a reverse
 * proxy the server cannot reliably reconstruct its own public origin — the
 * scheme, host and port are the proxy's to know — so rather than guess (and
 * reject the browser's legitimate Origin with a 403), we trust the request's own
 * `Origin` **only when its host matches the host the request was addressed to**.
 * That is a genuine same-origin request, which is all this app ever makes (the
 * SPA and the API share one origin through the nginx proxy). A cross-site
 * `Origin` fails the host match and is still rejected. Any explicit
 * `AUTH_TRUSTED_ORIGINS` are always included.
 */
export function resolveTrustedOrigins(request?: Request): string[] {
  const configured = parseTrustedOrigins(process.env['AUTH_TRUSTED_ORIGINS']);
  const origin = request?.headers.get('origin');
  if (origin === null || origin === undefined || origin.length === 0) {
    return configured;
  }
  const forwardedHost = request?.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
  const host =
    forwardedHost !== undefined && forwardedHost.length > 0
      ? forwardedHost
      : (request?.headers.get('host') ?? '');
  try {
    if (host.length > 0 && new URL(origin).host === host) {
      return [...configured, origin];
    }
  } catch {
    // Malformed Origin header — fall back to the configured list.
  }
  return configured;
}

/**
 * Builds the Better Auth instance over a given Prisma client. Email + password
 * is the primary first factor; passkey / two-factor plugins are added in the
 * MFA slice (#63 Slice 2).
 *
 * Better Auth's own `session` table is mapped to the `AuthSession` Prisma model
 * (`session: { modelName: 'authSession' }`) so it does not collide with our
 * domain model — a login session is unrelated to a `Playthrough` (a play
 * session). Auth sessions are HttpOnly cookies — no token is exposed to client
 * JavaScript.
 *
 * Taking the client as an argument (rather than importing the singleton) keeps
 * auth on the same dependency-injection footing as the services, so tests can
 * point it at an isolated database.
 *
 * `BETTER_AUTH_SECRET` must be set in any non-dev deployment; without it Better
 * Auth falls back to a development secret (fine for local dev and tests).
 *
 * The return type is inferred rather than annotated: Better Auth's instance type
 * is parameterised by the exact options and is not cleanly nameable, and the
 * inferred type is what gives {@link AuthUser} its precise shape via `$Infer`.
 */
export function createAuth(prisma: PrismaClient) {
  return betterAuth({
    secret: resolveAuthSecret(),
    baseURL: process.env['BETTER_AUTH_URL'],
    basePath: '/api/auth',
    trustedOrigins: resolveTrustedOrigins,
    database: prismaAdapter(prisma, { provider: providerFor(process.env['DATABASE_URL']) }),
    emailAndPassword: { enabled: true },
    session: { modelName: 'authSession' },
    // The app sits behind the nginx reverse proxy, which forwards the client
    // address as X-Forwarded-For; trust it so rate limiting buckets per client
    // rather than falling back to one shared bucket.
    advanced: { ipAddress: { ipAddressHeaders: ['x-forwarded-for'] } },
    // Opt-in MFA: TOTP authenticator apps + single-use backup/recovery codes.
    // `trustDeviceMaxAge` defaults to 30 days ("trust this device"), so a verified
    // device skips the second factor for that window.
    plugins: [twoFactor({ issuer: 'FICSIT Foreman' })],
  });
}

/** The Better Auth instance type. */
export type Auth = ReturnType<typeof createAuth>;

/** The authenticated user shape Better Auth resolves from a session cookie. */
export type AuthUser = Auth['$Infer']['Session']['user'];
