const { Telegraf, Markup } = require("telegraf");
const express = require("express");
const multer = require("multer");
const crypto = require("node:crypto");
const path = require("node:path");
const { botToken, maxFileBytes } = require("./config");
const { createTextAnswer, createSolution, analyzeImage } = require("./ai");
const { searchWeb } = require("./search");
const { extractDocument } = require("./documents");
const { findTopicImages } = require("./images");

const bot = new Telegraf(botToken);
const waitingForSearch = new Set();
const waitingForExplain = new Set();
const waitingForSolve = new Set();
const groupSettings = new Map();
const isGroup = ctx => ["group", "supergroup"].includes(ctx.chat.type);
const groupEnabled = ctx => groupSettings.get(ctx.chat.id) !== false;
const requestKey = ctx => `${ctx.chat.id}:${ctx.from.id}`;

async function isGroupAdmin(ctx) {
  if (!isGroup(ctx)) return true;
  const member = await ctx.telegram.getChatMember(ctx.chat.id, ctx.from.id);
  return ["creator", "administrator"].includes(member.status);
}

const webAppUrl = (process.env.WEBAPP_URL || "").trim();
const keyboard = Markup.keyboard([
  ...(webAppUrl ? [[Markup.button.webApp("📚 Открыть STUDY AI", webAppUrl)]] : []),
  ["📝 Сделать конспект", "🌐 Поиск по теме"],
  ["💡 Объяснить тему", "🧮 Решить задачу"],
  ["⚙️ Настройки чата"], ["❔ Помощь"]
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
  for (let i = 0; i < value.length; i += limit) await ctx.reply(value.slice(i, i + limit), { disable_web_page_preview: true });
}
async function withBusy(ctx, task, imageTopic = "") {
  const status = await ctx.reply("⏳ STUDY AI анализирует материал…");
  try {
    const result = await task();
    await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
    const answer = typeof result === "string" ? result : String(result?.text || "Не удалось подготовить ответ.");
    await sendLong(ctx, answer);
    if (imageTopic) {
      try {
        const images = await findTopicImages(imageTopic, 2);
        for (const image of images) {
          const caption = [image.title, image.license ? `Лицензия: ${image.license}` : "", image.pageUrl].filter(Boolean).join("\\n").slice(0, 900);
          await ctx.replyWithPhoto({ url: image.url }, { caption });
        }
      } catch (imageError) { console.warn("Topic image search failed:", imageError.message); }
    }
  } catch (error) {
    console.error(error);
    await ctx.telegram.deleteMessage(ctx.chat.id, status.message_id).catch(() => {});
    await ctx.reply("Не удалось обработать материал. Проверь формат файла и настройки сервера.");
  }
}
async function sendHelp(ctx) {
  return ctx.reply("Как пользоваться STUDY AI:\n\n• Открой веб-приложение кнопкой ниже.\n• Отправь фото, документ или текст — подготовлю конспект.\n• Команды: /summary, /search, /explain, /solve.\n\nВ группе для обработки всех сообщений отключи Privacy Mode через @BotFather.", keyboard);
}
bot.start(async ctx => {
  if (webAppUrl && ctx.chat.type === "private") {
    try {
      await ctx.telegram.setChatMenuButton(ctx.chat.id, {
        type: "web_app",
        text: "Открыть",
        web_app: { url: webAppUrl }
      });
      console.log("Private chat Web App menu button registered:", ctx.chat.id);
    } catch (error) {
      console.error("Could not set private chat menu button:", error.message);
    }
  }
  return ctx.reply(
    "Привет! Я STUDY AI — твой учебный помощник.\n\nНажми «Открыть» слева от поля сообщения, чтобы запускать приложение в любой момент.",
    webAppUrl ? Markup.inlineKeyboard([[Markup.button.webApp("📚 Открыть STUDY AI", webAppUrl)]]) : keyboard
  );
});
bot.help(sendHelp);
bot.command("settings", async ctx => {
  if (!isGroup(ctx)) return ctx.reply("Настройки группы доступны непосредственно в групповом чате.");
  const admin = await isGroupAdmin(ctx).catch(() => false);
  return ctx.reply("⚙️ Настройки этой группы\n\n" + `Статус: ${groupEnabled(ctx) ? "ответы включены" : "ответы выключены"}\n` +
    (admin ? "Администратор может включить или выключить ответы командами /group_on и /group_off.\n" : "Изменять режим могут только администраторы.\n") +
    "Для получения всех обычных сообщений отключи Privacy Mode: @BotFather → /setprivacy → Disable. Затем добавь бота в группу снова.", keyboard);
});
async function setGroupMode(ctx, enabled) {
  if (!isGroup(ctx)) return ctx.reply("Эта команда работает только в группе.");
  if (!(await isGroupAdmin(ctx).catch(() => false))) return ctx.reply("Менять настройки группы могут только администраторы.");
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
  const topic = commandArgument(ctx), key = requestKey(ctx);
  waitingForSearch.delete(key); waitingForExplain.delete(key);
  if (topic) return withBusy(ctx, () => createTextAnswer(topic), topic);
  return ctx.reply("Пришли фотографию, документ или текст — подготовлю краткий конспект.");
});
bot.command("search", ctx => {
  const topic = commandArgument(ctx), key = requestKey(ctx);
  if (!topic) { waitingForSearch.add(key); return ctx.reply("Напиши тему, по которой нужно найти материалы."); }
  return withBusy(ctx, async () => {
    const sources = await searchWeb(topic);
    if (!sources.length) return "Не удалось найти материалы. Проверь настройку TAVILY_API_KEY.";
    return createTextAnswer(`Подготовь краткий конспект по теме: ${topic}`, sources);
  });
});
bot.command("explain", ctx => {
  const topic = commandArgument(ctx), key = requestKey(ctx);
  if (!topic) { waitingForExplain.add(key); return ctx.reply("Напиши тему или термин, который нужно объяснить простыми словами."); }
  waitingForExplain.delete(key); waitingForSearch.delete(key);
  return withBusy(ctx, () => createTextAnswer(`Объясни простыми словами тему: ${topic}. Добавь короткий пример.`), topic);
});
bot.command("solve", ctx => {
  const problem = commandArgument(ctx), key = requestKey(ctx);
  waitingForSearch.delete(key); waitingForExplain.delete(key);
  if (!problem) { waitingForSolve.add(key); return ctx.reply("Пришли условие задачи текстом, фотографией или документом."); }
  waitingForSolve.delete(key);
  return withBusy(ctx, () => createSolution(problem));
});
bot.hears("📝 Сделать конспект", ctx => ctx.reply("Пришли фотографию, документ или текст."));
bot.hears("🌐 Поиск по теме", ctx => { waitingForSearch.add(requestKey(ctx)); return ctx.reply("Напиши тему для поиска в интернете."); });
bot.hears("💡 Объяснить тему", ctx => { waitingForExplain.add(requestKey(ctx)); return ctx.reply("Напиши тему или термин."); });
bot.hears("🧮 Решить задачу", ctx => { waitingForSolve.add(requestKey(ctx)); return ctx.reply("Пришли условие задачи текстом, фотографией или документом."); });
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
    const buffer = await downloadTelegramFile(ctx, photo.file_id), key = requestKey(ctx);
    if (waitingForSolve.has(key)) { waitingForSolve.delete(key); return analyzeImage(buffer, "image/jpeg", "Реши задачу с фотографии. Распознай условие, покажи данные, формулу, подстановку и ответ. Не угадывай неразборчивые числа."); }
    return analyzeImage(buffer, "image/jpeg");
  });
});
bot.on("document", ctx => {
  if (isGroup(ctx) && !groupEnabled(ctx)) return;
  const doc = ctx.message.document;
  if (doc.file_size && doc.file_size > maxFileBytes) return ctx.reply("Файл слишком большой. Максимальный размер задаётся MAX_FILE_MB.");
  return withBusy(ctx, async () => {
    const buffer = await downloadTelegramFile(ctx, doc.file_id), extracted = await extractDocument(buffer, doc.file_name || "");
    if (!extracted.trim()) return "Текст не найден. Если PDF состоит из сканов, отправь страницы фотографиями.";
    const key = requestKey(ctx);
    if (waitingForSolve.has(key)) { waitingForSolve.delete(key); return createSolution(extracted); }
    return createTextAnswer(extracted);
  });
});
bot.on("text", ctx => {
  if (isGroup(ctx) && !groupEnabled(ctx)) return;
  const key = requestKey(ctx);
  let text = ctx.message.text.trim();
  if (text.startsWith("/")) return;
  if (isGroup(ctx) && bot.botInfo?.username) {
    text = text.replace(new RegExp(`@${bot.botInfo.username}\\b`, "ig"), "").trim();
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
  if (waitingForExplain.has(key)) { waitingForExplain.delete(key); return withBusy(ctx, () => createTextAnswer(`Объясни простыми словами тему: ${text}. Добавь короткий пример.`), text); }
  if (waitingForSolve.has(key)) { waitingForSolve.delete(key); return withBusy(ctx, () => createSolution(text)); }
  if (text) return withBusy(ctx, () => createTextAnswer(text), text);
});
bot.catch((error, ctx) => {
  console.error("Telegram bot error", error);
  ctx.reply("Произошла ошибка. Попробуй ещё раз.").catch(() => {});
});

// Telegram Mini App backend. All AI keys stay on the server.
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxFileBytes } });

