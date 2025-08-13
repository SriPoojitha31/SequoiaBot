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
const { getSpecializedPrompt } = require("./aiPrompts.js");
const { callAiApi } = require("./aiService.js");
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
  "What's one thing you learned this week?"
];

cron.schedule('0 9 * * *', async () => {
  const users = await User.find({}, 'telegramId');
  const quote = await getMotivationalQuote();
  users.forEach(user => {
    if (user.telegramId) {
      bot.sendMessage(user.telegramId, `🌟 *Daily Motivation:*\n${quote}`, { parse_mode: "Markdown" });
    }
  });
});

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
      // Check if user is an admin
      const isAdmin = adminIds.includes(telegramId);
      
      user = new User({
        telegramId,
        name: firstName,
        username,
        points: 0,
        role: isAdmin ? "Admin" : "Member",
        isAdmin: isAdmin
      });
      await user.save();
      console.log(`✅ Registered user: ${firstName} (${isAdmin ? 'Admin' : 'Member'})`);
    } else {
      // Only add points if it's not a command
      if (msg.text && !msg.text.startsWith('/')) {
        user.points += 1;
        await user.save();
        console.log(`✨ ${user.name} gained a point! (${user.points})`);
      }
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
/admins - List all admin users
/removeuser <user_id> - Remove a user from the database
/updateadmin <user_id> - Update a user's admin status

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
  const announcement = match[1];

  // Optional: restrict to admins
  if (!adminIds.includes(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, "❌ You are not authorized to use this command.");
  }  

  try {
    const users = await User.find({});
    for (const user of users) {
      await bot.sendMessage(user.telegramId, `📢 Announcement:\n\n${announcement}`);
    }
    console.log("✅ Announcement sent to all users.");
  } catch (err) {
    console.error("❌ Failed to send announcement:", err.message);
  }
});

