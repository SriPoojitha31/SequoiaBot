// Required Modules
require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const axios = require("axios");
const cron = require("node-cron");
const Sentiment = require("sentiment");
const sentiment = new Sentiment();

const { getDiscussionPrompt } = require("./prompts.js");
const { UserStats } = require("./models/UserStats.js");
const { getMotivationalQuote } = require("./motivation.js");
const SentimentModel = require("./models/Sentiment.js");
const User = require('./models/User.js');

// Environment Variables
const TOKEN = process.env.BOT_TOKEN;
const BOT_URL = process.env.BOT_URL;
const MONGODB_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 10000;
const API_KEY = process.env.API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
const URL = "https://sequoia-bot.onrender.com";

// Check required environment variables
if (!TOKEN || !MONGODB_URI) {
    console.error("❌ Missing required environment variables!");
    process.exit(1);  // Exit if essential variables are missing
}

// Group & Admin Config
const adminIds = [5559338907];
const groupId = "-1002570334546";
const MAX_REQUESTS_PER_MINUTE = 5;
const REQUEST_TIME_WINDOW = 60 * 1000; // 1 minute
const rateLimitMap = new Map();
const userStates = {};
const requestQueue = [];
let isProcessingRequests = false;

// Initialize Express and Telegram Bot
const app = express();
app.use(express.json());

const bot = new TelegramBot(TOKEN, { polling: false });
bot.setWebHook(`${URL}/bot${TOKEN}`);

// MongoDB Connection
mongoose.connect(MONGODB_URI)
    .then(() => console.log("✅ MongoDB connected"))
    .catch((err) => console.error("❌ MongoDB connection error:", err));

// AI API Handler
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
                },
            }
        );
        return response.data.choices[0].message.content;
    } catch (err) {
        console.error("OpenRouter failed:", err.message);
        return await fallbackToHuggingFace(userMessage);
    }
}

async function fallbackToHuggingFace(userMessage) {
    try {
        console.log("Fallback: Hugging Face API");
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

// Send Announcement Function
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
        await new Promise(resolve => setTimeout(resolve, 100));  // Delay to avoid flooding
    }

    return { successCount, failCount };
}

// Scheduled Tasks (Cron Jobs)
cron.schedule("0 18 * * *", async () => {
    const prompt = await getDiscussionPrompt();
    bot.sendMessage(groupId, `🔥 *Trending Prompt of the Day:*\n\n${prompt}`, { parse_mode: "Markdown" });
});

cron.schedule("0 21 * * *", async () => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const data = await SentimentModel.find({ timestamp: { $gte: today } });
        const total = data.length;
        const pos = data.filter(d => d.sentiment === 'positive').length;
        const neg = data.filter(d => d.sentiment === 'negative').length;
        const neu = data.filter(d => d.sentiment === 'neutral').length;

        const summary = `📊 *Daily Sentiment Summary*\nPositive: ${pos}\nNegative: ${neg}\nNeutral: ${neu}\nTotal Messages Analyzed: ${total}`;
        await bot.sendMessage(groupId, summary, { parse_mode: "Markdown" });
    } catch (error) {
        console.error("Cron job failed:", error.message);
    }
});

// Motivational Quote
cron.schedule("0 10 * * *", () => {
    const quote = getMotivationalQuote();
    bot.sendMessage(groupId, `💬 *Motivation of the Day:*\n\n${quote}`, { parse_mode: "Markdown" });
});

// Leaderboard Announcement
cron.schedule("0 18 * * *", async () => {
    try {
        const leaderboard = await SentimentModel.aggregate([
            { $group: { _id: "$userId", score: { $sum: "$score" }, username: { $first: "$username" } } },
            { $sort: { score: -1 } },
            { $limit: 5 },
        ]);

        if (!leaderboard || leaderboard.length === 0) return;

        const message = `🏆 *Leaderboard*\n\n` + leaderboard.map((u, i) => `#${i + 1} @${u.username} — ${u.score} points`).join("\n");
        await bot.sendMessage(groupId, message, { parse_mode: "Markdown" });
    } catch (error) {
        console.error("❌ Failed to post leaderboard:", error);
    }
});

// /start Command Handler
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
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
        const welcomeMessage = `👋 Welcome, ${name}! You are now registered to use the bot.`;
        bot.sendMessage(chatId, welcomeMessage);
    } catch (error) {
        console.error("❌ Error during registration:", error.message);
        bot.sendMessage(chatId, "⚠️ Error registering user. Please try again later.");
    }
});

// Help Command Handler
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpMessage = `
📋 *Available Commands:*

🤖 *General Commands:*
/start - Register and start using the bot
/help - Show this help message
/faq - View frequently asked questions
/id - Get your Telegram ID
/profile - View your profile information

🧠 *AI Assistant:*
/ask <question> - Ask a question to the AI assistant
Example: /ask What is the meaning of life?

👮 *Admin Commands:*
/announce <message> - Send announcement to all users
/users - View list of registered users

Note: You can ask up to ${MAX_REQUESTS_PER_MINUTE} questions per minute.
    `;
    bot.sendMessage(chatId, helpMessage, { parse_mode: "Markdown" });
});

