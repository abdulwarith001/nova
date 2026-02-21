import { describe, expect, it, vi } from "vitest";
import { WhatsAppChannel } from "../../../gateway/src/channels/whatsapp.js";

function createChannel(overrides?: Partial<any>) {
  const chatService = {
    runChatTurn: vi.fn().mockResolvedValue({
      response: "Here is your answer",
      success: true,
    }),
    resetHistory: vi.fn(),
  };

  const config = {
    enabled: true,
    ownerNumber: "2348012345678",
    isOwnNumber: false,
    allowedNumbers: ["2349011111111"],
    messagePrefix: "Nova:",
    ownerName: "Abdulwarith",
    ...(overrides || {}),
  };

  const channel = new WhatsAppChannel(config, chatService as any) as any;

  // Stub client for notifyOwner / sendDirectMessage
  channel.client = {
    sendMessage: vi.fn().mockResolvedValue(undefined),
  };

  return { channel, chatService, config };
}

/** Build a fake WhatsApp message object */
function fakeMsg(
  opts: {
    from?: string;
    to?: string;
    body?: string;
    fromMe?: boolean;
    type?: string;
    isStatus?: boolean;
    contactName?: string;
    contactPushname?: string;
  } = {},
) {
  const chat = {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendStateTyping: vi.fn().mockResolvedValue(undefined),
    clearState: vi.fn().mockResolvedValue(undefined),
  };

  const fromNumber = (opts.from || "2349099999999@c.us")
    .replace("@c.us", "")
    .replace("@s.whatsapp.net", "")
    .replace("@lid", "");

  return {
    type: opts.type || "chat",
    from: opts.from || "2349099999999@c.us",
    to: opts.to || "2348012345678@c.us",
    body: opts.body || "Hello",
    fromMe: opts.fromMe ?? false,
    isStatus: opts.isStatus ?? false,
    getChat: vi.fn().mockResolvedValue(chat),
    getContact: vi.fn().mockResolvedValue({
      name: opts.contactName || null,
      pushname: opts.contactPushname || "SomeSender",
      shortName: null,
      number: fromNumber,
    }),
    reply: vi.fn().mockResolvedValue(undefined),
    _chat: chat,
  };
}

