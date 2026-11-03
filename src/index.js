const { Telegraf, Markup } = require("telegraf");
const http = require("node:http");
const { botToken, maxFileBytes } = require("./config");
const { createTextAnswer, createSolution, analyzeImage } = require("./ai");
const { searchWeb } = require("./search");
const { extractDocument } = require("./documents");

const bot = new Telegraf(botToken);
const waitingForSearch = new Set();
const waitingForExplain = new Set();
const waitingForSolve = new Set();
// Group settings are in memory and reset when the service restarts.
const groupSettings = new Map();
const isGroup = ctx => ["group", "supergroup"].includes(ctx.chat.type);
const groupEnabled = ctx => groupSettings.get(ctx.chat.id) !== false;
const requestKey = ctx => `${ctx.chat.id}:${ctx.from.id}`;

async function isGroupAdmin(ctx) {
  if (!isGroup(ctx)) return true;
  const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
  return ["creator", "administrator"].includes(member.status);
}

const keyboard = Markup.keyboard([
  ["📝 Сделать конспект", "🌐 Поиск по теме"],
  ["💡 Объяснить тему", "🧮 Решить задачу"],
  ["⚙️ Настройки чата"],
  ["❔ Помощь"]
]).resize();

const commandList = [
  { command: "start", description: "Запустить STUDY AI" },
  { command: "summary", description: "Сделать краткий конспект" },
  { command: "search", description: "Найти материалы по теме" },
  { command: "explain", description: "Объяснить тему простыми словами" },
  { command: "solve", description: "Пошагово решить учебную задачу" },
  { command: "settings", description: "Настройки работы в чате" },
  { command: "group_on", description: "Включить ответы в группе (админ)" },
  { command: "group_off", description: "Выключить ответы в группе (админ)" },
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
    await sendLong(ctx, String(result || "Не удалось подготовить ответ."));
  } catch (error) {
    console.error(error);
    await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
    await ctx.reply("Не удалось обработать материал. Проверь формат файла и настройки сервера.");
  }
}

async function sendHelp(ctx) {
  return ctx.reply(
    "Как пользоваться STUDY AI:\n\n• Отправь фото страницы или документ.\n• Напиши вопрос — отвечу.\n• Используй /summary, /search или /explain.\n\n" +
    "В группе можно обращаться через @username или отвечать на сообщение бота. Для обработки всех сообщений администратор должен отключить Privacy Mode через @BotFather.",
    keyboard
  );
}

bot.start(ctx => ctx.reply(
  "Привет! Я STUDY AI — помогу разобрать учебный материал и сделать краткий конспект.\n\nОтправь фотографию, PDF, DOCX или текст.",
  keyboard
));
bot.help(sendHelp);

bot.command("settings", async ctx => {
  if (!isGroup(ctx)) return ctx.reply("Настройки группы доступны непосредственно в групповом чате.");
  const admin = await isGroupAdmin(ctx).catch(() => false);
  return ctx.reply(
    "⚙️ Настройки этой группы\n\n" +
    `Статус: ${groupEnabled(ctx) ? "ответы включены" : "ответы выключены"}\n` +
    (admin ? "Администратор может включить или выключить ответы командами /group_on и /group_off.\n" : "Изменять режим могут только администраторы.\n") +
    "Для получения всех обычных сообщений отключи Privacy Mode: @BotFather → /setprivacy → выбери бота → Disable. Затем удали бота из группы и добавь снова. Учитывай согласие участников."
  );
});

async function setGroupMode(ctx, enabled) {
  if (!isGroup(ctx)) return ctx.reply("Эта команда работает только в группе.");
  if (!(await isGroupAdmin(ctx).catch(() => false))) {
    return ctx.reply("Менять настройки группы могут только администраторы.");
  }
  groupSettings.set(ctx.chat.id, enabled);
  return ctx.reply(enabled ? "✅ STUDY AI включён в этой группе." : "⏸ STUDY AI выключен в этой группе.");
}
bot.command("group_on", ctx => setGroupMode(ctx, true));
bot.command("group_off", ctx => setGroupMode(ctx, false));

function commandArgument(ctx) {
  const raw = ctx.message.text.trim();
  const firstSpace = raw.indexOf(" ");
  return firstSpace === -1 ? "" : raw.slice(firstSpace + 1).trim();
}

bot.command("summary", ctx => {
  const topic = commandArgument(ctx);
  const key = requestKey(ctx);
  waitingForSearch.delete(key);
  waitingForExplain.delete(key);
  if (topic) return withBusy(ctx, () => createTextAnswer(topic));
  return ctx.reply("Пришли фотографию, документ или текст — подготовлю краткий конспект.");
});

bot.command("search", ctx => {
  const topic = commandArgument(ctx);
  const key = requestKey(ctx);
  if (!topic) {
    waitingForSearch.add(key);
    return ctx.reply("Напиши тему, по которой нужно найти материалы.");
  }
  return withBusy(ctx, async () => {
    const sources = await searchWeb(topic);
    if (!sources.length) return "Не удалось найти материалы. Проверь настройку TAVILY_API_KEY.";
    return createTextAnswer(`Подготовь краткий конспект по теме: ${topic}`, sources);
  });
});

