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
  ["💡 Объяснить тему", "⚙️ Настройки чата"],
  ["❔ Помощь"]
]).resize();

const commandList = [
  { command: "start", description: "Запустить STUDY AI" },
  { command: "summary", description: "Сделать краткий конспект" },
  { command: "search", description: "Найти материалы по теме" },
  { command: "explain", description: "Объяснить тему простыми словами" },
  { command: "settings", description: "Настройки работы в чате" },
  { command: "help", description: "Помощь и список команд" }
];

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
bot.command("settings", ctx => ctx.reply(
  "⚙️ Настройки STUDY AI в чатах\n\n" +
  "Личный чат: отправляй текст, фотографии и документы обычными сообщениями.\n\n" +
  "Групповой чат: по умолчанию я отвечаю на команды /summary, /search, /explain и на сообщения, отправленные ответом на моё сообщение. Так я не засоряю общий чат.\n\n" +
  "Чтобы я видел все обычные сообщения группы, администратор может отключить Privacy Mode через @BotFather → /setprivacy → выбрать бота → Disable. После этого меня нужно удалить из группы и добавить снова. Используй этот режим только если участники согласны."
));
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
bot.hears("⚙️ Настройки чата", ctx => ctx.reply(
  "⚙️ Настройки чата\n\nВ личном чате можно отправлять материалы напрямую. В группах я отвечаю на команды и на сообщения-ответы мне.\n\nКоманды: /summary, /search, /explain, /help."
));
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

  // In groups, do not process every message by default. Handle only replies to the bot.
  if (ctx.chat.type !== "private") {
    const reply = ctx.message.reply_to_message;
    if (!reply || reply.from?.id !== bot.botInfo?.id) return;
  }
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
async function registerCommands() {
  await bot.telegram.setMyCommands(commandList, {
    scope: { type: "default" },
    language_code: "ru"
  });
  await bot.telegram.setMyCommands(commandList, {
    scope: { type: "all_private_chats" },
    language_code: "ru"
  });
  await bot.telegram.setMyCommands(commandList, {
    scope: { type: "all_group_chats" },
    language_code: "ru"
  });
  console.log("Telegram command menu registered");
}

bot.launch()
  .then(async () => {
    console.log("STUDY AI Telegram bot is running");
    try {
      await registerCommands();
    } catch (error) {
      console.error("Could not register Telegram command menu:", error.message);
    }
  });
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
