// Dismissible banner listing advisories returned by a save upload, such as a
// game-build mismatch.

import type { SaveWarning } from '../api/types.js';

interface SaveWarningBannerProps {
  warnings: SaveWarning[];
  onDismiss: () => void;
}

/**
 * Dismissible advisory shown after a save upload — currently a build-version
 * mismatch between the uploaded save and the foreman's loaded game data. Mirrors
 * the header's other transient banners.
 */
export function SaveWarningBanner({
  warnings,
  onDismiss,
}: SaveWarningBannerProps): React.JSX.Element | null {
  if (warnings.length === 0) {
    return null;
  }
  return (
    <div className="banner save-warning">
      <span>{warnings.map((w) => w.message).join(' ')}</span>
      <button type="button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
