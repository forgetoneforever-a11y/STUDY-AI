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

async function createTextAnswer(text, sources = []) {
  const sourceBlock = sources.length
    ? "\n\nДополнительные материалы из интернета:\n" +
      sources.map((s, i) => `${i + 1}. ${s.title}\n${s.content}\nURL: ${s.url}`).join("\n\n")
    : "";
  const answer = await requestCompletion([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Материал пользователя:\n${text}${sourceBlock}\n\nСделай краткий и понятный конспект. Если источники добавлены, укажи их в конце.` }
  ]);
  return answer || "Не удалось подготовить конспект.";
}

async function analyzeImage(buffer, mimeType) {
  const base64 = buffer.toString("base64");
  const answer = await requestCompletion([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: [
      { type: "text", text: "Распознай текст и содержание изображения. Сохрани заголовки, определения и формулы. Затем сделай краткий конспект." },
      { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}`, detail: "high" } }
    ]}
  ]);
  return answer || "Не удалось распознать изображение.";
}

module.exports = { createTextAnswer, analyzeImage };
