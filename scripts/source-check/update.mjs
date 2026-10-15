// Applies the ratchet's --update mode to a config and writes it back to disk.
// It only ever lowers recorded counts or removes entries, so the list can never loosen.

import fs from 'node:fs';

/** @typedef {import('./config.mjs').SourceLimitsConfig} SourceLimitsConfig */
/** @typedef {import('./rules.mjs').Finding} Finding */

const COMMENT =
  'Ratchet list for npm run check:source. Entries may only be removed or lowered. ' +
  'See CONTRIBUTING.md › Code standards.';

const REMOVAL_KINDS = new Set(['exempt-compliant', 'exempt-missing']);

/**
 * Returns a new config with shrunk counts lowered and stale entries removed.
 * Grown files and new oversized files are deliberately ignored: they must stay failures.
 * @param {{ config: SourceLimitsConfig, findings: Finding[] }} input
 * @returns {SourceLimitsConfig}
 */
export function applyUpdates({ config, findings }) {
  const removed = new Set(
    findings.filter((finding) => REMOVAL_KINDS.has(finding.kind)).map((finding) => finding.path),
  );
  const lowered = new Map(
    findings
      .filter((finding) => finding.kind === 'exempt-shrunk')
      .map((item) => [item.path, item.lines]),
  );
  const exemptFiles = config.exemptFiles
    .filter((entry) => !removed.has(entry.path))
    .map((entry) => ({
      ...entry,
      lines: Math.min(entry.lines, lowered.get(entry.path) ?? entry.lines),
    }));
  return { ...config, exemptFiles };
}

/**
 * Writes the config as 2-space JSON with $comment first and a trailing newline.
 * @param {{ path: string, config: SourceLimitsConfig }} input
 * @returns {void}
 */
export function writeConfig({ path: filePath, config }) {
  const body = JSON.stringify({ $comment: COMMENT, ...config }, null, 2);
  fs.writeFileSync(filePath, `${body}\n`);
}
