// MCP tools only the backend itself may call (the save-summary cache and the save service go
// straight to the MCP gateway). Kept in one place so the chat loop hides them from the model and
// the tool runner refuses them when the model calls one anyway.

/** MCP tools the backend calls itself; never offered to the model, refused if it calls one. */
const HOST_INTERNAL_TOOLS: ReadonlySet<string> = new Set(['describe_save', 'get_save_summary']);

/** True when `name` is a host-internal MCP tool the model must neither see nor run. */
export function isHostInternalTool(name: string): boolean {
  return HOST_INTERNAL_TOOLS.has(name);
}
