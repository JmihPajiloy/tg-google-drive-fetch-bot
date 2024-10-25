import type { BotContext } from "./main";

export function getAuthor(ctx: BotContext) {
  const author = ctx.from;
  if (!author) throw new Error("Unable to get access to message author!");
  return author;
}

const SPECIAL_CHARS = ["\\", "_", "*", "[", "]", "(", ")", "~", "`", ">", "<", "&", "#", "+", "-", "=", "|", "{", "}", ".", "!"];

export const escapeMarkdown = (text: string) => {
  SPECIAL_CHARS.forEach(char => (text = text.replaceAll(char, `\\${char}`)));
  return text;
};
