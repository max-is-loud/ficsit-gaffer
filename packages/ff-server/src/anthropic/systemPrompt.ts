// Loads the foreman system prompt template from SYSTEM_PROMPT.md and fills in its personality,
// pioneer-profile and session-summary placeholders for each chat turn.

import fs from 'node:fs';

/**
 * The values substituted into the system prompt for a turn: the foreman's
 * persona, the playthrough's pioneer profile, and (if any) its running summary.
 */
export interface PromptContext {
  personality: string;
  pioneerProfile: string;
  summary?: string;
}

const PERSONALITY_PLACEHOLDER = '{{PERSONALITY}}';
const PIONEER_PLACEHOLDER = '{{PIONEER_PROFILE}}';
const SUMMARY_PLACEHOLDER = '{{SESSION_SUMMARY}}';

const DEFAULT_PERSONALITY =
  'A professional, focused factory foreman. Direct, practical, and encouraging without waffle.';
const DEFAULT_PIONEER_PROFILE =
  'No pioneer profile captured yet. Assume a returning player; calibrate as you learn more.';

/**
 * Loads the foreman system prompt template. SYSTEM_PROMPT.md wraps the actual
 * prompt in a fenced code block; this extracts that block's contents. If no
 * fence is present the whole file is used. The template still contains the
 * {{PERSONALITY}} and {{PIONEER_PROFILE}} placeholders — substitution happens
 * per-request via {@link buildSystemPrompt}.
 */
export function loadSystemPromptTemplate(filePath: string): string {
  const raw = fs.readFileSync(filePath, 'utf8');
  const fenced = /```[a-zA-Z]*\n([\s\S]*?)```/.exec(raw);
  const template = fenced?.[1] ?? raw;
  return template.trim();
}

/**
 * Produces the final system prompt for a turn by substituting the foreman's
 * personality, the playthrough's pioneer profile, and (if present) its running
 * summary. Empty personality/profile fall back to neutral defaults so the
 * foreman is never handed an empty character; an empty summary omits its block.
 */
export function buildSystemPrompt(template: string, context: PromptContext): string {
  const personality = context.personality.trim() || DEFAULT_PERSONALITY;
  const pioneerProfile = context.pioneerProfile.trim() || DEFAULT_PIONEER_PROFILE;
  const summary = context.summary?.trim() ?? '';
  const summaryBlock =
    summary.length > 0
      ? `\n## Session So Far\n\nA condensed record of what has happened earlier in this session, beyond the recent messages you can see:\n\n${summary}\n`
      : '';
  return template
    .split(PERSONALITY_PLACEHOLDER)
    .join(personality)
    .split(PIONEER_PLACEHOLDER)
    .join(pioneerProfile)
    .split(SUMMARY_PLACEHOLDER)
    .join(summaryBlock);
}
