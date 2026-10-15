// The account-wide list of foreman personas with inline edit, create and delete.
// Persistence is done by callbacks from the parent, and personas in use by a
// playthrough cannot be deleted.

import { useState } from 'react';

import type { Foreman } from '../api/types.js';
import { NewForemanModal } from './NewForemanModal.js';

interface ForemanLibraryProps {
  foremen: Foreman[];
  /** Ids of foremen attached to at least one playthrough (delete is blocked). */
  inUseIds: ReadonlySet<string>;
  onAdd: (input: { name: string; personality?: string }) => Promise<Foreman>;
  onEdit: (id: string, patch: { name?: string; personality?: string }) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onError: (message: string) => void;
}

/**
 * The account-wide foreman library: every reusable persona the user owns, with
 * inline edit, create and delete. Attaching a persona to a playthrough happens
 * in that playthrough's settings — here a persona only shows whether it is in
 * use somewhere, since the server refuses to delete an attached one.
 */
export function ForemanLibrary({
  foremen,
  inUseIds,
  onAdd,
  onEdit,
  onRemove,
  onError,
}: ForemanLibraryProps): React.JSX.Element {
  const [adding, setAdding] = useState(false);

  return (
    <>
      <p className="hint">
        Your reusable personas, shared across playthroughs — editing one changes it for every
        playthrough that uses it. Pick which persona a playthrough uses from that
        playthrough&rsquo;s settings.
      </p>
      <div className="foreman-list">
        {foremen.map((f) => (
          <ForemanRow
            key={f.id}
            foreman={f}
            inUse={inUseIds.has(f.id)}
            onEdit={(patch) => onEdit(f.id, patch)}
            onRemove={() => onRemove(f.id)}
            onError={onError}
          />
        ))}
      </div>

      <button type="button" className="icon-button" onClick={() => setAdding(true)}>
        + New foreman
      </button>

      {adding ? <NewForemanModal onCreate={onAdd} onClose={() => setAdding(false)} /> : null}
    </>
  );
}

interface ForemanRowProps {
  foreman: Foreman;
  inUse: boolean;
  onEdit: (patch: { name?: string; personality?: string }) => Promise<void>;
  onRemove: () => Promise<void>;
  onError: (message: string) => void;
}

/** One row in the foreman library: view, inline edit, delete. */
function ForemanRow({
  foreman,
  inUse,
  onEdit,
  onRemove,
  onError,
}: ForemanRowProps): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(foreman.name);
  const [personality, setPersonality] = useState(foreman.personality);

  const guard = (fn: () => Promise<void>): void => {
    void fn().catch((e: unknown) =>
      onError(e instanceof Error ? e.message : 'Something went wrong.'),
    );
  };

  if (editing) {
    return (
      <div className="foreman-edit">
        <div className="field">
          <label htmlFor={`fe-name-${foreman.id}`}>Name</label>
          <input
            id={`fe-name-${foreman.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <label htmlFor={`fe-persona-${foreman.id}`}>Personality</label>
          <textarea
            id={`fe-persona-${foreman.id}`}
            value={personality}
            onChange={(e) => setPersonality(e.target.value)}
          />
        </div>
        <div className="actions">
          <button type="button" className="icon-button" onClick={() => setEditing(false)}>
            Cancel
          </button>
          <button
            type="button"
            className="send"
            onClick={() =>
              guard(async () => {
                await onEdit({ name: name.trim(), personality });
                setEditing(false);
              })
            }
          >
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="foreman-row">
      <div className="foreman-meta">
        <span className="foreman-name">
          {foreman.name}
          {inUse ? <span className="foreman-badge">in use</span> : null}
        </span>
        <span className="foreman-persona">{foreman.personality || 'No personality set.'}</span>
      </div>
      <div className="foreman-actions">
        <button type="button" className="icon-button" onClick={() => setEditing(true)}>
          Edit
        </button>
        <button
          type="button"
          className="icon-button danger"
          disabled={inUse}
          title={inUse ? 'Detach it from every playthrough first.' : 'Delete this foreman'}
          onClick={() => guard(onRemove)}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