function verifyTelegramInitData(initData) {
  if (!initData || typeof initData !== "string") return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const authDate = Number(params.get("auth_date"));
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 86400) return null;
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const a = Buffer.from(expected, "hex"), b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(params.get("user") || "null"); } catch { return null; }
}
function requireTelegramUser(req, res, next) {
  const user = verifyTelegramInitData(req.get("x-telegram-init-data") || req.body?.initData);
  if (!user?.id) return res.status(401).json({ error: "Открой STUDY AI через Telegram, чтобы подтвердить вход." });
  req.telegramUser = user;
  next();
}
app.get("/health", (req, res) => res.json({ status: "ok", app: "STUDY AI" }));
app.get("/api/config", (req, res) => res.json({ app: "STUDY AI", webAppEnabled: Boolean(webAppUrl) }));
app.post("/api/ask", requireTelegramUser, async (req, res) => {
  try {
    const question = String(req.body?.question || "").trim();
    if (!question || question.length > 12000) return res.status(400).json({ error: "Напиши вопрос (до 12 000 символов)." });
    const mode = String(req.body?.mode || "ask");
    let answer;
    if (mode === "solve") answer = await createSolution(question);
    else if (mode === "explain") answer = await createTextAnswer(`Объясни простыми словами: ${question}. Добавь короткий пример.`);
    else if (mode === "summary") answer = await createTextAnswer(`Сделай краткий конспект по материалу: ${question}`);
    else if (mode === "search") {
      const sources = await searchWeb(question);
      if (!sources.length) return res.status(503).json({ error: "Поиск не настроен. Добавь TAVILY_API_KEY на сервере." });
      answer = await createTextAnswer(`Подготовь краткий ответ по теме: ${question}`, sources);
    } else answer = await createTextAnswer(question);
    const images = ["solve"].includes(mode) ? [] : await findTopicImages(question, 2).catch(error => { console.warn("Topic image search failed:", error.message); return []; });
    res.json({ answer, images });
  } catch (error) {
    console.error("Mini App AI error:", error);
    res.status(500).json({ error: "Не удалось получить ответ. Попробуй ещё раз." });
  }
});
app.post("/api/upload", requireTelegramUser, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Выбери файл." });
    const name = req.file.originalname || "upload.txt";
    const ext = name.toLowerCase().split(".").pop();
    let answer;
    if (["png", "jpg", "jpeg", "webp"].includes(ext)) answer = await analyzeImage(req.file.buffer, req.file.mimetype || "image/jpeg");
    else {
      const content = await extractDocument(req.file.buffer, name);
      if (!content.trim()) return res.status(422).json({ error: "В документе не найден текст. Сканированные PDF отправляй как изображения страниц." });
      answer = await createTextAnswer(content);
      const images = await findTopicImages(content.slice(0, 500), 2).catch(error => { console.warn("Topic image search failed:", error.message); return []; });
      return res.json({ answer, images });
    }
    res.json({ answer });
  } catch (error) {
    console.error("Mini App upload error:", error);
    res.status(400).json({ error: "Не удалось обработать файл. Поддерживаются изображения, PDF, DOCX, TXT и MD." });
  }
});
const webhookSecret = crypto.createHmac("sha256", botToken).update("STUDY-AI-telegram-webhook").digest("hex");
app.use(bot.webhookCallback("/telegram/webhook", { secretToken: webhookSecret }));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "..", "public", "index.html")));
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`STUDY AI web server listening on ${port}`));