// FAQ Command Handler
const faqs = {
    "how to use the bot": "Use /start to register, then interact with me directly in chat or group. Try asking a question!",
    "who can make announcements": "Only admins can use the /announce command.",
    "how to earn points": "Be active, engage in group chats, and post positively!",
};

bot.onText(/\/faq/, (msg) => {
    const chatId = msg.chat.id;
    let faqText = "📖 *Frequently Asked Questions:*\n\n";
    for (const [q, a] of Object.entries(faqs)) {
        faqText += `❓ *${q}*\n➡️ ${a}\n\n`;
    }
    bot.sendMessage(chatId, faqText, { parse_mode: "Markdown" });
});

// Handle Text Message (Onboarding, Sentiment Tracking)
bot.on("message", async (msg) => {
    const telegramId = msg?.from?.id;
    const chatId = msg?.chat?.id;
    const username = msg.from.username || "N/A";
    const firstName = msg.from.first_name || "";

    if (!chatId || !telegramId) {
        console.error("❌ Missing chatId or userId. Message:", JSON.stringify(msg, null, 2));
        return;
    }

    // Handle Onboarding Flow
    if (userStates[telegramId]) {
        const userData = userStates[telegramId];

        switch (userData.step) {
            case "name":
                userData.name = msg.text;
                userData.step = "email";
                return bot.sendMessage(chatId, "📧 Great! Now enter your **Email**:");
            case "email":
                userData.email = msg.text;
                userData.step = "role";
                return bot.sendMessage(chatId, "🛠 Awesome! What is your **Role** (e.g., Admin, Member)?");
            case "role":
                userData.role = msg.text;
                try {
                    const newUser = new User({
                        telegramId,
                        name: userData.name,
                        email: userData.email,
                        role: userData.role,
                        username
                    });
                    await newUser.save();
                    delete userStates[telegramId];

                    return bot.sendMessage(
                        chatId,
                        `✅ *Onboarding complete!* 🎉\n\n*Your details:*\n👤 Name: ${newUser.name}\n📧 Email: ${newUser.email}\n🛠 Role: ${newUser.role}\n📛 Username: @${newUser.username}`,
                        { parse_mode: "Markdown" }
                    );
                } catch (error) {
                    console.error("❌ Error saving user:", error);
                    return bot.sendMessage(chatId, "⚠️ Error saving your details. Please try again.");
                }
        }
    }

    // Sentiment Analysis
    if (msg.text && !msg.text.startsWith('/')) {
        try {
            const result = sentiment.analyze(msg.text);
            const sentimentLabel = result.score > 0 ? "positive" : result.score < 0 ? "negative" : "neutral";

            const sentimentData = new SentimentModel({
                userId: telegramId,
                username,
                text: msg.text,
                score: result.score,
                sentiment: sentimentLabel,
                timestamp: new Date()
            });
            await sentimentData.save();

            // Notify if negative sentiment detected
            if (result.score <= -3) {
                bot.sendMessage(chatId, "😟 Hey, everything okay? Let us know if we can help. ❤️");
            }
        } catch (err) {
            console.error("❌ Sentiment logging failed:", err);
        }
    }

    // Engagement Points & Stats
    try {
        await UserStats.findOneAndUpdate(
            { userId: telegramId },
            { $inc: { messageCount: 1, points: 1 }, $set: { username, firstName } },
            { upsert: true, new: true }
        );
        console.log(`📊 Tracked message from @${username} (ID: ${telegramId})`);
    } catch (err) {
        console.error("❌ Failed to update engagement stats:", err);
    }
});

// Admin Announcements
bot.onText(/\/announce (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    if (!adminIds.includes(senderId)) {
        return bot.sendMessage(chatId, "🚫 You are not authorized to send announcements.");
    }

    const announcement = match[1];

    try {
        const users = await User.find({}, 'telegramId');
        if (users.length === 0) {
            return bot.sendMessage(chatId, "⚠️ No users found in the database.");
        }

        let successCount = 0;
        let failCount = 0;

        for (const user of users) {
            const userId = user.telegramId;
            if (!userId) {
                console.warn(`⚠️ Missing telegramId for user:`, user);
                failCount++;
                continue;
            }

            try {
                await bot.sendMessage(
                    userId,
                    `📢 *Announcement:*\n\n${announcement}`,
                    { parse_mode: "Markdown" }
                );
                successCount++;
            } catch (err) {
                console.error(`❌ Failed to send to ${userId}:`, err.message);
                failCount++;
            }

            // Slight delay to avoid flooding
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        bot.sendMessage(chatId, `✅ Announcement sent to ${successCount} users! (❌ Failed: ${failCount})`);
    } catch (error) {
        console.error("❌ Error during announcement broadcast:", error);
        bot.sendMessage(chatId, "⚠️ An error occurred while sending the announcement.");
    }
});

// Users List Command
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
            userList += `🔹 ${index + 1}. ${user.name || user.username || "Unknown"} - ${user.email || "No email"} (${user.role || "Member"}) - ID: ${user.telegramId}\n`;
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

// User Profile Command
bot.onText(/\/profile/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;

    try {
        const user = await User.findOne({ telegramId });

        if (!user) {
            return bot.sendMessage(chatId, "⚠️ You are not registered. Use /start to register.");
        }

        bot.sendMessage(chatId, `
👤 *Your Profile:*

🔹 *ID:* ${user.telegramId}
🔹 *Username:* @${user.username || "N/A"}
🔹 *Name:* ${user.name || "Not set"}
📧 *Email:* ${user.email || "Not set"}
🛠 *Role:* ${user.role || "Member"}
📅 *Joined:* ${user.joinedAt ? user.joinedAt.toDateString() : "N/A"}
        `, { parse_mode: "Markdown" });
    } catch (error) {
        console.error("❌ Error fetching profile:", error);
        bot.sendMessage(chatId, "⚠️ Failed to retrieve profile.");
    }
});

