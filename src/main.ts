import { type Conversation, type ConversationFlavor, conversations, createConversation } from "@grammyjs/conversations";
import { type ChatMembersFlavor } from "@grammyjs/chat-members";

import { Bot, type Context, GrammyError, HttpError, session } from "grammy";
import { onlyAdmin } from "grammy-middlewares";
import type { ParseModeFlavor } from "@grammyjs/parse-mode";
import { hydrateReply } from "@grammyjs/parse-mode";
import { logger } from "./logger";
import type { DriveFile } from "./api/drive-file";
import axios from "axios";
import type { DriveObserver, ForumTopic } from "./api/drive-stream";
import { DRIVE_FOLDER_LINK_REGEX, DriveStream } from "./api/drive-stream";
import { getAll, upsert } from "../prisma/prisma";
import { escapeMarkdown, getAuthor } from "./utils";
import { Subject, tap } from "rxjs";

export type BotContext = Context & ConversationFlavor & ChatMembersFlavor & ParseModeFlavor<Context>;
export type BotConversation = Conversation<BotContext>;
export const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("Bot Token not found!");
}

export const API_KEY = process.env.API_TOKEN;
if (!API_KEY) {
  throw new Error("API Key not found!");
}

export const bot = new Bot<BotContext>(BOT_TOKEN);
bot.use(hydrateReply);
bot.use(session({ initial: () => ({}) }));
bot.use(conversations());
bot.use(onlyAdmin(ctx => ctx.reply("Ты не админ!!")));
bot.use(createConversation(sub));

export const updateDatabase = () => (forumTopic: ForumTopic, source: string) => async () => {
  await upsert(forumTopic, source);
};

export async function startFromDatabase() {
  const records = await getAll();
  logger.info(`Found ${records.length} active streams`);
  for (const record of records) {
    const { chat, source, topic, updatedAt } = record;
    const stream = DriveStream.getByID({ topic: Number(topic), chat: Number(chat) }, source, updatedAt);
    stream.subscribe(sendFile());
    stream.subscribe(updateDatabase());
  }
}

export const sendFile = () => ({ chat, topic }: ForumTopic) => async (file: DriveFile) => {
  const document = await file.download();
  logger.info(`Sending file "${document.filename}" to ${chat}:${topic}...`);
  await bot.api.sendDocument(chat, document, {
    caption: `*${escapeMarkdown(file.fullname)}*\n\n🔗 *[Открыть в браузере](${file.webview})*`,
    message_thread_id: topic,
    parse_mode: "MarkdownV2",
  });
  logger.info(`File "${document.filename}" successfully sent to ${chat}:${topic}`);
};

export async function sub(conversation: BotConversation, ctx: BotContext) {
  async function ask(err: string, callback?: (x: string) => boolean): Promise<string> {
    if (!callback) callback = x => !!x;
    while (true) {
      const author = getAuthor(ctx);
      const newCtx = await conversation.waitFrom(author);
      const text = newCtx.message?.text;
      if (text && callback(text)) {
        return text;
      }
      await ctx.reply(err);
    }
  }

  await ctx.reply("Введите ссылку на гугл-диск");
  const url = await ask("Некорректная ссылка! Попробуйте ещё раз", url => !!url.match(DRIVE_FOLDER_LINK_REGEX));

  await ctx.reply("Как будет называться топик?");
  const title = await ask("Не удалось прочитать заголовок топика. Попробуйте ещё раз");

  await ctx.reply("Создаю топик...");

  const chatID = ctx.chatId;
  if (!chatID) {
    throw new Error("Unable to get access to chatID");
  }

  const topic = await ctx.createForumTopic(title);
  const topicID = topic.message_thread_id;

  await bot.api.closeForumTopic(chatID, topicID);
  const msg = await bot.api.sendMessage(chatID, `*[${escapeMarkdown("Ссылка на гугл-диск")}](${url})*`, {
    message_thread_id: topicID,
    parse_mode: "MarkdownV2",
  });
  await bot.api.pinChatMessage(chatID, msg.message_id);
  await conversation.external(async () => {
    const stream = DriveStream.getByLink(url, { topic: topicID, chat: chatID });
    stream.subscribe(sendFile());
    stream.subscribe(updateDatabase());
  });

  await ctx.reply(`Топик ${title} успешно создан! Туда будут приходить все файлы`);
}

bot.command("sub", async (ctx: BotContext) => {
  await ctx.conversation.enter(sub.name);
});

bot.catch((err) => {
  const ctx = err.ctx;
  logger.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;
  if (e instanceof GrammyError) {
    logger.error("Error in request:", e.description);
  }
  else if (e instanceof HttpError) {
    logger.error("Could not contact Telegram:", e);
  }
  else {
    logger.error("Unknown error:", e);
  }
});

process.once("SIGINT", () => bot.stop());
process.once("SIGTERM", () => bot.stop());

void bot.start({
  onStart: async (info) => {
    await startFromDatabase();
    await bot.api.setMyCommands([
      { command: "sub", description: "Подписаться на обновления гугл-диска" },
    ]);
    logger.info(`${info.username} is running!`);
  },
});
