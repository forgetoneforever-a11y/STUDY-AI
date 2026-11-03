require("dotenv").config();

const required = ["BOT_TOKEN", "OPENAI_API_KEY"];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

module.exports = {
  botToken: process.env.BOT_TOKEN,
  openaiKey: process.env.OPENAI_API_KEY,
  model: process.env.OPENAI_MODEL || "gpt-4o-mini",
  tavilyKey: process.env.TAVILY_API_KEY || "",
  maxFileBytes: (Number(process.env.MAX_FILE_MB) || 15) * 1024 * 1024
};
