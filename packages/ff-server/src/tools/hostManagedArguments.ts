// Arguments that only the host may set (the save path). The chat loop hides them from the model's
// tool schemas, and the tool runner removes them from the model's calls, so a model can never
// point a save tool at another playthrough's save.

import type { ToolDefinition } from '../mcp/client.js';

/** Tool arguments the backend supplies itself; add a new host-only argument as one entry here. */
const HOST_MANAGED_ARGUMENTS: ReadonlySet<string> = new Set(['savePath']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withoutHostManagedKeys(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([key]) => !HOST_MANAGED_ARGUMENTS.has(key)),
  );
}

function hasHostManagedProperty(schema: Record<string, unknown>): boolean {
  const properties = schema['properties'];
  return (
    isRecord(properties) && Object.keys(properties).some((key) => HOST_MANAGED_ARGUMENTS.has(key))
  );
}

/**
 * Returns `tool` as the model may see it: without the host-managed keys in
 * `inputSchema.properties` and `inputSchema.required` (an emptied `required` is dropped, so the
 * schema stays valid). Returns `tool` itself when its schema has no host-managed property. Never
 * mutates `tool`, and gives equal output for equal input, so the tool list stays byte-identical
 * across turns (the prompt cache depends on it).
 */
export function withoutHostManagedProperties(tool: ToolDefinition): ToolDefinition {
  const schema = tool.inputSchema;
  if (!hasHostManagedProperty(schema)) {
    return tool;
  }
  const { required, ...rest } = schema;
  const inputSchema: Record<string, unknown> = {
    ...rest,
    properties: withoutHostManagedKeys(schema['properties'] as Record<string, unknown>),
  };
  const kept = Array.isArray(required)
    ? required.filter((name) => typeof name !== 'string' || !HOST_MANAGED_ARGUMENTS.has(name))
    : [];
  if (kept.length > 0) {
    inputSchema['required'] = kept;
  }
  return { ...tool, inputSchema };
}

/**
 * Returns a copy of a model tool call's `args` without the host-managed keys, whatever their
 * values. The caller then adds the host's own values (the gateway injects the save path).
 */
export function withoutHostManagedArguments(
  args: Record<string, unknown>,
): Record<string, unknown> {
  return withoutHostManagedKeys(args);
}
