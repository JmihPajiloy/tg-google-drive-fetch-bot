import { PrismaClient } from "@prisma/client";
import type { ForumTopic } from "../api/drive/drive-stream";

export const prisma = new PrismaClient();

export async function getAll() {
  return prisma.driveStreamRecord.findMany();
}

export async function upsert({ chat, topic }: ForumTopic, source: string) {
  return prisma.driveStreamRecord.upsert({
    create: {
      chat: chat.toString(),
      topic: topic.toString(),
      source: source,
      updatedAt: new Date(),
    },
    update: {
      updatedAt: new Date(),
    }, where: {
      stream: {
        chat: chat.toString(),
        topic: topic.toString(),
      },
    },
  });
}
