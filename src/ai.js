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
    { role: "system", content: SYSTEM_PROMPT + "\\n\\nТы также решаешь учебные задачи. Не угадывай отсутствующие данные. Если условие неполное или неоднозначное, сначала укажи, чего не хватает. Показывай ход решения по шагам, формулу, подстановку чисел с единицами измерения, вычисления и отдельный ответ. Проверяй арифметику и размерность. Для задач по математике, физике, механике и электротехнике объясняй обозначения простыми словами. Не подменяй решение одним ответом." },
    { role: "user", content: `Реши задачу и подробно, но понятно объясни ход решения:\\n${problem}` }
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
    { role: "user", content: `Материал пользователя:\n${text}${sourceBlock}\n\nСделай краткий и понятный конспект. Если источники добавлены, укажи их в конце.` }
  ]);
  return answer || "Не удалось подготовить конспект.";
}

async function analyzeImage(buffer, mimeType, instruction = "Распознай текст и содержание изображения. Сохрани заголовки, определения и формулы. Затем сделай краткий конспект.") {
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