bot.command("explain", ctx => {
  const topic = commandArgument(ctx);
  const key = requestKey(ctx);
  if (!topic) {
    waitingForExplain.add(key);
    return ctx.reply("Напиши тему или термин, который нужно объяснить простыми словами.");
  }
  waitingForExplain.delete(key);
  waitingForSearch.delete(key);
  return withBusy(ctx, () => createTextAnswer(`Объясни простыми словами тему: ${topic}. Добавь короткий пример.`));
});

bot.command("solve", ctx => {
  const problem = commandArgument(ctx);
  const key = requestKey(ctx);
  waitingForSearch.delete(key);
  waitingForExplain.delete(key);
  if (!problem) {
    waitingForSolve.add(key);
    return ctx.reply("Пришли условие задачи текстом, фотографией или документом. Я покажу решение по шагам.");
  }
  waitingForSolve.delete(key);
  return withBusy(ctx, () => createSolution(problem));
});

bot.hears("📝 Сделать конспект", ctx => ctx.reply("Пришли фотографию, документ или текст."));
bot.hears("🌐 Поиск по теме", ctx => {
  waitingForSearch.add(requestKey(ctx));
  return ctx.reply("Напиши тему для поиска в интернете.");
});
bot.hears("💡 Объяснить тему", ctx => {
  waitingForExplain.add(requestKey(ctx));
  return ctx.reply("Напиши тему или термин.");
});
bot.hears("🧮 Решить задачу", ctx => {
  waitingForSolve.add(requestKey(ctx));
  return ctx.reply("Пришли условие задачи текстом, фотографией или документом.");
});
bot.hears("⚙️ Настройки чата", ctx => ctx.reply("В группе используй /settings. Администраторы могут использовать /group_on и /group_off."));
bot.hears("❔ Помощь", sendHelp);

async function downloadTelegramFile(ctx, fileId) {
  const fileUrl = await ctx.telegram.getFileLink(fileId);
  const response = await fetch(fileUrl.href || fileUrl);
  if (!response.ok) throw new Error("Telegram file download failed");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxFileBytes) throw new Error("File too large");
  return buffer;
}

bot.on("photo", ctx => {
  if (isGroup(ctx) && !groupEnabled(ctx)) return;
  const photo = ctx.message.photo.at(-1);
  return withBusy(ctx, async () => {
    const buffer = await downloadTelegramFile(ctx, photo.file_id);
    const key = requestKey(ctx);
    if (waitingForSolve.has(key)) {
      waitingForSolve.delete(key);
      return analyzeImage(buffer, "image/jpeg", "Реши задачу с фотографии. Сначала точно распознай условие и все данные. Затем покажи решение по шагам: дано, найти, формула, подстановка, вычисления, ответ. Если текст или числа неразборчивы, укажи это и не угадывай.");
    }
    return analyzeImage(buffer, "image/jpeg");
  });
});

bot.on("document", ctx => {
  if (isGroup(ctx) && !groupEnabled(ctx)) return;
  const doc = ctx.message.document;
  if (doc.file_size && doc.file_size > maxFileBytes) {
    return ctx.reply("Файл слишком большой. Максимальный размер задаётся настройкой MAX_FILE_MB.");
  }
  return withBusy(ctx, async () => {
    const buffer = await downloadTelegramFile(ctx, doc.file_id);
    const extracted = await extractDocument(buffer, doc.file_name || "");
    if (!extracted.trim()) return "Текст не найден. Если PDF состоит из сканов, отправь страницы фотографиями.";
    const key = requestKey(ctx);
    if (waitingForSolve.has(key)) {
      waitingForSolve.delete(key);
      return createSolution(extracted);
    }
    return createTextAnswer(extracted);
  });
});

bot.on("text", ctx => {
  if (isGroup(ctx) && !groupEnabled(ctx)) return;
  const key = requestKey(ctx);
  let text = ctx.message.text.trim();
  if (text.startsWith("/")) return;

  // In groups, process messages delivered by Telegram. With Privacy Mode enabled,
  // Telegram normally delivers commands, mentions and replies to the bot only.
  if (isGroup(ctx) && bot.botInfo?.username) {
    const mention = new RegExp(`@${bot.botInfo.username}\\b`, "ig");
    text = text.replace(mention, "").trim();
    if (!text && !ctx.message.reply_to_message) return;
  }

  if (waitingForSearch.has(key)) {
    waitingForSearch.delete(key);
    return withBusy(ctx, async () => {
      const sources = await searchWeb(text);
      if (!sources.length) return "Интернет-поиск не настроен. Добавь TAVILY_API_KEY в переменные окружения.";
      return createTextAnswer(`Подготовь краткий конспект по теме: ${text}`, sources);
    });
  }
  if (waitingForExplain.has(key)) {
    waitingForExplain.delete(key);
    return withBusy(ctx, () => createTextAnswer(`Объясни простыми словами тему: ${text}. Добавь короткий пример.`));
  }
  if (!text) return;
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
  await bot.telegram.setMyCommands(commandList, { scope: { type: "default" }, language_code: "ru" });
  await bot.telegram.setMyCommands(commandList, { scope: { type: "all_private_chats" }, language_code: "ru" });
  await bot.telegram.setMyCommands(commandList, { scope: { type: "all_group_chats" }, language_code: "ru" });
  console.log("Telegram command menu registered");
}

bot.launch().then(async () => {
  console.log("STUDY AI Telegram bot is running");
  try {
    await registerCommands();
  } catch (error) {
    console.error("Could not register Telegram command menu:", error.message);
  }
});
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