async function registerCommands() {
  await bot.telegram.setMyCommands(commandList, { scope: { type: "default" }, language_code: "ru" });
  await bot.telegram.setMyCommands(commandList, { scope: { type: "all_private_chats" }, language_code: "ru" });
  await bot.telegram.setMyCommands(commandList, { scope: { type: "all_group_chats" }, language_code: "ru" });
  if (webAppUrl) {
    try {
      await bot.telegram.setChatMenuButton(undefined, {
        type: "web_app",
        text: "Открыть",
        web_app: { url: webAppUrl }
      });
      console.log("Telegram App menu button registered");
    } catch (error) {
      console.error("Could not register Telegram App menu button:", error.message);
    }
  }
  console.log("Telegram command menu registered");
}
async function startTelegram() {
  const publicUrl = (process.env.TELEGRAM_WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/+$/, "");
  if (publicUrl) {
    const webhookUrl = `${publicUrl}/telegram/webhook`;
    await bot.telegram.setWebhook(webhookUrl, {
      secret_token: webhookSecret,
      allowed_updates: ["message", "callback_query"]
    });
    console.log("STUDY AI Telegram webhook registered:", webhookUrl);
    await registerCommands();
    return;
  }

  await bot.launch();
  console.log("STUDY AI Telegram bot is running in polling mode");
  await registerCommands();
}
startTelegram().catch(error => console.error("Telegram startup failed:", error));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
