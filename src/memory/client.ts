import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { MemoryClient } from "./types.js";

// Python MCP SDK v2 may return a JSON text block instead of structuredContent.
export function decodeMemoryResult(result: Record<string, unknown>): Record<string, unknown> {
  if (result.isError) throw new Error("MEMORY_TOOL_REJECTED");
  let value = result.structuredContent;
  if (value === undefined) {
    if (!Array.isArray(result.content)) throw new Error("INVALID_MEMORY_RESPONSE");
    value = JSON.parse(result.content.filter((c) => c?.type === "text").map((c) => c.text ?? "").join(""));
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_MEMORY_RESPONSE");
  return value as Record<string, unknown>;
}

export class MemoryMcpClient implements MemoryClient {
  private client?: Client;
  private connecting?: Promise<Client>;

  constructor(private readonly url: string, private readonly token: string,
              private readonly expected: { source_instance: string; bot_account_id: string }) {}

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const [{ Client }, { StreamableHTTPClientTransport }] = await Promise.all([
        import("@modelcontextprotocol/sdk/client/index.js"),
        import("@modelcontextprotocol/sdk/client/streamableHttp.js"),
      ]);
      const client = new Client({ name: "octo-memory-bridge", version: "0.1.0" });
      const transport = new StreamableHTTPClientTransport(new URL(this.url), {
        requestInit: { headers: { Authorization: `Bearer ${this.token}` }, redirect: "error" },
      });
      try {
        await client.connect(transport, { timeout: 5000 });
        const binding = await client.callTool({ name: "memory_identity", arguments: {} }, undefined, { timeout: 5000 });
        const identity = decodeMemoryResult(binding);
        if (identity.source_instance !== this.expected.source_instance
            || identity?.bot_account_id !== this.expected.bot_account_id || identity?.protocol_version !== 1) {
          throw new Error("MEMORY_PRINCIPAL_MISMATCH");
        }
        this.client = client;
        return client;
      } catch (error) {
        await transport.close().catch(() => {});
        throw error;
      }
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  async call(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>> {
    try {
      const client = await this.connect();
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
      return decodeMemoryResult(result);
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async close(): Promise<void> {
    const client = this.client;
    this.client = undefined;
    await client?.close().catch(() => {});
  }
}
