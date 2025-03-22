// Required Modules
require("dotenv").config();
const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const axios = require("axios");
const cron = require("node-cron");
const Sentiment = require("sentiment");
const sentiment = new Sentiment();

// Custom Modules
const { getDiscussionPrompt } = require("./prompts.js");
const { UserStats } = require("./models/UserStats.js");
const { getMotivationalQuote } = require("./motivation.js");
const SentimentModel = require("./models/Sentiment.js");
const User = require("./models/User.js");
const ChatLog = require("./models/ChatLog.js");
const Engagement = require('./models/Engagement.js');

// Env Variables
const {
  BOT_TOKEN: TOKEN,
  BOT_URL,
  MONGODB_URI,
  PORT = 10000,
  OPENROUTER_API_KEY,
  HUGGINGFACE_API_KEY,
} = process.env;

const URL = "https://sequoia-bot.onrender.com"; // Hosting URL

// Admin Config
const adminIds = [5559338907];
const MAX_REQUESTS_PER_MINUTE = 5;
const groupId = "-1002570334546";
const userStates = {};
const rateLimitMap = new Map();
const requestQueue = [];
let isProcessingRequests = false;

// Express App & Bot
const app = express();
app.use(express.json());

const bot = new TelegramBot(TOKEN, { polling: false });
bot.setWebHook(`${URL}/bot${TOKEN}`);

