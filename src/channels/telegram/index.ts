import { Bot } from "grammy";
import { createLogger } from "../../utils/logger.js";
import type {
  ChannelPlugin,
  MessageHandler,
  MsgContext,
  OutboundMessage,
  ChannelCapabilities,
} from "../interface.js";

const log = createLogger("telegram");

export interface TelegramConfig {
  token: string;
  allowList?: string[];
}

export function createTelegramPlugin(config: TelegramConfig): ChannelPlugin {
  const bot = new Bot(config.token);
  let messageHandler: MessageHandler | null = null;

  const capabilities: ChannelCapabilities = {
    reactions: true,
    threads: false,
    buttons: true,
    markdown: true,
    maxMessageLength: 4096,
  };

  return {
    id: "telegram",
    capabilities,

    async start() {
      log.info("Starting Telegram bot...");

      bot.on("message:text", async (ctx) => {
        if (!messageHandler) return;

        const chatType = ctx.chat.type === "private" ? "direct" : "group";

        // MVP: only handle direct messages
        if (chatType !== "direct") {
          log.debug(`Ignoring ${chatType} message`);
          return;
        }

        // Check allowlist
        if (config.allowList && config.allowList.length > 0) {
          const userId = ctx.from?.id.toString();
          if (!userId || !config.allowList.includes(userId)) {
            log.warn(`User ${userId} not in allowlist`);
            return;
          }
        }

        // At this point, chatType is "direct" (we returned early for group)
        const msgCtx: MsgContext = {
          from: ctx.from?.id.toString() ?? "",
          senderName: ctx.from?.first_name ?? "Unknown",
          senderUsername: ctx.from?.username,
          body: ctx.message.text,
          messageId: ctx.message.message_id.toString(),
          replyToId: ctx.message.reply_to_message?.message_id.toString(),
          channel: "telegram",
          chatType,
          groupId: undefined, // MVP: only direct messages, no group support
          timestamp: ctx.message.date * 1000,
        };

        try {
          await messageHandler(msgCtx);
        } catch (err) {
          log.error("Error handling message", err);
        }
      });

      await bot.start();
      log.info("Telegram bot started");
    },

    async stop() {
      log.info("Stopping Telegram bot...");
      await bot.stop();
      log.info("Telegram bot stopped");
    },

    onMessage(handler: MessageHandler) {
      messageHandler = handler;
    },

    async send(target: string, message: OutboundMessage) {
      const chatId = parseInt(target, 10);
      await bot.api.sendMessage(chatId, message.text, {
        parse_mode: "Markdown",
        reply_to_message_id: message.replyToId
          ? parseInt(message.replyToId, 10)
          : undefined,
      });
    },
  };
}
