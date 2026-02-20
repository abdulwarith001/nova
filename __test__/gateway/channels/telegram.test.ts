import { describe, expect, it, vi } from "vitest";
import { TelegramChannel } from "../../../gateway/src/../../gateway/src/channels/telegram.js";

function createChannel(overrides?: Partial<any>) {
  const chatService = {
    runChatTurn: vi.fn().mockResolvedValue({
      response: "Here is your answer",
      success: true,
      research: {
        sources: [{ url: "https://example.com/source" }],
        uncertainty: "low",
        confidence: 0.8,
      },
    }),
    resetHistory: vi.fn(),
  };
  const channel = new TelegramChannel(
    {
      enabled: true,
      botToken: "token",
      ownerUserId: 42,
      ownerChatId: undefined,
      pollTimeoutSec: 25,
      retryBaseMs: 1000,
      retryMaxMs: 30000,
      ...(overrides || {}),
    },
    chatService as any,
  ) as any;
  channel.sendMessage = vi.fn().mockResolvedValue(undefined);
  channel.sendChunkedMessage = vi.fn().mockResolvedValue(undefined);
  channel.sendChatAction = vi.fn().mockResolvedValue(undefined);
  return { channel, chatService };
}

describe("TelegramChannel", () => {
  it("routes authorized text messages to chat service", async () => {
    const { channel, chatService } = createChannel();
    await channel.handleUpdate({
      update_id: 100,
      message: {
        message_id: 1,
        date: Date.now(),
        from: { id: 42 },
        chat: { id: 99, type: "private" },
        text: "latest news",
      },
    });

    expect(chatService.runChatTurn).toHaveBeenCalledTimes(1);
    expect(channel.sendChunkedMessage).toHaveBeenCalledTimes(1);
    expect(channel.sendMessage).not.toHaveBeenCalled();
  });

  it("denies unauthorized users", async () => {
    const { channel, chatService } = createChannel();
    await channel.handleUpdate({
      update_id: 101,
      message: {
        message_id: 1,
        date: Date.now(),
        from: { id: 7 },
        chat: { id: 99, type: "private" },
        text: "hello",
      },
    });

    expect(chatService.runChatTurn).not.toHaveBeenCalled();
    expect(channel.sendMessage).toHaveBeenCalledWith(
      99,
      "This bot is restricted to the configured Nova owner.",
    );
  });

  it("supports /reset command", async () => {
    const { channel, chatService } = createChannel();
    await channel.handleUpdate({
      update_id: 102,
      message: {
        message_id: 1,
        date: Date.now(),
        from: { id: 42 },
        chat: { id: 123, type: "private" },
        text: "/reset",
      },
    });

    expect(chatService.resetHistory).toHaveBeenCalledWith("telegram:123");
    expect(channel.sendMessage).toHaveBeenCalledWith(
      123,
      "Chat context reset for this Telegram chat.",
    );
    expect(chatService.runChatTurn).not.toHaveBeenCalled();
  });

  it("does not crash startup when token is invalid", async () => {
    const { channel } = createChannel();
    channel.getMe = vi.fn().mockRejectedValue(new Error("unauthorized"));

    await expect(channel.start()).resolves.toBeUndefined();
    const status = channel.getStatus();
    expect(status.running).toBe(false);
    expect(status.connected).toBe(false);
    expect(status.lastError).toBe("telegram_getme_validation_failed");
  });

  it("disables channel when owner ids are missing", async () => {
    const { channel } = createChannel({
      ownerUserId: undefined,
      ownerChatId: undefined,
    });
    channel.getMe = vi.fn();

    await channel.start();
    const status = channel.getStatus();
    expect(status.running).toBe(false);
    expect(status.connected).toBe(false);
    expect(status.lastError).toBe("missing_telegram_owner_id");
    expect(channel.getMe).not.toHaveBeenCalled();
  });
});