// Get Telegram ID Command
bot.onText(/\/id/, (msg) => {
    bot.sendMessage(msg.chat.id, `🆔 Your Telegram ID: ${msg.from.id}`);
});

// Error Handlers
bot.on('polling_error', (error) => {
    console.error(`Polling Error: ${error.message}`);
    console.log('Debug info:', JSON.stringify(error));
});

bot.on('error', (error) => {
    console.error('❌ Bot error:', error);
});

// AI Powered Response
async function processPendingRequests() {
    if (isProcessingRequests) return;
    isProcessingRequests = true;

    while (requestQueue.length > 0) {
        const { userMessage, chatId } = requestQueue.shift();
        try {
            bot.sendChatAction(chatId, "typing");  // Send typing indicator
            const responseMessage = await callAiApi(userMessage);
            await bot.sendMessage(chatId, `🤖 *AI Response:*\n\n${responseMessage}`, { parse_mode: "Markdown" });
        } catch (error) {
            if (error.response && error.response.status === 429) {
                console.error("⚠️ Rate limit exceeded. Notify user:", error);
                bot.sendMessage(chatId, "⚠️ You have exceeded the allowed usage. Please try again later.");
            } else {
                console.error("❌ Error processing request:", error);
                bot.sendMessage(chatId, "⚠️ Sorry, an error occurred while processing your request. Please try again.");
            }
        }
        await new Promise(resolve => setTimeout(resolve, 1000));  // Rate limit
    }

    isProcessingRequests = false;
}

// Enhanced /ask Command
bot.onText(/\/ask(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    let userMessage = match[1].trim();

    // Validate user message
    if (!userMessage) {
        return bot.sendMessage(chatId, `
⚠️ Please provide a question after the /ask command.

*Correct format:*
/ask What is the capital of France?

Try again with your question.
        `, { parse_mode: "Markdown" });
    }

    try {
        const user = await User.findOne({ telegramId });
        if (!user) {
            return bot.sendMessage(chatId, "⚠️ Please register using /start before using this command.");
        }

        // Rate Limiting check
        const now = Date.now();
        const lastRequests = rateLimitMap.get(telegramId) || [];
        const updatedRequests = lastRequests.filter((time) => now - time < REQUEST_TIME_WINDOW);

        if (updatedRequests.length >= MAX_REQUESTS_PER_MINUTE) {
            return bot.sendMessage(chatId, `
⏳ *Rate Limit Reached*
You've reached the limit of ${MAX_REQUESTS_PER_MINUTE} questions per minute. Please wait before asking another question.
            `, { parse_mode: "Markdown" });
        }

        updatedRequests.push(now);
        rateLimitMap.set(telegramId, updatedRequests);

        // Add request to processing queue
        requestQueue.push({ userMessage, chatId });
        bot.sendMessage(chatId, "🤖 Your question has been received. Processing...");
        console.log(`📝 User ${telegramId} (${user.username}) asked: ${userMessage}`);
        
        processPendingRequests();  // Start processing requests
    } catch (error) {
        console.error("❌ Error processing /ask command:", error);
        bot.sendMessage(chatId, "⚠️ An error occurred. Please try again later.");
    }
});

// Auto Welcome Message for New Chat Members
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

            const welcomeMessage = `👋 Welcome, ${name}! You've been successfully registered to use this bot.`;
            await bot.sendMessage(chatId, welcomeMessage);
        } catch (error) {
            console.error(`❌ Error registering new member (${telegramId}):`, error.message);
            await bot.sendMessage(chatId, "⚠️ An error occurred during registration. Please try again later.");
        }
    }
});

// Express endpoint to handle Telegram Webhook
app.post(`/bot${TOKEN}`, (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Simple endpoint for checking server status
app.get('/', (req, res) => {
    res.json({ status: 'OK', message: 'Bot server is running' });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});