// MongoDB Connection
mongoose.connect(MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

// ===== AI API Handler =====
async function callAiApi(userMessage) {
  try {
    console.log("Calling OpenRouter...");
    const response = await axios.post(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        model: "openai/gpt-3.5-turbo",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: userMessage },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://your-site-url.com",
          "X-Title": "Telegram Bot",
        },
      }
    );

    return response.data.choices[0].message.content;
  } catch (err) {
    console.error("OpenRouter failed:", err.message);
    try {
      const fallback = await axios.post(
        "https://api-inference.huggingface.co/models/google/flan-t5-xxl",
        { inputs: userMessage },
        {
          headers: {
            Authorization: `Bearer ${HUGGINGFACE_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
      );
      return fallback.data[0]?.generated_text || "⚠️ No response from Hugging Face.";
    } catch (hfError) {
      console.error("Hugging Face failed too:", hfError.message);
      return "❌ Both AI services failed. Please try again later.";
    }
  }
}

// ===== Send Announcements =====
async function sendAnnouncement(announcementText) {
  const users = await User.find({}, "telegramId");
  let successCount = 0, failCount = 0;

  for (const user of users) {
    try {
      if (!user.telegramId) throw new Error();
      await bot.sendMessage(user.telegramId, `📢 *Announcement:*\n\n${announcementText}`, { parse_mode: "Markdown" });
      successCount++;
    } catch {
      failCount++;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  return { successCount, failCount };
}

async function processPendingRequests(bot, chatId, telegramId, userMessage) {
  // Placeholder logic – customize as needed!
  console.log(`Processing pending request from ${telegramId}: ${userMessage}`);

  // Optionally, respond to the user
  await bot.sendMessage(chatId, "Thanks! We'll process this soon.");
}
// ===== Cron Job: Trending Prompt =====
const trendingPrompts = [
  "What's your favorite productivity hack?",
  "Share your recent coding project!",
  "What's the best AI tool you've used recently?",
  "Any cool weekend plans?",
  "What’s one thing you learned this week?"
];

cron.schedule('0 10 * * *', async () => {
  try {
    const users = await User.find({}, 'telegramId');
    const prompt = trendingPrompts[Math.floor(Math.random() * trendingPrompts.length)];
    for (const user of users) {
      if (user.telegramId) {
        await bot.sendMessage(user.telegramId, `🔥 *Trending Prompt:*\n${prompt}`, { parse_mode: "Markdown" });
      }
    }
    console.log("✅ Trending prompt sent.");
  } catch (err) {
    console.error("❌ Error sending trending prompt:", err);
  }
});

// ===== /start Command =====
bot.onText(/\/start/, async (msg) => {
  const { id: chatId } = msg.chat;
  const telegramId = msg.from.id;
  const username = msg.from.username || "Unknown";
  const name = msg.from.first_name || "User";

  try {
    let user = await User.findOne({ telegramId });
    if (!user) {
      user = new User({ telegramId, username, name });
      await user.save();
      console.log("✅ New user registered:", username);
    }
    // 🔽 Fix: Make sure name has a value
    const welcomeMsg = `👋 Welcome, ${name || "there"}! You are now registered to use the bot.`;
    bot.sendMessage(chatId, welcomeMsg);
  } catch (error) {
    console.error("❌ Error during registration:", error.message);
    bot.sendMessage(chatId, "⚠️ Error registering user. Please try again later.");
  }
});


// ===== /help Command =====
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  const helpText = `
📋 *Available Commands:*

🤖 *General Commands:*
/start - Register and start using the bot
/help - Show this help message
/faq - View frequently asked questions
/id - Get your Telegram ID
/profile - View your profile
/leaderboard - See the leaderboard

🧠 *AI Assistant:*
/ask <question> - Ask the AI assistant

👮 *Admin Only:*
/announce <message> - Broadcast to all users
/users - List registered users

⚠️ Limit: ${MAX_REQUESTS_PER_MINUTE} questions per minute
`;
  bot.sendMessage(chatId, helpText, { parse_mode: "Markdown" });
});

// ===== /faq Command =====
const faqList = [
  { q: "How to register?", a: "Use the /start command." },
  { q: "How do I earn points?", a: "Use /ask frequently!" },
  { q: "What is this bot for?", a: "Engaging the community with AI." },
];

bot.onText(/\/faq/, (msg) => {
  const chatId = msg.chat.id;
  let faqText = "📚 *Frequently Asked Questions:*\n\n";
  faqList.forEach(faq => {
    faqText += `🔹 *Q:* ${faq.q}\n   *A:* ${faq.a}\n\n`;
  });
  bot.sendMessage(chatId, faqText, { parse_mode: "Markdown" });
});
//--------------------------------
// ===== Admin Announcements =====
//--------------------------------
bot.onText(/\/announce (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const senderId = msg.from.id;

  if (!adminIds.includes(senderId)) {
    return bot.sendMessage(chatId, "🚫 You are not authorized to send announcements.");
  }

  const announcementText = (match[1] || "").trim();

  // 🔽 Fix: Validate announcement text
  if (!announcementText) {
    return bot.sendMessage(chatId, "⚠️ Please provide a valid announcement message.");
  }

  const { successCount, failCount } = await sendAnnouncement(announcementText);
  bot.sendMessage(chatId, `✅ Announcement sent!\n📬 Success: ${successCount}, ❌ Failed: ${failCount}`);
});

//------------------------------------------------------
// Handle onboarding, sentiment tracking, and engagement
//-------------------------------------------------------
bot.on("message", async (msg) => {
  const telegramId = msg?.from?.id;
  const chatId = msg?.chat?.id;
  const username = msg.from.username || "N/A";
  const firstName = msg.from.first_name || "";

  if (!chatId || !telegramId) {
      console.error("❌ Missing chatId or userId. Message:", JSON.stringify(msg, null, 2));
      return;
  }

  // -----------------------------------------
  // ✅ 1. Handle Onboarding Flow
  // -----------------------------------------
  if (userStates[telegramId]) {
    let userData = userStates[telegramId];

    if (userData.step === "name") {
        userData.name = msg.text;
        userData.step = "email";
        return bot.sendMessage(chatId, "📧 Great! Now enter your **Email**:");
    } 
    else if (userData.step === "email") {
        userData.email = msg.text;
        userData.step = "role";
        return bot.sendMessage(chatId, "🛠 Awesome! What is your **Role** (e.g., Admin, Member)?");
    } 
    else if (userData.step === "role") {
        userData.role = msg.text;

        try {
            const newUser = new User({
                telegramId,
                name: userData.name || "Anonymous",
                email: userData.email || "unknown@example.com",
                role: userData.role || "Member",
                username
            });

            await newUser.save();
            delete userStates[telegramId];

            const confirmationMsg = `✅ *Onboarding complete!* 🎉\n\n*Your details:*\n👤 Name: ${newUser.name}\n📧 Email: ${newUser.email}\n🛠 Role: ${newUser.role}\n📛 Username: @${newUser.username}`;
            return bot.sendMessage(chatId, confirmationMsg, { parse_mode: "Markdown" });
        } catch (error) {
            console.error("❌ Error saving user:", error);
            return bot.sendMessage(chatId, "⚠️ Error saving your details. Please try again.");
        }
    }
}

  // -----------------------------------------
  // ✅ 2. Sentiment Analysis (ignore commands)
  // -----------------------------------------
  if (msg.text && !msg.text.startsWith('/')) {
      try {
          const result = sentiment.analyze(msg.text);
          const sentimentScore = result.score;
          const sentimentLabel = sentimentScore > 0 ? 'positive' : sentimentScore < 0 ? 'negative' : 'neutral';

          await SentimentModel.create({
              telegramId,
              username,
              sentiment: sentimentLabel,
              score: sentimentScore,
              timestamp: new Date()
          });

          if (sentimentScore <= -3) {
              bot.sendMessage(chatId, "😟 Hey, everything okay? Let us know if we can help. ❤️");
          }
      } catch (err) {
          console.error("❌ Sentiment logging failed:", err);
      }
  }

  // -----------------------------------------
  // ✅ 3. Engagement Points & Stats
  // -----------------------------------------
  try {
      await UserStats.findOneAndUpdate(
          { userId: telegramId },
          {
              $inc: { messageCount: 1, points: 1 },
              $set: { username, firstName }
          },
          { upsert: true, new: true }
      );
      console.log(`📊 Tracked message from @${username} (ID: ${telegramId})`);
  } catch (err) {
      console.error("❌ Failed to update engagement stats:", err);
  }

  // -----------------------------------------
  // ✅ 4. Chat Logging
  // -----------------------------------------
  try {
    await ChatLog.create({
      telegramId,
      username,
      message: msg.text,
      timestamp: new Date()
    });
  } catch (err) {
    console.error("❌ Chat logging failed:", err);
  }
  const text = msg.text;
  if (!text || typeof text !== "string" || text.trim() === "") {
    console.warn("⚠️ Skipping empty message:", msg);
    return;
  }
  
});

//------------------
//Users List Command
//------------------
bot.onText(/\/users/, async (msg) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    if (!adminIds.includes(senderId)) {
        return bot.sendMessage(chatId, "🚫 You are not authorized to view user list.");
    }

    try {
        const users = await User.find({});
        if (users.length === 0) {
            return bot.sendMessage(chatId, "⚠️ No registered users found.");
        }

        let userList = "📋 *Registered Users:*\n\n";
        users.forEach((user, index) => {
            userList += `🔹 ${index + 1}. ${user.name || user.username || "Unknown"} `;
            userList += `- ${user.email || "No email"} `;
            userList += `(${user.role || "Member"}) `;
            userList += `- ID: ${user.telegramId}\n`;
        });

        // If list is too long, split it
        if (userList.length > 4000) {
            const chunks = [];
            for (let i = 0; i < userList.length; i += 4000) {
                chunks.push(userList.slice(i, i + 4000));
            }
            
            chunks.forEach((chunk, index) => {
                setTimeout(() => {
                    bot.sendMessage(chatId, index === 0 ? chunk : `...${chunk}`, { parse_mode: "Markdown" });
                }, index * 500);
            });
        } else {
            bot.sendMessage(chatId, userList, { parse_mode: "Markdown" });
        }
    } catch (error) {
        console.error("❌ Error fetching users:", error);
        bot.sendMessage(chatId, "⚠️ Failed to retrieve users.");
    }
});
//--------------------
//User Profile Command
//--------------------
bot.onText(/\/profile/, async (msg) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;

  try {
      const user = await User.findOne({ telegramId });

      if (!user) {
          return bot.sendMessage(chatId, "⚠️ You are not registered. Use /start to register.");
      }

      const displayName = user.name || `${msg.from.first_name || "N/A"} ${msg.from.last_name || ""}`.trim();
      const username = user.username ? `@${user.username}` : "N/A";
      const joinedDate = user.joinedAt ? user.joinedAt.toDateString() : "N/A";

      const profileText = `
👤 *Your Profile:*

🔹 *ID:* \`${user.telegramId}\`
🔹 *Username:* ${username}
🔹 *Name:* ${displayName}
📧 *Email:* ${user.email || "Not set"}
🛠 *Role:* ${user.role || "Member"}
📅 *Joined:* ${joinedDate}
      `;

      bot.sendMessage(chatId, profileText, { parse_mode: "Markdown", disable_web_page_preview: true });

  } catch (error) {
      console.error("❌ Error fetching profile:", error);
      bot.sendMessage(chatId, "⚠️ Failed to retrieve profile.");
  }
});

//----------------
// Get Telegram ID
//----------------
bot.onText(/\/id/, (msg) => {
    bot.sendMessage(msg.chat.id, `🆔 Your Telegram ID: ${msg.from.id}`);
});

bot.on('polling_error', (error) => {
    console.error(`Polling Error: ${error.message}`);
    // Optionally, integrate a retry mechanism here
    console.log('Debug info:', JSON.stringify(error));
});

//----------------------
// General error handler
//----------------------
bot.on('error', (error) => {
    console.error('❌ Bot error:', error);
});

// ------------------------------------------------------
// ✅ Updated /ask command with reward with AI responses
// ------------------------------------------------------
bot.onText(/\/ask (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const telegramId = msg.from.id;
  const userMessage = match[1].trim();
  const aiResponse = await callAiApi(userMessage);
  bot.sendMessage(chatId, aiResponse);


  // Rate Limiting
  const currentTime = Date.now();
  const userTimestamps = rateLimitMap.get(telegramId) || [];

  if (!aiResponse || aiResponse.trim() === "") {
    return bot.sendMessage(chatId, "⚠️ AI didn't return a valid response. Please try again.");
  }
  bot.sendMessage(chatId, aiResponse);
  

  // Remove old timestamps (older than 1 minute)
  const recentTimestamps = userTimestamps.filter(ts => currentTime - ts < 60000);
  if (recentTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    return bot.sendMessage(chatId, "⚠️ You've reached the limit of 5 requests per minute. Please wait a bit.");
  }

  // Update rateLimitMap
  recentTimestamps.push(currentTime);
  rateLimitMap.set(telegramId, recentTimestamps);

  // Process request
  bot.sendMessage(chatId, "💭 Thinking...");
  const reply = await callAiApi(userMessage);
  bot.sendMessage(chatId, `🤖 ${reply}`);
});

// -----------------------------------------
// ✅ Welcome New Chat Members
// -----------------------------------------
bot.on("new_chat_members", async (msg) => {
  const chatId = msg.chat.id;
  const newMembers = msg.new_chat_members;

  for (const member of newMembers) {
      const telegramId = member.id;
      const username = member.username || "Unknown";
      const name = member.first_name || "User";

      try {
          let user = await User.findOne({ telegramId });

          if (!user) {
              user = new User({ telegramId, username, name });
              await user.save();
              console.log(`✅ New user registered: ${username}`);
          }

          const welcomeMessage = `👋 Welcome, ${name}!\nWe're glad to have you here. Use /start to get onboarded and explore features. 🎉`;
          bot.sendMessage(chatId, welcomeMessage);
      } catch (err) {
          console.error("❌ Failed to register new user:", err);
      }
  }
});

// Leaderboard Command
bot.onText(/\/leaderboard/, async (msg) => {
  const chatId = msg.chat.id;

  try {
    const topUsers = await UserStats.find({})
      .sort({ points: -1 })
      .limit(10)
      .lean(); // lean() makes it faster and cleaner

    if (!topUsers || topUsers.length === 0) {
      return bot.sendMessage(chatId, "📉 No leaderboard data found yet.");
    }

    let leaderboardText = "🏆 *Leaderboard: Top Users by Points*\n\n";
    topUsers.forEach((user, index) => {
      const firstName = user.firstName || "User";
      const username = user.username ? `@${user.username}` : "N/A";
      const points = user.points || 0;
      leaderboardText += `${index + 1}. *${firstName}* (${username}) – ${points} pts\n`;
    });

    bot.sendMessage(chatId, leaderboardText, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("❌ Leaderboard error:", err);
    bot.sendMessage(chatId, "⚠️ Couldn't fetch leaderboard. Try again later.");
  }
});

console.log("Bot object:", bot);

//server listener
app.post(`/bot${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
  });
  
  app.get('/', (req, res) => {
    res.send("🤖 Telegram Bot is up and running!");
  });
  
  app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });