export const MEMORY_CONFIG_DESCRIPTION =
  "Optional graph memory bridge. Disabled by default. mcpUrl points to octo-memory-graph /mcp; " +
  "tokenEnv names an environment variable containing that Bot account's memory credential. " +
  "Original admitted text and delivered replies are queued locally; recall has a bounded timeout.";

export const MEMORY_CONFIG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  description: MEMORY_CONFIG_DESCRIPTION,
  properties: {
    enabled: { type: "boolean", default: false },
    mcpUrl: { type: "string", description: "Streamable HTTP memory MCP URL, including /mcp." },
    tokenEnv: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]*$" },
    sourceInstance: { type: "string", minLength: 1, description: "Must match MEMORY_SOURCE_INSTANCE on the memory server." },
    outboxDir: { type: "string", description: "Persistent per-account outbox directory; keep it across Gateway restarts." },
    recallTimeoutMs: { type: "integer", minimum: 100, maximum: 5000, default: 800 },
    maxContextChars: { type: "integer", minimum: 200, maximum: 12000, default: 4000 },
  },
} as const;
