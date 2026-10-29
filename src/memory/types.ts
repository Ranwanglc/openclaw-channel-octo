export interface MemoryConfig {
  enabled?: boolean;
  mcpUrl?: string;
  tokenEnv?: string;
  sourceInstance?: string;
  outboxDir?: string;
  recallTimeoutMs?: number;
  maxContextChars?: number;
}

export interface MemoryScope {
  kind: "direct" | "group" | "thread" | "document";
  conversation_id: string;
  parent_id?: string;
}

export interface MemoryEvent {
  schema_version: 1;
  event_type: "message.received" | "assistant.delivered";
  message_id: string;
  scope: MemoryScope;
  speaker_id: string;
  speaker_kind: "human" | "bot" | "unknown";
  text: string;
  occurred_at: string;
  sequence?: number;
  reply_to_message_id?: string;
  trace?: Record<string, string>;
}

export interface MemoryClient {
  call(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

export type MemoryLog = { warn?: (message: string) => void; error?: (message: string) => void };
