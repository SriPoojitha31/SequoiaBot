// prompts.js
const OpenAI = require("openai");
require("dotenv").config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

async function getDiscussionPrompt() {
  const prompt = `
    Suggest a single, short, engaging discussion question for a Telegram community group
    to spark conversations. Keep it fun or thoughtful. Example topics: tech, life, goals, productivity.
  `;

  const response = await openai.chat.completions.create({
    messages: [{ role: "user", content: prompt }],
    model: "gpt-3.5-turbo",
    temperature: 0.7,
    max_tokens: 60
  });

  return response.choices[0].message.content.trim();
}

module.exports = { getDiscussionPrompt };
