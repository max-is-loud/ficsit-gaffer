// The MCP tool-result shape shared by the game-data tool files, and the version-tagged success and
// error results they return.

/** What an MCP tool handler returns: one JSON text block, optionally flagged as an error. */
export type ToolResult = {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
};

/** A success: the payload with the game-data version stamped first. */
export function okResult(version: string, payload: object): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ version, ...payload }) }] };
}

/** An error the model can read and act on, version-tagged like every other response. */
export function errorResult(version: string, error: string): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify({ version, error }) }], isError: true };
}

/** The standard miss: `Not found: <what>`. */
export function notFoundResult(version: string, what: string): ToolResult {
  return errorResult(version, `Not found: ${what}`);
}
