import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildSystemPrompt, loadSystemPromptTemplate } from '../src/anthropic/systemPrompt.js';
import { resolveSystemPromptPath } from '../src/config.js';

function tempPrompt(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-prompt-'));
  const file = path.join(dir, 'SYSTEM_PROMPT.md');
  fs.writeFileSync(file, contents);
  return file;
}

describe('loadSystemPromptTemplate', () => {
  it('extracts the fenced code block, dropping surrounding markdown', () => {
    const file = tempPrompt(
      '# Heading\n\nintro\n\n```\nYou are the Foreman {{PERSONALITY}}.\n```\n\nNotes after.',
    );
    const template = loadSystemPromptTemplate(file);
    expect(template).toBe('You are the Foreman {{PERSONALITY}}.');
  });

  it('falls back to the whole file when there is no fence', () => {
    const file = tempPrompt('Plain prompt with {{PIONEER_PROFILE}}.');
    expect(loadSystemPromptTemplate(file)).toBe('Plain prompt with {{PIONEER_PROFILE}}.');
  });
});

describe('buildSystemPrompt', () => {
  const template =
    'Personality: <p>{{PERSONALITY}}</p> Pioneer: <q>{{PIONEER_PROFILE}}</q>{{SESSION_SUMMARY}}## Authority';

  it('substitutes both placeholders from session state', () => {
    const result = buildSystemPrompt(template, { personality: 'Gruff', pioneerProfile: 'Veteran' });
    expect(result).toContain('Personality: <p>Gruff</p> Pioneer: <q>Veteran</q>');
    expect(result).not.toContain('{{');
  });

  it('falls back to neutral defaults for empty values', () => {
    const result = buildSystemPrompt(template, { personality: '   ', pioneerProfile: '' });
    expect(result).not.toContain('{{PERSONALITY}}');
    expect(result).not.toContain('{{PIONEER_PROFILE}}');
    expect(result).toContain('professional, focused factory foreman');
    expect(result).toContain('returning player');
  });

  it('omits the summary block entirely when there is no summary', () => {
    const result = buildSystemPrompt(template, { personality: 'Gruff', pioneerProfile: 'Veteran' });
    expect(result).not.toContain('{{SESSION_SUMMARY}}');
    expect(result).not.toContain('Session So Far');
  });

  it('injects the summary block between pioneer profile and authority', () => {
    const result = buildSystemPrompt(template, {
      personality: 'Gruff',
      pioneerProfile: 'Veteran',
      summary: 'Built an iron line; pioneer enjoyed exploring, disliked belts.',
    });
    expect(result).toContain('Session So Far');
    expect(result).toContain('disliked belts');
    // Summary sits after the pioneer block and before the authority section.
    expect(result.indexOf('Veteran')).toBeLessThan(result.indexOf('Session So Far'));
    expect(result.indexOf('Session So Far')).toBeLessThan(result.indexOf('## Authority'));
  });

  it('treats a whitespace-only summary as empty', () => {
    const result = buildSystemPrompt(template, {
      personality: 'Gruff',
      pioneerProfile: 'Veteran',
      summary: '   ',
    });
    expect(result).not.toContain('Session So Far');
  });
});

describe('live Constructor guidance in the bundled prompt', () => {
  const prompt = loadSystemPromptTemplate(resolveSystemPromptPath({}));
  const section = prompt.slice(prompt.indexOf('## Live Constructor Observations'));

  it('has a dedicated section naming the tool', () => {
    expect(prompt).toContain('## Live Constructor Observations');
    expect(section).toContain('get_live_constructor_state');
  });

  it('requires a fresh query and never treats earlier text or summaries as current', () => {
    expect(section).toMatch(/call `get_live_constructor_state` (again )?for every/i);
    expect(section).toMatch(/earlier (messages|answers)/i);
    expect(section).toMatch(/summar/i);
  });

  it('distinguishes fresh, last-known and unavailable answers', () => {
    expect(section).toMatch(/last.known/i);
    expect(section).toMatch(/lastSyncAt/);
    expect(section).toMatch(/unavailable/i);
    expect(section).toMatch(/unknown, not zero/i);
  });

  it('keeps live observations separate from save data', () => {
    expect(section).toMatch(/save/i);
    expect(section).toMatch(/separate|not the same as|never mix/i);
  });

  it('discloses partial locations against the exact total', () => {
    expect(section).toMatch(/totalConstructors/);
    expect(section).toMatch(/partial|some of/i);
  });

  it('forbids invented landmarks and claims beyond Constructors', () => {
    expect(section).toMatch(/near your base/i);
    expect(section).toMatch(/recipes|power|production/i);
  });
});

describe('research economy guidance in the bundled prompt', () => {
  const prompt = loadSystemPromptTemplate(resolveSystemPromptPath({}));
  const section = prompt.slice(prompt.indexOf('## Research Efficiently'));

  it('has a dedicated section', () => {
    expect(prompt).toContain('## Research Efficiently');
  });

  it('asks for independent lookups in the same round', () => {
    expect(section).toContain('same round');
  });

  it('prefers full_production_line over chained lookups', () => {
    expect(section).toContain('full_production_line');
    expect(prompt).not.toContain(
      'Full production breakdown with machine counts → `ingredient_tree`',
    );
  });

  it('forbids re-fetching facts already in hand', () => {
    expect(section).toMatch(/do not re-fetch/i);
  });
});