//------------------------------------------------------
// Handle onboarding, sentiment tracking, and engagement
//-------------------------------------------------------
bot.on("message", async (msg) => {
  const telegramId = msg?.from?.id;
  const chatId = msg?.chat?.id;
  const username = msg.from.username || "N/A";
  const firstName = msg.from.first_name || "User";

  if (!chatId || !telegramId) {
    console.error("❌ Missing chatId or userId. Message:", JSON.stringify(msg, null, 2));
    return;
  }

  // -----------------------------------------
  // ✅ 0. Register or Fetch User
  // -----------------------------------------
  let user;
  try {
    user = await User.findOne({ telegramId });

    if (!user) {
      // Check if user is an admin
      const isAdmin = adminIds.includes(telegramId);
      
      user = new User({
        telegramId,
        name: firstName,
        username,
        points: 0,
        role: isAdmin ? "Admin" : "Member",
        isAdmin: isAdmin
      });
      await user.save();
      console.log(`✅ Registered user: ${firstName} (${isAdmin ? 'Admin' : 'Member'})`);
    } else {
      // Only add points if it's not a command
      if (msg.text && !msg.text.startsWith('/')) {
        user.points += 1;
        await user.save();
        console.log(`✨ ${user.name} gained a point! (${user.points})`);
      }
    }
  } catch (error) {
    console.error("❌ User registration or points error:", error);
    return;
  }

  // -----------------------------------------
  // ✅ 1. Onboarding Flow
  // -----------------------------------------
  if (userStates[telegramId]) {
    let userData = userStates[telegramId];

    if (userData.step === "name") {
      userData.name = msg.text;
      userData.step = "email";
      return bot.sendMessage(chatId, "📧 Great! Now enter your **Email**:");
    } else if (userData.step === "email") {
      userData.email = msg.text;
      userData.step = "role";
      return bot.sendMessage(chatId, "🛠 Awesome! What is your **Role** (e.g., Admin, Member)?");
    } else if (userData.step === "role") {
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
        console.error("❌ Error saving user details:", error);
        return bot.sendMessage(chatId, "⚠️ Failed to save your details. Try again later.");
      }
    }
  }

  // -----------------------------------------
  // ✅ 2. Sentiment Analysis
  // -----------------------------------------
  if (msg.text && !msg.text.startsWith('/')) {
    try {
      const result = sentiment.analyze(msg.text);
      const score = result.score;
      const label = score > 0 ? 'positive' : score < 0 ? 'negative' : 'neutral';

      await SentimentModel.create({
        telegramId,
        username,
        sentiment: label,
        score: score,
        timestamp: new Date()
      });

      if (score <= -3) {
        bot.sendMessage(chatId, "😟 Hey, everything okay? Let us know if we can help. ❤️");
      }
    } catch (err) {
      console.error("❌ Sentiment logging error:", err);
    }
  }

  // -----------------------------------------
  // ✅ 3. Chat Logging
  // -----------------------------------------
  if (msg.text && msg.text.trim() !== "") {
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
//Admins List Command
//--------------------
bot.onText(/\/admins/, async (msg) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    if (!adminIds.includes(senderId)) {
        return bot.sendMessage(chatId, "🚫 You are not authorized to view admin list.");
    }

    try {
        // Get all users with Admin role
        const adminUsers = await User.find({ role: "Admin" });
        
        if (adminUsers.length === 0) {
            return bot.sendMessage(chatId, "⚠️ No admin users found.");
        }

        let adminList = "👮 *Admin Users:*\n\n";
        adminUsers.forEach((user, index) => {
            adminList += `🔹 ${index + 1}. ${user.name || user.username || "Unknown"} `;
            adminList += `- ${user.email || "No email"} `;
            adminList += `- ID: ${user.telegramId}\n`;
        });

        bot.sendMessage(chatId, adminList, { parse_mode: "Markdown" });
    } catch (error) {
        console.error("❌ Error fetching admin users:", error);
        bot.sendMessage(chatId, "⚠️ Failed to retrieve admin users.");
    }
});

//--------------------
//Remove User Command
//--------------------
bot.onText(/\/removeuser (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;
    const userIdToRemove = match[1].trim();

    if (!adminIds.includes(senderId)) {
        return bot.sendMessage(chatId, "🚫 You are not authorized to remove users.");
    }

    try {
        // Check if user exists
        const userToRemove = await User.findOne({ telegramId: userIdToRemove });
        
        if (!userToRemove) {
            return bot.sendMessage(chatId, "⚠️ User not found. Please check the user ID and try again.");
        }

        // Prevent removing yourself
        if (userIdToRemove === senderId.toString()) {
            return bot.sendMessage(chatId, "⚠️ You cannot remove yourself from the database.");
        }

        // Delete the user
        await User.deleteOne({ telegramId: userIdToRemove });
        
        // Also delete related data
        await ChatLog.deleteMany({ telegramId: userIdToRemove });
        await SentimentModel.deleteMany({ telegramId: userIdToRemove });
        
        // If there are other models with user references, delete those too
        // For example: await Engagement.deleteMany({ telegramId: userIdToRemove });
        
        bot.sendMessage(chatId, `✅ User with ID ${userIdToRemove} has been successfully removed from the database.`);
        console.log(`✅ Admin ${senderId} removed user ${userIdToRemove}`);
    } catch (error) {
        console.error("❌ Error removing user:", error);
        bot.sendMessage(chatId, "⚠️ Failed to remove user. Please try again later.");
    }
});

//--------------------
//Update Admin Command
//--------------------
bot.onText(/\/updateadmin (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;
    const userIdToUpdate = match[1].trim();

    if (!adminIds.includes(senderId)) {
        return bot.sendMessage(chatId, "🚫 You are not authorized to update admin status.");
    }

    try {
        // Check if user exists
        const userToUpdate = await User.findOne({ telegramId: userIdToUpdate });
        
        if (!userToUpdate) {
            return bot.sendMessage(chatId, "⚠️ User not found. Please check the user ID and try again.");
        }

        // Toggle admin status
        const isCurrentlyAdmin = adminIds.includes(parseInt(userIdToUpdate));
        
        if (isCurrentlyAdmin) {
            // Remove from admin list
            const index = adminIds.indexOf(parseInt(userIdToUpdate));
            if (index > -1) {
                adminIds.splice(index, 1);
            }
            userToUpdate.role = "Member";
            userToUpdate.isAdmin = false;
            await userToUpdate.save();
            bot.sendMessage(chatId, `✅ User with ID ${userIdToUpdate} has been removed from admin privileges.`);
        } else {
            // Add to admin list
            adminIds.push(parseInt(userIdToUpdate));
            userToUpdate.role = "Admin";
            userToUpdate.isAdmin = true;
            await userToUpdate.save();
            bot.sendMessage(chatId, `✅ User with ID ${userIdToUpdate} has been granted admin privileges.`);
        }
        
        console.log(`✅ Admin ${senderId} updated admin status for user ${userIdToUpdate}`);
    } catch (error) {
        console.error("❌ Error updating admin status:", error);
        bot.sendMessage(chatId, "⚠️ Failed to update admin status. Please try again later.");
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
  
  // Rate Limiting
  const currentTime = Date.now();
  const userTimestamps = rateLimitMap.get(telegramId) || [];

  // Remove old timestamps (older than 1 minute)
  const recentTimestamps = userTimestamps.filter(ts => currentTime - ts < 60000);
  if (recentTimestamps.length >= MAX_REQUESTS_PER_MINUTE) {
    return bot.sendMessage(chatId, "⚠️ You've reached the limit of 5 requests per minute. Please wait a bit.");
  }

  // Update rateLimitMap
  recentTimestamps.push(currentTime);
  rateLimitMap.set(telegramId, recentTimestamps);
  
  let thinkingMsg;
  try {
    // Send thinking message
    thinkingMsg = await bot.sendMessage(chatId, "💭 Thinking...");
    
    // Get AI response using the new service
    const aiResponse = await callAiApi(userMessage, chatId, OPENROUTER_API_KEY, HUGGINGFACE_API_KEY);
    
    // Delete thinking message
    if (thinkingMsg) {
      await bot.deleteMessage(chatId, thinkingMsg.message_id).catch(console.error);
    }
    
    if (!aiResponse || aiResponse.trim() === "") {
      return bot.sendMessage(chatId, "⚠️ AI didn't return a valid response. Please try again.");
    }
    
    // Send the response only once with Markdown formatting
    await bot.sendMessage(chatId, aiResponse, { parse_mode: "Markdown" });
    
    // Update user stats
    try {
      await UserStats.findOneAndUpdate(
        { userId: telegramId },
        { $inc: { aiRequests: 1 } },
        { upsert: true }
      );
    } catch (err) {
      console.error("Error updating user stats:", err);
    }
  } catch (error) {
    console.error("Error in /ask command:", error);
    // Delete thinking message if it exists
    if (thinkingMsg) {
      await bot.deleteMessage(chatId, thinkingMsg.message_id).catch(console.error);
    }
    await bot.sendMessage(chatId, "❌ An error occurred while processing your request. Please try again later.");
  }
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
    const users = await User.find().sort({ points: -1 }).limit(10);
    if (!users || users.length === 0) {
      return bot.sendMessage(chatId, "No leaderboard data available.");
    }

    let leaderboardMsg = "🏆 *Top Users Leaderboard:*\n\n";
    users.forEach((user, index) => {
      leaderboardMsg += `${index + 1}. ${user.name || "Anonymous"} - ${user.points || 0} points\n`;
    });

    bot.sendMessage(chatId, leaderboardMsg, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("❌ Error fetching leaderboard:", error);
    bot.sendMessage(chatId, "⚠️ Error retrieving leaderboard. Try again later.");
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