describe("WhatsAppChannel", () => {
  describe("Bot-number mode", () => {
    it("processes authorized third-party messages with sender context", async () => {
      const { channel, chatService } = createChannel();
      const msg = fakeMsg({
        from: "2349011111111@c.us",
        contactPushname: "John",
      });

      await channel.handleMessage(msg);

      expect(chatService.runChatTurn).toHaveBeenCalledTimes(1);
      const call = chatService.runChatTurn.mock.calls[0][0];
      expect(call.senderContext).toContain(
        "Abdulwarith's personal AI assistant",
      );
      expect(call.senderContext).toContain("John");
      expect(call.senderContext).toContain("PRIVACY RULES");
    });

    it("processes owner messages with owner context", async () => {
      const { channel, chatService } = createChannel();
      const msg = fakeMsg({
        from: "2348012345678@c.us",
        contactName: "Me",
      });

      await channel.handleMessage(msg);

      expect(chatService.runChatTurn).toHaveBeenCalledTimes(1);
      const call = chatService.runChatTurn.mock.calls[0][0];
      expect(call.senderContext).toContain("IS Abdulwarith");
    });

    it("replies politely to unauthorized senders and notifies the owner", async () => {
      const { channel, chatService } = createChannel();
      const msg = fakeMsg({
        from: "2349099999999@c.us",
        body: "Hey, can we talk?",
        contactPushname: "Stranger",
      });

      await channel.handleMessage(msg);

      // Should NOT process the message via chat service
      expect(chatService.runChatTurn).not.toHaveBeenCalled();

      // Should reply politely
      expect(msg.reply).toHaveBeenCalledTimes(1);
      const replyText = msg.reply.mock.calls[0][0];
      expect(replyText).toContain("Stranger");
      expect(replyText).toContain("Abdulwarith");
      expect(replyText).toContain("not available");

      // Should notify owner
      expect(channel.client.sendMessage).toHaveBeenCalledTimes(1);
      const [ownerChatId, notification] =
        channel.client.sendMessage.mock.calls[0];
      expect(ownerChatId).toBe("2348012345678@c.us");
      expect(notification).toContain("Stranger");
      expect(notification).toContain("Hey, can we talk?");
    });

    it("skips messages sent by the bot itself", async () => {
      const { channel, chatService } = createChannel();
      const msg = fakeMsg({ fromMe: true });

      await channel.handleMessage(msg);

      expect(chatService.runChatTurn).not.toHaveBeenCalled();
    });

    it("ignores non-chat messages", async () => {
      const { channel, chatService } = createChannel();
      const msg = fakeMsg({ type: "image" });

      await channel.handleMessage(msg);

      expect(chatService.runChatTurn).not.toHaveBeenCalled();
    });
  });

  describe("Own-number mode", () => {
    it("processes all owner's outgoing messages", async () => {
      const { channel, chatService } = createChannel({ isOwnNumber: true });
      const msg = fakeMsg({
        fromMe: true,
        to: "2349011111111@c.us",
        body: "What's on my calendar?",
      });

      await channel.handleMessage(msg);

      expect(chatService.runChatTurn).toHaveBeenCalledTimes(1);
      const call = chatService.runChatTurn.mock.calls[0][0];
      expect(call.message).toBe("What's on my calendar?");
      expect(call.senderContext).toContain("IS Abdulwarith");
      expect(call.historyKey).toBe("whatsapp:2349011111111");
    });

    it("silently ignores messages from others in own-number mode", async () => {
      const { channel, chatService } = createChannel({ isOwnNumber: true });
      const msg = fakeMsg({
        from: "2349099999999@c.us",
        body: "Hello there",
        contactPushname: "RandomPerson",
      });

      await channel.handleMessage(msg);

      // Should NOT process or reply
      expect(chatService.runChatTurn).not.toHaveBeenCalled();
      expect(msg.reply).not.toHaveBeenCalled();
      expect(channel.client.sendMessage).not.toHaveBeenCalled();
    });

    it("skips messages with the Nova prefix to avoid loops", async () => {
      const { channel, chatService } = createChannel({ isOwnNumber: true });
      const msg = fakeMsg({
        fromMe: false,
        body: "Nova: Here is your answer",
      });

      await channel.handleMessage(msg);

      expect(chatService.runChatTurn).not.toHaveBeenCalled();
    });
  });

  describe("Commands", () => {
    it("supports /reset command", async () => {
      const { channel, chatService } = createChannel();
      const msg = fakeMsg({
        from: "2348012345678@c.us",
        body: "/reset",
      });

      await channel.handleMessage(msg);

      expect(chatService.resetHistory).toHaveBeenCalledWith(
        "whatsapp:2348012345678",
      );
      expect(chatService.runChatTurn).not.toHaveBeenCalled();
    });
  });

  describe("Sender name resolution", () => {
    it("uses saved contact name when available", async () => {
      const { channel, chatService } = createChannel();
      const msg = fakeMsg({
        from: "2349011111111@c.us",
        contactName: "John Doe",
        contactPushname: "Johnny",
      });

      await channel.handleMessage(msg);

      const call = chatService.runChatTurn.mock.calls[0][0];
      expect(call.senderContext).toContain("John Doe");
    });

    it("falls back to pushname when no saved contact", async () => {
      const { channel, chatService } = createChannel();
      const msg = fakeMsg({
        from: "2349011111111@c.us",
        contactName: null as any,
        contactPushname: "Johnny",
      });

      await channel.handleMessage(msg);

      const call = chatService.runChatTurn.mock.calls[0][0];
      expect(call.senderContext).toContain("Johnny");
    });
  });
});
