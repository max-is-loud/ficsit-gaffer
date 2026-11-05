// Thin API client for the Foreman backend. All paths are same-origin relative
// (/api/...); the dev server and the production nginx image both proxy /api to
// the backend, so there is no CORS and no base URL to configure.

import { chatRequestBody, type ClientLlmConfig } from '../llmSettings.js';
import { parseSseStream } from './sse.js';
import type {
  Foreman,
  PioneerFeedback,
  Playthrough,
  Save,
  SavePreviewResult,
  SaveUploadResult,
  StoredMessage,
  WorkOrder,
  WorkOrderAction,
  WorkOrderAuditEvent,
  WorkOrderRevision,
  WorkOrderRevisionDiff,
} from './types.js';

const API_KEY_HEADER = 'x-anthropic-api-key';

// Auth is a HttpOnly session cookie, so every request must be credentialed for
// the backend to recognise the signed-in user.
const CREDENTIALS: RequestCredentials = 'include';

function jsonHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey !== undefined && apiKey.length > 0) {
    headers[API_KEY_HEADER] = apiKey;
  }
  return headers;
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Request failed (${response.status}).`;
  } catch {
    return `Request failed (${response.status}).`;
  }
}

// ── Foremen ─────────────────────────────────────────────────────────────────

export interface CreateForemanInput {
  name: string;
  personality?: string;
}

export async function createForeman(input: CreateForemanInput): Promise<Foreman> {
  const response = await fetch('/api/foremen', {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: CREDENTIALS,
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as Foreman;
}

export async function getForeman(id: string): Promise<Foreman | null> {
  const response = await fetch(`/api/foremen/${id}`, { credentials: CREDENTIALS });
  if (response.status === 404 || response.status === 403) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as Foreman;
}

export async function patchForeman(
  id: string,
  patch: { name?: string; personality?: string },
): Promise<Foreman> {
  const response = await fetch(`/api/foremen/${id}`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: CREDENTIALS,
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as Foreman;
}

export async function listForemen(): Promise<Foreman[]> {
  const response = await fetch('/api/foremen', { credentials: CREDENTIALS });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as Foreman[];
}

export async function deleteForeman(id: string): Promise<void> {
  const response = await fetch(`/api/foremen/${id}`, {
    method: 'DELETE',
    credentials: CREDENTIALS,
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(await readError(response));
  }
}

// ── Playthroughs ──────────────────────────────────────────────────────────────

export interface CreatePlaythroughInput {
  foremanId: string;
  name?: string;
  pioneerProfile?: string;
}

export async function createPlaythrough(input: CreatePlaythroughInput): Promise<Playthrough> {
  const response = await fetch('/api/playthroughs', {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: CREDENTIALS,
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as Playthrough;
}

export async function getPlaythrough(id: string): Promise<Playthrough | null> {
  const response = await fetch(`/api/playthroughs/${id}`, { credentials: CREDENTIALS });
  if (response.status === 404 || response.status === 403) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as Playthrough;
}

/**
 * Claims a pre-accounts anonymous playthrough (the local `foreman.playthroughId`)
 * for the signed-in user on first login. Returns the playthrough if claimed or
 * already owned; null if it no longer exists or belongs to another user.
 */
export async function claimPlaythrough(id: string): Promise<Playthrough | null> {
  const response = await fetch(`/api/playthroughs/${id}/claim`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: CREDENTIALS,
  });
  if (response.status === 404 || response.status === 403) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as Playthrough;
}

export async function patchPlaythrough(
  id: string,
  patch: { name?: string; pioneerProfile?: string; foremanId?: string },
): Promise<Playthrough> {
  const response = await fetch(`/api/playthroughs/${id}`, {
    method: 'PATCH',
    headers: jsonHeaders(),
    credentials: CREDENTIALS,
    body: JSON.stringify(patch),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as Playthrough;
}

export async function listPlaythroughs(): Promise<Playthrough[]> {
  const response = await fetch('/api/playthroughs', { credentials: CREDENTIALS });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as Playthrough[];
}

export async function deletePlaythrough(id: string): Promise<void> {
  const response = await fetch(`/api/playthroughs/${id}`, {
    method: 'DELETE',
    credentials: CREDENTIALS,
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(await readError(response));
  }
}

/** Prior chat turns for a playthrough, chronological — re-hydrates the chat view. */
export async function listMessages(playthroughId: string): Promise<StoredMessage[]> {
  const response = await fetch(`/api/playthroughs/${playthroughId}/messages`, {
    credentials: CREDENTIALS,
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as StoredMessage[];
}

/** Uploads (or replaces) the playthrough's current save. Multipart `save` field. */
export async function uploadSave(playthroughId: string, file: File): Promise<SaveUploadResult> {
  const form = new FormData();
  form.append('save', file);
  // No explicit content-type: the browser sets the multipart boundary itself.
  const response = await fetch(`/api/playthroughs/${playthroughId}/save`, {
    method: 'POST',
    credentials: CREDENTIALS,
    body: form,
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as SaveUploadResult;
}

/** A playthrough's uploaded save versions, newest first. */
export async function listSaves(playthroughId: string): Promise<Save[]> {
  const response = await fetch(`/api/playthroughs/${playthroughId}/saves`, {
    credentials: CREDENTIALS,
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as Save[];
}

/** Re-activates an older save version as the current one. */
export async function activateSave(playthroughId: string, saveId: string): Promise<Save> {
  const response = await fetch(`/api/playthroughs/${playthroughId}/saves/${saveId}/activate`, {
    method: 'POST',
    credentials: CREDENTIALS,
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as Save;
}

/** Deletes a save version (the newest remaining is promoted if it was current). */
export async function deleteSave(playthroughId: string, saveId: string): Promise<void> {
  const response = await fetch(`/api/playthroughs/${playthroughId}/saves/${saveId}`, {
    method: 'DELETE',
    credentials: CREDENTIALS,
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(await readError(response));
  }
}

/** Parses an upload's identity and finds the user's playthroughs of the same game. */
export async function previewSave(file: File): Promise<SavePreviewResult> {
  const form = new FormData();
  form.append('save', file);
  const response = await fetch('/api/saves/preview', {
    method: 'POST',
    credentials: CREDENTIALS,
    body: form,
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as SavePreviewResult;
}

export async function getActiveWorkOrder(playthroughId: string): Promise<WorkOrder | null> {
  const response = await fetch(`/api/playthroughs/${playthroughId}/work-orders/active`, {
    credentials: CREDENTIALS,
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as WorkOrder;
}

export async function listWorkOrders(playthroughId: string): Promise<WorkOrder[]> {
  const response = await fetch(`/api/playthroughs/${playthroughId}/work-orders`, {
    credentials: CREDENTIALS,
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as WorkOrder[];
}

// ── Work-order v2 mutations & reads ─────────────────────────────────────────
// All mutating endpoints return the updated WorkOrder; callers swap it into
// local state in place. Failures (409 conflict, 403 actor, 400 requirement)
// surface as a thrown Error carrying the server's message.

const wo = (playthroughId: string, id: string): string =>
  `/api/playthroughs/${playthroughId}/work-orders/${id}`;

async function send<T>(url: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: jsonHeaders(),
    credentials: CREDENTIALS,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as T;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: CREDENTIALS });
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as T;
}

/** Extra fields a transition may require (block reason, completion summary, …). */
export interface TransitionOptions {
  blockedReason?: string;
  blockedResolutionHint?: string;
  resolutionNote?: string;
  cancellationReason?: string;
  supersededByWorkOrderId?: string;
  supersededReason?: string;
  forceCompletionReason?: string;
  incompleteItemSummary?: string;
  completionSummary?: string;
  /** Captured on Complete/ForceComplete; stored on the order. */
  pioneerFeedback?: PioneerFeedback;
}

export async function transitionWorkOrder(
  playthroughId: string,
  id: string,
  action: WorkOrderAction,
  options: TransitionOptions = {},
): Promise<WorkOrder> {
  return send<WorkOrder>(`${wo(playthroughId, id)}/transitions`, 'POST', {
    action,
    actor: 'Pioneer',
    ...options,
  });
}

export async function setStepChecked(
  playthroughId: string,
  id: string,
  stepId: string,
  checked: boolean,
): Promise<WorkOrder> {
  return send<WorkOrder>(`${wo(playthroughId, id)}/steps/${stepId}`, 'PATCH', { checked });
}

export async function setBuildableBuiltCount(
  playthroughId: string,
  id: string,
  stepId: string,
  buildableId: string,
  builtCount: number,
): Promise<WorkOrder> {
  return send<WorkOrder>(
    `${wo(playthroughId, id)}/steps/${stepId}/buildables/${buildableId}`,
    'PATCH',
    { builtCount },
  );
}

export async function setWaypointCollected(
  playthroughId: string,
  id: string,
  waypointId: string,
  collectibleId: string,
  collected: boolean,
): Promise<WorkOrder> {
  return send<WorkOrder>(
    `${wo(playthroughId, id)}/waypoints/${waypointId}/collectibles/${collectibleId}`,
    'PATCH',
    { collected },
  );
}

export async function logHours(
  playthroughId: string,
  id: string,
  hours: number,
): Promise<WorkOrder> {
  return send<WorkOrder>(`${wo(playthroughId, id)}/hours`, 'POST', { hours });
}

export async function acknowledgeRevision(
  playthroughId: string,
  id: string,
  revisionNumber?: number,
): Promise<WorkOrder> {
  return send<WorkOrder>(`${wo(playthroughId, id)}/acknowledge`, 'POST', { revisionNumber });
}

export async function revertToRevision(
  playthroughId: string,
  id: string,
  revisionNumber: number,
): Promise<WorkOrder> {
  return send<WorkOrder>(`${wo(playthroughId, id)}/revert`, 'POST', { revisionNumber });
}

export async function getAuditTrail(
  playthroughId: string,
  id: string,
): Promise<WorkOrderAuditEvent[]> {
  return getJson<WorkOrderAuditEvent[]>(`${wo(playthroughId, id)}/audit`);
}

export async function getRevisions(
  playthroughId: string,
  id: string,
): Promise<WorkOrderRevision[]> {
  return getJson<WorkOrderRevision[]>(`${wo(playthroughId, id)}/revisions`);
}

/** A single revision with its full plan snapshot (for the snapshot view). */
export async function getRevision(
  playthroughId: string,
  id: string,
  revisionNumber: number,
): Promise<WorkOrderRevision> {
  return getJson<WorkOrderRevision>(`${wo(playthroughId, id)}/revisions/${revisionNumber}`);
}

export async function getWorkOrderChildren(
  playthroughId: string,
  id: string,
): Promise<WorkOrder[]> {
  return getJson<WorkOrder[]>(`${wo(playthroughId, id)}/children`);
}

/** The order's parent, or null when it has none (the server 404s). */
export async function getWorkOrderParent(
  playthroughId: string,
  id: string,
): Promise<WorkOrder | null> {
  const response = await fetch(`${wo(playthroughId, id)}/parent`, { credentials: CREDENTIALS });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(await readError(response));
  }
  return (await response.json()) as WorkOrder;
}

export async function getRevisionDiff(
  playthroughId: string,
  id: string,
  from?: number,
  to?: number,
): Promise<WorkOrderRevisionDiff> {
  const params = new URLSearchParams();
  if (from !== undefined) {
    params.set('from', String(from));
  }
  if (to !== undefined) {
    params.set('to', String(to));
  }
  const qs = params.toString();
  return getJson<WorkOrderRevisionDiff>(
    `${wo(playthroughId, id)}/revisions/diff${qs ? `?${qs}` : ''}`,
  );
}

export type { ClientLlmConfig };

/** Callbacks invoked as the foreman's streamed turn unfolds. */
export interface ChatHandlers {
  onText(delta: string): void;
  onToolUse(name: string): void;
  onWorkOrder(order: WorkOrder): void;
  onError(message: string): void;
}

/**
 * Sends a message and streams the foreman's response, dispatching SSE events to
 * the handlers. Resolves when the stream ends (the `done` event or stream
 * close). Network/HTTP failures surface through onError.
 */
export async function streamChat(
  playthroughId: string,
  message: string,
  apiKey: string | undefined,
  llm: ClientLlmConfig,
  handlers: ChatHandlers,
): Promise<void> {
  const body = chatRequestBody(message, llm);

  let response: Response;
  try {
    response = await fetch(`/api/playthroughs/${playthroughId}/chat`, {
      method: 'POST',
      headers: jsonHeaders(apiKey),
      credentials: CREDENTIALS,
      body: JSON.stringify(body),
    });
  } catch {
    handlers.onError('Could not reach the foreman. Is the backend running?');
    return;
  }

  if (!response.ok || response.body === null) {
    handlers.onError(await readError(response));
    return;
  }

  for await (const event of parseSseStream(response.body)) {
    switch (event.event) {
      case 'text': {
        handlers.onText((JSON.parse(event.data) as { delta: string }).delta);
        break;
      }
      case 'tool_use': {
        handlers.onToolUse((JSON.parse(event.data) as { name: string }).name);
        break;
      }
      case 'work_order': {
        handlers.onWorkOrder(JSON.parse(event.data) as WorkOrder);
        break;
      }
      case 'error': {
        handlers.onError((JSON.parse(event.data) as { message: string }).message);
        break;
      }
      case 'done':
      default:
        break;
    }
  }
}
