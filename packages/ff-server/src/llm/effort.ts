// The model's effort level: the levels, which Anthropic models accept which, and how each provider
// adapter turns a level into its own request parameter. Kept apart from the adapters so the
// support table, the check and the wire shapes sit in one place.

/** How hard the model works on a turn. Anthropic's `output_config.effort` scale, lowest first. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** Raised when the model cannot take the effort that the request asks for. */
export class UnsupportedEffortError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'UnsupportedEffortError';
  }
}

export function isEffortLevel(value: unknown): value is EffortLevel {
  return typeof value === 'string' && (EFFORT_LEVELS as readonly string[]).includes(value);
}

/**
 * Reads an effort level from a setting. Unset and blank mean "no effort"; anything else must be a
 * level, and the error names the setting so a bad `.env` line is easy to find.
 */
export function parseEffortLevel(
  raw: string | undefined,
  settingName: string,
): EffortLevel | undefined {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  if (!isEffortLevel(value)) {
    throw new Error(
      `${settingName} must be one of ${EFFORT_LEVELS.join(', ')}; got '${raw?.trim()}'.`,
    );
  }
  return value;
}

/** Levels of one Anthropic model family. An empty list means the family has no effort parameter. */
interface AnthropicEffortSupport {
  pattern: RegExp;
  levels: readonly EffortLevel[];
}

const NO_XHIGH: readonly EffortLevel[] = ['low', 'medium', 'high', 'max'];
const LOW_TO_HIGH: readonly EffortLevel[] = ['low', 'medium', 'high'];

/**
 * A pattern for exactly the named Claude versions, so that a version the table does not list
 * (`claude-sonnet-4-7`, `claude-haiku-50`) matches no row. `versions` is a regex fragment such as
 * `opus-4-[78]`. The ID may end with a date (`-20251101`) or `-latest`, and may carry a cloud
 * prefix (`anthropic.`, `us.anthropic.`) or suffix (`-v1:0` on Bedrock, `@20251101` on Vertex).
 */
function claudeModelId(versions: string): RegExp {
  return new RegExp(
    `(?:^|[./])claude-(?:${versions})(?:-\\d{8}|-latest)?(?:-v\\d+:\\d+|@\\d{8})?$`,
  );
}

/**
 * Effort levels per Anthropic model version. Each row names its versions, so a model that matches
 * no row is not blocked: a new model should not wait for a code change, and the provider decides.
 * Source: the Claude API reference (models and effort), checked 2026-11-05. The Models API lists
 * the same facts at `capabilities.effort`.
 */
const ANTHROPIC_EFFORT_SUPPORT: readonly AnthropicEffortSupport[] = [
  { pattern: claudeModelId('(?:fable|mythos)-5(?:-1)?'), levels: EFFORT_LEVELS },
  { pattern: claudeModelId('opus-5(?:-5)?|opus-4-[78]'), levels: EFFORT_LEVELS },
  { pattern: claudeModelId('sonnet-5(?:-5)?|haiku-5-5'), levels: EFFORT_LEVELS },
  { pattern: claudeModelId('(?:opus|sonnet)-4-6'), levels: NO_XHIGH },
  { pattern: claudeModelId('opus-4-5'), levels: LOW_TO_HIGH },
  // No effort parameter: Sonnet 4 and 4.5, Opus 4 and 4.1, Haiku 4.5, and the Claude 3 family.
  {
    pattern: claudeModelId(
      'sonnet-4(?:-5)?|opus-4(?:-1)?|haiku-4-5|3(?:-[57])?-(?:opus|sonnet|haiku)',
    ),
    levels: [],
  },
];

/** The levels the Anthropic model accepts, or `undefined` when the model is not in the table. */
export function supportedAnthropicEfforts(model: string): readonly EffortLevel[] | undefined {
  const id = model.toLowerCase();
  return ANTHROPIC_EFFORT_SUPPORT.find((entry) => entry.pattern.test(id))?.levels;
}

/** Throws an {@link UnsupportedEffortError} when the Anthropic model cannot take `effort`. */
function assertAnthropicEffort(model: string, effort: EffortLevel): void {
  const levels = supportedAnthropicEfforts(model);
  if (levels === undefined || levels.includes(effort)) {
    return;
  }
  throw new UnsupportedEffortError(
    levels.length === 0
      ? `Model '${model}' does not support effort '${effort}'; it has no effort setting.`
      : `Model '${model}' does not support effort '${effort}'; it accepts ${levels.join(', ')}.`,
  );
}

/**
 * Checks, before any provider call, that the model can take the effort. Only Anthropic has a
 * support table. The OpenAI-compatible API documents no per-model list, so there the provider
 * decides and {@link effortRejection} turns its refusal into a clear error.
 */
export function assertEffortSupported(
  provider: 'anthropic' | 'openai',
  model: string,
  effort: EffortLevel | undefined,
): void {
  if (effort !== undefined && provider === 'anthropic') {
    assertAnthropicEffort(model, effort);
  }
}

/**
 * The Anthropic request fragment for the effort: nothing when it is unset (so the request is the
 * same as before the setting existed), else `output_config.effort`. Throws when the model
 * cannot take the level.
 */
export function anthropicEffortParam(
  model: string,
  effort: EffortLevel | undefined,
): { output_config?: { effort: EffortLevel } } {
  if (effort === undefined) {
    return {};
  }
  assertAnthropicEffort(model, effort);
  return { output_config: { effort } };
}

/**
 * True for OpenAI's reasoning models (the GPT-5 family and the o-series). Both the output-limit
 * parameter and `reasoning_effort` depend on it. The `(^|/)` guard tolerates an OpenRouter-style
 * `openai/gpt-5-mini` prefix; the `[-.]` boundary tolerates a dotted minor version such as
 * `gpt-5.4-mini`.
 */
export function isReasoningModel(model: string): boolean {
  return /(^|\/)(gpt-5|o[1-4])([-.]|$)/.test(model);
}

/**
 * The OpenAI-compatible request fragment: `reasoning_effort` for a reasoning model, else nothing
 * (other models reject the parameter, and local servers ignore it).
 */
export function openAiEffortParam(
  model: string,
  effort: EffortLevel | undefined,
): { reasoning_effort?: EffortLevel } {
  return effort !== undefined && isReasoningModel(model) ? { reasoning_effort: effort } : {};
}

/**
 * Maps a provider's HTTP 400 that complains about effort to a clear error naming the model and
 * level, so the raw provider message is not all the user sees. Returns `undefined` for any other
 * error, and when the request sent no effort.
 */
export function effortRejection(
  error: unknown,
  model: string,
  effort: EffortLevel | undefined,
): UnsupportedEffortError | undefined {
  if (effort === undefined || !(error instanceof Error)) {
    return undefined;
  }
  const status = (error as { status?: unknown }).status;
  if (status !== 400 || !/effort/i.test(error.message)) {
    return undefined;
  }
  return new UnsupportedEffortError(
    `The provider rejected effort '${effort}' for model '${model}': ${error.message}`,
  );
}
