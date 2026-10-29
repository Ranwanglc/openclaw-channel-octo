import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelType, MessageType } from "./types.js";
import { handleInboundMessage } from "./inbound.js";
import { setOctoRuntime } from "./runtime.js";
import { registerKnownBot, _clearKnownBots } from "./bot-registry.js";
import { _clearMentionPrefCache, _setMentionPrefEntry } from "./mention-prefs.js";
import type { ResolvedOctoAccount } from "./accounts.js";

const bridge = vi.hoisted(() => ({ record: vi.fn(), recall: vi.fn(), rememberDirectTarget: vi.fn() }));
vi.mock("./memory/bridge.js", async (original) => ({
  ...await original<typeof import("./memory/bridge.js")>(), getMemoryBridge: () => bridge,
}));

const bot = "bot_memory", human = "human_memory", group = "memory_group";
const originalFetch = globalThis.fetch;
let contexts: any[];
let dispatch: ReturnType<typeof vi.fn>;
let failSend = false;
let requireMention = false;

function inbound(id = "900000000000000001", extra: Record<string, unknown> = {}) {
  return handleInboundMessage({
    account: { accountId: "memory-acct", enabled: true, configured: true,
      config: { botToken: "test", apiUrl: "http://octo-memory.test", requireMention } } as ResolvedOctoAccount,
    botUid: bot,
    message: { message_id: id, message_seq: 100, timestamp: 1790000000,
      from_uid: human, channel_id: group, channel_type: ChannelType.Group,
      payload: { type: MessageType.Text, content: "我现在住在上海。" }, ...extra } as any,
    groupHistories: new Map(), lastBotReplySeqMap: new Map(), memberMap: new Map(),
    uidToNameMap: new Map(), groupCacheTimestamps: new Map(),
  });
}

beforeEach(() => {
  vi.clearAllMocks(); _clearKnownBots(); _clearMentionPrefCache(); registerKnownBot(bot);
  requireMention = false; failSend = false; contexts = [];
  _setMentionPrefEntry("memory-acct", group, { no_mention: true });
  bridge.record.mockResolvedValue(undefined);
  bridge.recall.mockResolvedValue("historical memory fixture");
  dispatch = vi.fn(async (args: any) => {
    await args.dispatcherOptions.deliver({ text: "已了解你的地址。" }, { kind: "final" });
  });
  setOctoRuntime({ config: { current: () => ({}) }, channel: {
    reply: { dispatchReplyWithBufferedBlockDispatcher: dispatch,
      resolveEnvelopeFormatOptions: () => ({}), formatAgentEnvelope: ({ body }: any) => body,
      finalizeInboundContext: (ctx: any) => { contexts.push(ctx); return ctx; } },
    routing: { resolveAgentRoute: () => ({ agentId: "agent-memory", sessionKey: "sk-memory", accountId: "memory-acct" }) },
    session: { resolveStorePath: () => "/tmp/memory-store", readSessionUpdatedAt: () => undefined,
      recordInboundSession: async () => {} },
  } } as any);
  globalThis.fetch = vi.fn(async (input: any) => {
    const url = String(input);
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
      status, headers: { "Content-Type": "application/json" },
    });
    if (url.includes("/members")) return json({ members: [{ uid: human, name: "Alice", robot: false }] });
    if (url.includes("/mention_pref")) return json({ no_mention: !requireMention });
    if (url.includes("/md")) return json({ content: "", version: 0 });
    if (url.includes("/messages/sync")) return json({ messages: [] });
    if (url.includes("/sendMessage")) return failSend ? json({ error: "rejected" }, 400)
      : json({ message_id: "900000000000000002", message_seq: 101 });
    return json({});
  }) as typeof fetch;
});

afterEach(() => { globalThis.fetch = originalFetch; _clearKnownBots(); _clearMentionPrefCache(); });

describe("memory integration at the admitted inbound boundary", () => {
  it("captures the original human text and a delivered final reply, injecting recall only for the agent", async () => {
    await inbound();
    expect(bridge.record).toHaveBeenCalledWith(expect.objectContaining({
      event_type: "message.received", speaker_id: human, speaker_kind: "human", text: "我现在住在上海。",
      scope: { kind: "group", conversation_id: group },
    }));
    expect(contexts[0].RawBody).toBe("我现在住在上海。");
    expect(contexts[0].Body).not.toContain("historical memory fixture");
    expect(contexts[0].BodyForAgent).toContain("historical memory fixture");
    expect(bridge.record).toHaveBeenCalledWith(expect.objectContaining({
      event_type: "assistant.delivered", message_id: "900000000000000002", speaker_kind: "bot",
      reply_to_message_id: "900000000000000001",
    }));
  });

  it("does not collect synthetic actions or unmentioned messages rejected by admission", async () => {
    await inbound("synthetic-card-action");
    expect(dispatch).toHaveBeenCalled();
    expect(bridge.record).not.toHaveBeenCalled();
    requireMention = true;
    _setMentionPrefEntry("memory-acct", group, { no_mention: false });
    dispatch.mockClear();
    await inbound("900000000000000003");
    expect(dispatch).not.toHaveBeenCalled();
    expect(bridge.record).not.toHaveBeenCalled();
    expect(bridge.recall).not.toHaveBeenCalled();
  });

  it("does not call a failed outbound send a delivered memory", async () => {
    failSend = true;
    await expect(inbound()).rejects.toThrow("sendMessage");
    expect(bridge.record.mock.calls.map(([e]) => e.event_type)).toEqual(["message.received"]);
  });

  it("continues dispatch when the memory adapter fails", async () => {
    bridge.record.mockRejectedValue(new Error("outbox fixture failure"));
    await inbound();
    expect(dispatch).toHaveBeenCalledOnce();
    expect(contexts[0].BodyForAgent).not.toContain("historical memory fixture");
  });
});
