const { Telegraf, Markup } = require("telegraf");
const http = require("node:http");
const { botToken, maxFileBytes } = require("./config");
const { createTextAnswer, analyzeImage } = require("./ai");
const { searchWeb } = require("./search");
const { extractDocument } = require("./documents");

const bot = new Telegraf(botToken);
const waitingForSearch = new Set();
const waitingForExplain = new Set();
const keyboard = Markup.keyboard([
  ["📝 Сделать конспект", "🌐 Поиск по теме"],
  ["💡 Объяснить тему", "❔ Помощь"]
]).resize();

async function sendLong(ctx, value) {
  const limit = 3900;
  for (let i = 0; i < value.length; i += limit) {
    await ctx.reply(value.slice(i, i + limit), { disable_web_page_preview: true });
  }
}
async function withBusy(ctx, task) {
  const status = await ctx.reply("⏳ STUDY AI анализирует материал…");
  try {
    const result = await task();
    await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
    await sendLong(ctx, result);
  } catch (error) {
    console.error(error);
    await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
    await ctx.reply("Не удалось обработать материал. Проверь формат файла и настройки сервера.");
  }
}
async function sendHelp(ctx) {
  return ctx.reply(
    "Как пользоваться STUDY AI:\n\n• Отправь фото страницы.\n• Прикрепи PDF, DOCX или TXT.\n• Напиши тему обычным сообщением.\n• Выбери поиск, чтобы найти дополнительные материалы.\n\nКоманды: /start, /summary, /search, /explain, /help",
    keyboard
  );
}

bot.start(ctx => ctx.reply(
  "Привет! Я STUDY AI — помогу разобрать учебный материал и сделать краткий конспект.\n\nОтправь фотографию, PDF, DOCX или текст. Я выделю главное и при необходимости найду дополнительные источники.",
  keyboard
));
bot.help(sendHelp);
bot.command("summary", ctx => ctx.reply("Пришли фотографию, документ или текст — подготовлю краткий конспект."));
bot.command("search", ctx => {
  waitingForSearch.add(ctx.from.id);
  return ctx.reply("Напиши тему, по которой нужно найти материалы.");
});
bot.command("explain", ctx => {
  waitingForExplain.add(ctx.from.id);
  return ctx.reply("Напиши тему или термин, который нужно объяснить простыми словами.");
});
bot.hears("📝 Сделать конспект", ctx => ctx.reply("Пришли фотографию, документ или текст."));
bot.hears("🌐 Поиск по теме", ctx => {
  waitingForSearch.add(ctx.from.id);
  return ctx.reply("Напиши тему для поиска в интернете.");
});
bot.hears("💡 Объяснить тему", ctx => {
  waitingForExplain.add(ctx.from.id);
  return ctx.reply("Напиши тему или термин.");
});
bot.hears("❔ Помощь", sendHelp);

bot.on("photo", ctx => {
  const photo = ctx.message.photo.at(-1);
  return withBusy(ctx, async () => {
    const fileUrl = await ctx.telegram.getFileLink(photo.file_id);
    const response = await fetch(fileUrl.href || fileUrl);
    if (!response.ok) throw new Error("Telegram file download failed");
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxFileBytes) throw new Error("File too large");
    return analyzeImage(buffer, "image/jpeg");
  });
});

bot.on("document", ctx => {
  const doc = ctx.message.document;
  if (doc.file_size && doc.file_size > maxFileBytes) {
    return ctx.reply("Файл слишком большой. Максимальный размер задаётся настройкой MAX_FILE_MB.");
  }
  return withBusy(ctx, async () => {
    const fileUrl = await ctx.telegram.getFileLink(doc.file_id);
    const response = await fetch(fileUrl.href || fileUrl);
    if (!response.ok) throw new Error("Telegram file download failed");
    const buffer = Buffer.from(await response.arrayBuffer());
    const content = await extractDocument(buffer, doc.file_name || "");
    if (!content.trim()) return "Текст не найден. Если PDF состоит из сканов, отправь страницы фотографиями.";
    return createTextAnswer(content);
  });
});

bot.on("text", ctx => {
  const userId = ctx.from.id;
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;
  if (waitingForSearch.has(userId)) {
    waitingForSearch.delete(userId);
    return withBusy(ctx, async () => {
      const sources = await searchWeb(text);
      if (!sources.length) return "Интернет-поиск не настроен. Добавь TAVILY_API_KEY в переменные окружения.";
      return createTextAnswer(`Подготовь краткий конспект по теме: ${text}`, sources);
    });
  }
  if (waitingForExplain.has(userId)) {
    waitingForExplain.delete(userId);
    return withBusy(ctx, () => createTextAnswer(`Объясни простыми словами тему: ${text}. Добавь короткий пример.`));
  }
  return withBusy(ctx, () => createTextAnswer(text));
});

bot.catch((error, ctx) => {
  console.error("Telegram bot error", error);
  ctx.reply("Произошла ошибка. Попробуй ещё раз.").catch(() => {});
});

const port = Number(process.env.PORT) || 3000;
const server = http.createServer((req, res) => {
  if (req.url !== "/health" && req.url !== "/") {
    res.writeHead(404);
    return res.end("Not found");
  }
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ status: "ok", app: "STUDY AI" }));
});
server.listen(port, () => console.log(`Health server listening on ${port}`));
bot.launch().then(() => console.log("STUDY AI Telegram bot is running"));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
