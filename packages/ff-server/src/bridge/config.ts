// Reads the optional FOREMAN_BRIDGE_* environment variables into a validated BridgeBinding,
// treating a partial or malformed binding as a configuration error.

import type { BridgeBinding } from './types.js';

const VARIABLES = {
  url: 'FOREMAN_BRIDGE_URL',
  queryToken: 'FOREMAN_BRIDGE_QUERY_TOKEN',
  serverId: 'FOREMAN_BRIDGE_SERVER_ID',
  worldId: 'FOREMAN_BRIDGE_WORLD_ID',
  playthroughId: 'FOREMAN_BRIDGE_PLAYTHROUGH_ID',
} as const;

// Same constraints the receiver applies to its identities and credentials.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{32,256}$/;
// Playthrough ids are filename-safe (see validation.ts safeClientIdSchema).
const PLAYTHROUGH_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** Error messages name variables only; values (including secrets) are never echoed. */
function invalid(variable: string, rule: string): Error {
  return new Error(`Invalid live bridge configuration: ${variable} ${rule}.`);
}

function receiverUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid(VARIABLES.url, 'must be an absolute HTTPS URL');
  }
  if (url.protocol !== 'https:') {
    throw invalid(VARIABLES.url, 'must use https');
  }
  if (url.username !== '' || url.password !== '') {
    throw invalid(VARIABLES.url, 'must not contain credentials');
  }
  // `new URL` drops an empty `?`/`#`, so check the raw text as well.
  if (
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== '' ||
    raw.includes('?') ||
    raw.includes('#')
  ) {
    throw invalid(VARIABLES.url, 'must be a receiver origin with no path, query or fragment');
  }
  return url.toString();
}

/**
 * Resolves the optional live-bridge binding. All variables absent (or blank)
 * disables the integration; any partial or invalid binding is a configuration
 * error so a misconfigured deployment fails loudly rather than silently.
 */
export function resolveBridgeBinding(
  env: NodeJS.ProcessEnv = process.env,
): BridgeBinding | undefined {
  const values = Object.fromEntries(
    Object.entries(VARIABLES).map(([field, variable]) => [field, env[variable]?.trim() ?? '']),
  ) as Record<keyof typeof VARIABLES, string>;
  const missing = Object.entries(VARIABLES)
    .filter(([field]) => values[field as keyof typeof VARIABLES] === '')
    .map(([, variable]) => variable);
  if (missing.length === Object.keys(VARIABLES).length) {
    return undefined;
  }
  if (missing.length > 0) {
    throw new Error(
      `Live bridge configuration is incomplete: set ${missing.join(', ')} or unset all FOREMAN_BRIDGE_* variables.`,
    );
  }
  if (!TOKEN.test(values.queryToken)) {
    throw invalid(VARIABLES.queryToken, 'must be 32-256 characters of A-Z, a-z, 0-9, _ or -');
  }
  if (!UUID.test(values.serverId)) {
    throw invalid(VARIABLES.serverId, 'must be a lowercase UUID');
  }
  if (!UUID.test(values.worldId)) {
    throw invalid(VARIABLES.worldId, 'must be a lowercase UUID');
  }
  if (!PLAYTHROUGH_ID.test(values.playthroughId)) {
    throw invalid(VARIABLES.playthroughId, 'must be a playthrough id');
  }
  return {
    url: receiverUrl(values.url),
    queryToken: values.queryToken,
    serverId: values.serverId,
    worldId: values.worldId,
    playthroughId: values.playthroughId,
  };
}
