import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleOctoMessageAction } from "./actions.js";
import { sendMessage } from "./api-fetch.js";

vi.mock("./api-fetch.js", async (original) => ({
  ...await original<typeof import("./api-fetch.js")>(), sendMessage: vi.fn(),
}));

beforeEach(() => { vi.clearAllMocks(); vi.mocked(sendMessage).mockResolvedValue({ message_id: "90000001", message_seq: 1 }); });

describe("message-tool delivered text capture", () => {
  it("records the actual thread destination and server receipt after routing", async () => {
    const delivered = vi.fn(async () => {});
    await handleOctoMessageAction({ action: "send", args: { target: "group:room", message: "已处理。" },
      apiUrl: "http://octo.test", botToken: "test", currentChannelId: "room____topic", onTextDelivered: delivered });
    expect(delivered).toHaveBeenCalledExactlyOnceWith({
      channelId: "room____topic", channelType: 5, messageId: "90000001", text: "已处理。",
    });
  });

  it("does not capture a failed send and preserves its original failure", async () => {
    const delivered = vi.fn(async () => {});
    vi.mocked(sendMessage).mockRejectedValue(new Error("send fixture failure"));
    await expect(handleOctoMessageAction({ action: "send", args: { target: "group:room", message: "test" },
      apiUrl: "http://octo.test", botToken: "test", onTextDelivered: delivered })).rejects.toThrow("send fixture failure");
    expect(delivered).not.toHaveBeenCalled();
  });

  it("keeps a successful send successful if capture fails", async () => {
    const result = await handleOctoMessageAction({ action: "send", args: { target: "group:room", message: "test" },
      apiUrl: "http://octo.test", botToken: "test", onTextDelivered: async () => { throw new Error("capture failure"); } });
    expect(result.ok).toBe(true);
    expect(sendMessage).toHaveBeenCalledOnce();
  });
});
