require("dotenv").config();

const aiProvider = (process.env.AI_PROVIDER || "openai").toLowerCase();
const providerSettings = {
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/free"
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: undefined,
    defaultModel: process.env.OPENAI_MODEL || "gpt-4o-mini"
  }
};

if (!process.env.BOT_TOKEN) {
  console.error("Missing required environment variable: BOT_TOKEN");
  process.exit(1);
}
if (!providerSettings[aiProvider]) {
  console.error(`Unsupported AI_PROVIDER: ${aiProvider}. Use "openrouter" or "openai".`);
  process.exit(1);
}
if (!providerSettings[aiProvider].apiKey) {
  const keyName = aiProvider === "openrouter" ? "OPENROUTER_API_KEY" : "OPENAI_API_KEY";
  console.error(`Missing required environment variable for ${aiProvider}: ${keyName}`);
  process.exit(1);
}

const selected = providerSettings[aiProvider];

module.exports = {
  botToken: process.env.BOT_TOKEN,
  aiProvider,
  aiApiKey: selected.apiKey,
  aiBaseURL: selected.baseURL,
  model: process.env.AI_MODEL || selected.defaultModel,
  tavilyKey: process.env.TAVILY_API_KEY || "",
  maxFileBytes: (Number(process.env.MAX_FILE_MB) || 15) * 1024 * 1024
};
