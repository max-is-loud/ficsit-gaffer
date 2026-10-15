// Turns findings into the check's messages and decides the exit code.
// Wording lives in one table keyed by finding kind, so a new kind is data rather than a branch.

/** @typedef {import('./config.mjs').SourceLimitsConfig} SourceLimitsConfig */
/** @typedef {import('./rules.mjs').Finding} Finding */

const UPDATE_COMMAND = 'npm run check:source -- --update';

/** @type {Record<string, (finding: Finding, config: SourceLimitsConfig) => string>} */
const TEMPLATES = {
  'too-long': (finding, config) =>
    `${finding.path}: ${finding.lines} lines (limit ${config.hardLimit}). ` +
    'Split it by responsibility — see CONTRIBUTING.md › Code standards.',
  'soft-limit': (finding, config) =>
    `${finding.path}: ${finding.lines} lines (over ${config.softLimit}).`,
  'exempt-grew': (finding) =>
    `${finding.path}: grew from ${finding.recorded} to ${finding.lines} lines while exempt ` +
    `(#${finding.issue}). Exempt files may not grow.`,
  'exempt-shrunk': (finding) =>
    `${finding.path}: now ${finding.lines} lines, recorded ${finding.recorded}. ` +
    `Lower the recorded count (${UPDATE_COMMAND}).`,
  'exempt-compliant': (finding) =>
    `${finding.path}: now ${finding.lines} lines — remove its exemption (${UPDATE_COMMAND}).`,
  'exempt-missing': (finding) =>
    `${finding.path}: exempt but the file no longer exists. Remove its entry (${UPDATE_COMMAND}).`,
  'missing-header': (finding) =>
    `${finding.path}: no file header. ` +
    'Start the file with a comment saying what it is responsible for.',
};

/**
 * Renders one finding as a single line that says what is wrong and how to fix it.
 * @param {Finding} finding
 * @param {SourceLimitsConfig} config
 * @returns {string}
 */
export function formatFinding(finding, config) {
  return TEMPLATES[finding.kind](finding, config);
}

/**
 * Builds the full report: errors first, then the soft-limit warning summary.
 * Only errors make the exit code non-zero; warnings never fail the check.
 * @param {{ findings: Finding[], config: SourceLimitsConfig }} input
 * @returns {{ text: string, exitCode: 0 | 1 }}
 */
export function formatReport({ findings, config }) {
  const errors = findings.filter((finding) => finding.severity === 'error');
  const warnings = findings.filter((finding) => finding.severity === 'warning');
  const sections = [];
  if (errors.length > 0) {
    sections.push(errors.map((finding) => formatFinding(finding, config)).join('\n'));
  }
  if (warnings.length > 0) {
    const heading = `Files over ${config.softLimit} lines (warning only):`;
    sections.push(
      [heading, ...warnings.map((finding) => formatFinding(finding, config))].join('\n'),
    );
  }
  return { text: sections.join('\n\n'), exitCode: errors.length > 0 ? 1 : 0 };
}
