// Display labels for work-order ids, states and parent-child relationship types,
// shared by the cockpit and the history views.

import type { OrderType, WorkOrderRelationshipType, WorkOrderState } from '../api/types.js';

/** Render a sequence number as its canonical id — WO-NNN (build) or EO-NNN (explore). */
export const woLabel = (n: number, orderType: OrderType = 'build'): string =>
  `${orderType === 'explore' ? 'EO' : 'WO'}-${String(n).padStart(3, '0')}`;

/** Human-readable work-order state names (shared by the cockpit and history). */
export const STATE_LABEL: Record<WorkOrderState, string> = {
  new: 'New',
  active: 'Active',
  paused: 'Paused',
  blocked: 'Blocked',
  completed: 'Completed',
  cancelled: 'Cancelled',
  superseded: 'Superseded',
};

/** Short labels for a child order's relationship to its parent (branch labels). */
export const RELATIONSHIP_LABEL: Record<WorkOrderRelationshipType, string> = {
  prerequisite: 'prerequisite',
  exploration: 'exploration',
  hard_drive_hunt: 'hard-drive hunt',
  mam_research: 'MAM research',
  resource_gathering: 'resource gathering',
  infrastructure_support: 'infrastructure',
  corrective_action: 'corrective action',
};
