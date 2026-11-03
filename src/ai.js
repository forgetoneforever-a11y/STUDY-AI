const OpenAI = require("openai");
const { aiProvider, aiApiKey, aiBaseURL, model } = require("./config");
const { SYSTEM_PROMPT } = require("./prompts");

const client = new OpenAI({
  apiKey: aiApiKey,
  ...(aiBaseURL ? { baseURL: aiBaseURL } : {}),
  ...(aiProvider === "openrouter"
    ? { defaultHeaders: { "X-Title": "STUDY AI Telegram Bot" } }
    : {})
});

async function requestCompletion(messages) {
  const response = await client.chat.completions.create({
    model,
    temperature: 0.2,
    messages
  });
  return response.choices?.[0]?.message?.content || "";
}

async function createSolution(problem) {
  const answer = await requestCompletion([
    { role: "system", content: SYSTEM_PROMPT + "\\n\\nРешай кратко. Формат: 📘 РЕШЕНИЕ; Дано; Найти; Формула; Решение (подстановка и вычисление в 1–3 шага); ✅ Ответ. Не добавляй длинные объяснения обозначений, аналогии и отдельную проверку размерности без необходимости. Не угадывай недостающие данные; если условие неполное, коротко уточни, чего не хватает." },
    { role: "user", content: `Реши задачу кратко, понятно и пошагово:\\n${problem}` }
  ]);
  return answer || "Не удалось решить задачу.";
}

async function createTextAnswer(text, sources = []) {
  const sourceBlock = sources.length
    ? "\n\nДополнительные материалы из интернета:\n" +
      sources.map((s, i) => `${i + 1}. ${s.title}\n${s.content}\nURL: ${s.url}`).join("\n\n")
    : "";
  const answer = await requestCompletion([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Материал пользователя:\n${text}${sourceBlock}\n\nСделай короткий конспект без длинных вступлений. Оставь только самое важное. Если источники добавлены, укажи ссылки в конце.` }
  ]);
  return answer || "Не удалось подготовить конспект.";
}

async function analyzeImage(buffer, mimeType, instruction = "Кратко распознай содержание изображения и сделай конспект: тема и самое важное.") {
  const base64 = buffer.toString("base64");
  const answer = await requestCompletion([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: [
      { type: "text", text: instruction },
      { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}`, detail: "high" } }
    ]}
  ]);
  return answer || "Не удалось распознать изображение.";
}

module.exports = { createTextAnswer, createSolution, analyzeImage };
