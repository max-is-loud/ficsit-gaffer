// Compact header drop-zone and file picker for uploading a newer .sav to the
// active playthrough. It reports upload status and errors; the upload itself is a
// callback.

import { useRef, useState } from 'react';

interface SaveDropZoneProps {
  /** Uploads the file to the active playthrough (replaces its current save). */
  onUpload: (file: File) => Promise<void>;
  /** No active playthrough to attach to — render inert. */
  disabled?: boolean;
}

type Status = 'idle' | 'uploading' | 'error';

/**
 * A compact header drop-zone for swapping in a newer save on the active
 * playthrough. Sits next to the playthrough switcher and matches its height.
 * Clicking opens the file dialog; dropping (or picking) uploads immediately —
 * no confirmation — replacing the current save (latest-only). Version history
 * and same-game detection are deferred to #76.
 */
export function SaveDropZone({ onUpload, disabled = false }: SaveDropZoneProps): React.JSX.Element {
  const [status, setStatus] = useState<Status>('idle');
  const [dragging, setDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const busy = disabled || status === 'uploading';

  const upload = (file: File | undefined): void => {
    if (file === undefined || busy) {
      return;
    }
    setStatus('uploading');
    setMessage(null);
    void onUpload(file)
      .then(() => setStatus('idle'))
      .catch((e: unknown) => {
        setStatus('error');
        setMessage(e instanceof Error ? e.message : 'Upload failed.');
      });
  };

  const label =
    status === 'uploading'
      ? 'Uploading…'
      : status === 'error'
        ? 'Upload failed — try again'
        : 'Click/drop your save game here';

  const title = disabled
    ? 'Select a playthrough first.'
    : (message ?? 'Click or drop a .sav to update this playthrough');

  return (
    <div
      className={`save-drop${dragging ? ' dragging' : ''}${status === 'error' ? ' error' : ''}`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label="Upload a save game for the current playthrough"
      title={title}
      onClick={() => {
        if (!busy) {
          fileInput.current?.click();
        }
      }}
      onKeyDown={(e) => {
        if (!busy && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          fileInput.current?.click();
        }
      }}
      onDragOver={(e) => {
        if (busy) {
          return;
        }
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        upload(e.dataTransfer.files?.[0]);
      }}
    >
      <span className="save-drop-icon" aria-hidden="true">
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 16V4M7 9l5-5 5 5" />
          <path d="M5 20h14" />
        </svg>
      </span>
      <span className="save-drop-text">{label}</span>
      <input
        ref={fileInput}
        type="file"
        accept=".sav"
        hidden
        onChange={(e) => {
          upload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
