const rateLimitMap = new Map();
require('dotenv').config();

const express = require("express");
const bodyParser = require('body-parser');
const TelegramBot = require("node-telegram-bot-api"); // optional, depends if you're using this elsewhere
const mongoose = require("mongoose");
const OpenAI = require("openai");
const axios = require("axios");
const { getDiscussionPrompt } = require('./prompts.js');
const { UserStats } = require("./models/UserStats.js");

const TOKEN = process.env.BOT_TOKEN;
const BOT_URL = process.env.BOT_URL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 10000;
const API_ENDPOINT = process.env.API_ENDPOINT || "https://api.example.com/ask";
const API_KEY = process.env.API_KEY;

// Rate limiting configuration
const MAX_REQUESTS_PER_MINUTE = 5;
const REQUEST_TIME_WINDOW = 60 * 1000; // 1 minute in milliseconds

const adminIds = [5559338907];
const groupId = '-1002570334546';

const bot = new TelegramBot(process.env.BOT_TOKEN,{polling: true}); // ✅ keep this one (for webhook)

// Queue to manage requests
const requestQueue = [];
let isProcessingRequests = false;

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: OPENAI_API_KEY
});

// Initialize Express app
const app = express();
app.use(express.json());

const Sentiment = require('sentiment');
const sentiment = new Sentiment();

const { getMotivationalQuote } = require('./motivation.js');

const cron = require('node-cron');
const SentimentModel = require('./models/Sentiment.js');

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));
  
// Define User Schema & Model
const userSchema = new mongoose.Schema({
    telegramId: {
        type: Number,
        required: true,
        unique: true
    },
    username: {
        type: String
    },
    name: {
        type: String
    },
    email: {
        type: String
    },
    role: {
        type: String,
        default: "Member"
    },
    joinedAt: {
        type: Date,
        default: Date.now
    }
});
const User = mongoose.model("User", userSchema);

const userStates = {};

async function callAiApi(userMessage) {
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: userMessage }
            ],
            max_tokens: 500
        });

        return response.choices[0].message.content;
    } catch (error) {
        console.error('❌ Error calling AI API:', error);
        throw error;
    }
}

async function callExternalAiApi(userMessage) {
    try {
        const response = await axios.post(API_ENDPOINT, {
            prompt: userMessage,
        }, {
            headers: {
                'Authorization': `Bearer ${API_KEY}`,
                'Content-Type': 'application/json',
            },
        });

        return response.data.answer;
    } catch (error) {
        console.error('❌ Error calling external AI API:', error);
        throw error;
    }
}

async function callAiApi(userMessage) {
    try {
        // Try OpenAI first
        const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [
                { role: "system", content: "You are a helpful assistant." },
                { role: "user", content: userMessage }
            ],
            max_tokens: 500
        });

        return response.choices[0].message.content;
    } catch (openaiError) {
        console.error('OpenAI API error:', openaiError);
        
        // If OpenAI fails, try OpenRouter as a fallback
        try {
            console.log('Falling back to OpenRouter API');
            const openRouterResponse = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                model: "openai/gpt-3.5-turbo",
                messages: [
                    { role: "system", content: "You are a helpful assistant." },
                    { role: "user", content: userMessage }
                ]
            }, {
                headers: {
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'https://your-site-url.com', // Replace with your actual site URL
                    'X-Title': 'Telegram Bot'
                }
            });
            
            return openRouterResponse.data.choices[0].message.content;
        } catch (openRouterError) {
            console.error('OpenRouter API error:', openRouterError);
            throw new Error('Both AI services failed to provide a response');
        }
    }
}

async function callHuggingFaceApi(userMessage) {
    try {
        const response = await axios.post(
            "https://api-inference.huggingface.co/models/google/flan-t5-xxl",
            { inputs: userMessage },
            { headers: { Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}` } }
        );
        return response.data[0].generated_text;
    } catch (error) {
        console.error("Error calling Hugging Face API:", error);
        throw error;
    }
}

// ✅ Trending Prompt Every Evening at 6 PM
cron.schedule('0 18 * * *', async () => {
    const prompt = await getDiscussionPrompt();
    bot.sendMessage(groupId, `🔥 *Trending Prompt of the Day:*\n\n${prompt}`, { parse_mode: "Markdown" });
});

cron.schedule('0 21 * * *', async () => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
  
      const data = await SentimentModel.find({
        timestamp: { $gte: today }
      });
  
      const total = data.length;
      const pos = data.filter(d => d.sentiment === 'positive').length;
      const neg = data.filter(d => d.sentiment === 'negative').length;
      const neu = data.filter(d => d.sentiment === 'neutral').length;
  
      const summary = `📊 *Daily Sentiment Summary*
  Positive: ${pos}
  Negative: ${neg}
  Neutral: ${neu}
  Total Messages Analyzed: ${total}`;
  
      // Replace with your actual group chat ID
      const GROUP_ID = process.env.TELEGRAM_GROUP_ID || 'your_group_chat_id';
      await bot.sendMessage(GROUP_ID, summary, { parse_mode: 'Markdown' });
    } catch (error) {
      console.error("Cron job failed:", error.message);
    }
});

cron.schedule('0 10 * * *', () => {
    bot.sendMessage(groupId, "🗓️ Here's your daily dose of motivation! Go rock it! 🚀");
  });

// ✅ Schedule a motivational message every day at 10 AM
cron.schedule('0 10 * * *', () => {
    const quote = getMotivationalQuote();
    bot.sendMessage(groupId, `💬 *Motivation of the Day:*\n\n${quote}`, { parse_mode: "Markdown" });
});

// Schedule leaderboard announcement every day at 6 PM
cron.schedule("0 18 * * *", async () => {
    try {
      const leaderboard = await SentimentModel.aggregate([
        {
          $group: {
            _id: "$userId",
            score: { $sum: "$score" },
            username: { $first: "$username" },
          },
        },
        { $sort: { score: -1 } },
        { $limit: 5 },
      ]);
  
      if (!leaderboard || leaderboard.length === 0) {
        console.log("📉 No sentiment data yet for leaderboard.");
        return;
      }
  
      const topUser = leaderboard[0]; // safe access
      const message = `🏆 *Leaderboard*\n\n` + leaderboard.map((u, i) =>
        `#${i + 1} @${u.username} — ${u.score} points`).join("\n");
  
      bot.sendMessage(groupId, message, { parse_mode: "Markdown" });
  
    } catch (error) {
      console.error("❌ Failed to post leaderboard:", error);
    }
  });
  
//Start command
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    const username = msg.from.username || "Unknown";
    const name=msg.from.first_name||"User";

    try {
        let user = await User.findOne({ telegramId });

        if (!user) {
            user = new User({ telegramId, username, name });
            await user.save();
            console.log("✅ New user registered:", username);
        }

        const welcomeMessage='👋 Welcome, ${name} ! You are now registered to use the bot.'
        bot.sendMessage(chatId, welcomeMessage);
    } catch (error) {
        console.error("❌ Error during registration:", error.message);
        bot.sendMessage(chatId, "⚠️ Error registering user.Please try again later.");
    }
});

//Help command
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
    bot.sendMessage(chatId, helpMessage, {parse_mode: "Markdown"});
});

//FAQ command
bot.onText(/\/faq/, (msg) => {
    const chatId = msg.chat.id;
    const faqMessage = `
🤖 *Frequently Asked Questions:*

🔹 *What can this bot do?*
   - This bot provides AI-powered responses to your questions and helps manage the community.

🔹 *How do I ask the AI a question?*
   - Use the /ask command followed by your question:
   - Example: /ask What's the weather like today?

🔹 *Are there any usage limits?*
   - Yes, you can ask up to ${MAX_REQUESTS_PER_MINUTE} questions per minute.

🔹 *How do I report an issue?*
   - Contact the admin or use /help for more details.

🔹 *Can I contribute to this bot?*
   - Yes! Contact the admin for collaboration opportunities.
    `;
    bot.sendMessage(chatId, faqMessage, { parse_mode: "Markdown" });
});

// Handle onboarding messages
bot.on("message", async (msg) => {
    console.log("🔍 DEBUG - Received Message:", JSON.stringify(msg, null, 2));

    const userId = msg?.from?.id; 
    const chatId = msg?.chat?.id;

    if (!chatId) {
        console.error("❌ Error: chatId is undefined or empty. Message:", JSON.stringify(msg, null, 2));
        bot.sendMessage(userId, "⚠️ Error: Unable to process your message.");
        return;
    }

    bot.sendMessage(chatId, "✅ This is a test message to check chat ID.");

    if (!userStates[userId]) return; // Ignore if not in onboarding

    let userData = userStates[userId];

    if (userData.step === "name") {
        userData.name = msg.text;
        userData.step = "email";
        bot.sendMessage(chatId, "📧 Great! Now enter your **Email**:");
    } else if (userData.step === "email") {
        userData.email = msg.text;
        userData.step = "role";
        bot.sendMessage(chatId, "🛠 Awesome! What is your **Role** (e.g., Admin, Member)?");
    } else if (userData.step === "role") {
        userData.role = msg.text;

        try {
            const newUser = new User({
                userId: userId,
                name: userData.name,
                email: userData.email,
                role: userData.role,
                username: msg.from.username || "N/A" 
            });

            await newUser.save();
            delete userStates[userId]; 

            bot.sendMessage(
                chatId,
                `✅ Onboarding complete! 🎉\n\nYour details:\n👤 Name: ${newUser.name}\n📧 Email: ${newUser.email}\n🛠 Role: ${newUser.role}\n📛 Username: @${newUser.username}`
            );
        } catch (error) {
            console.error("❌ Error saving user:", error);
            bot.sendMessage(chatId, "⚠️ Error saving your details. Please try again.");
        }
    }
    if (msg.text && !msg.text.startsWith('/')) {
        const result = sentiment.analyze(msg.text);
        const sentimentLabel =
          result.score > 0 ? 'positive' : result.score < 0 ? 'negative' : 'neutral';
        const sentimentData = new SentimentModel({
          userId: msg.from.id,
          username: msg.from.username || '',
          text: msg.text,
          score: result.score,
          sentiment: sentimentLabel,
          timestamp: new Date()
        });

        await sentimentData.save();
        if (result.score <= -3) {
            bot.sendMessage(chatId, "Hey, everything okay? Let us know if we can help. ❤️");
        }
        
        const userId = msg.from.id;
        const username = msg.from.username || '';
        const firstName = msg.from.first_name || '';
        await UserStats.findOneAndUpdate(
            { userId },
            {
                $inc: { messageCount: 1 },
                $set: { username, firstName }
            },
            { upsert: true, new: true }
        );

        console.log(`👤 Tracked message from ${username} (ID: ${userId})`);
    }
});


//Admin Announcements
bot.onText(/\/announce (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;

    if (!adminIds.includes(senderId)) {
        return bot.sendMessage(chatId, "🚫 You are not authorized to send announcements.");
    }

    const announcement = match[1]; // Extract message after "/announce"

    try {
        const users = await User.find({}, 'telegramId'); // Get all users' IDs

        if (users.length === 0) {
            return bot.sendMessage(chatId, "⚠️ No users found to send the announcement.");
        }

        let successCount = 0;
        let failCount = 0;

        for (const user of users) {
            if (!user.telegramId) {
                console.warn(`⚠️ Skipping user with missing telegramId:`, user);
                failCount++;
                continue;
            }

            try {
                await bot.sendMessage(
                    user.telegramId, 
                    `📢 *Announcement:*\n\n${announcement}`, 
                    { parse_mode: "Markdown" }
                );
                successCount++;
            } catch (err) {
                console.error(`❌ Error sending to ${user.telegramId}:`, err);
                failCount++;
            }
            
            // Delay to avoid hitting Telegram API limits
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        bot.sendMessage(
            chatId, 
            `✅ Announcement sent to ${successCount} users! (Failed: ${failCount})`
        );
    } catch (error) {
        console.error("❌ Error sending announcement:", error);
        bot.sendMessage(chatId, "⚠️ Failed to send the announcement.");
    }
});


//Users List Command
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

//User Profile Command
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
📅 *Joined:* ${user.joinedAt.toDateString()}
        `, { parse_mode: "Markdown" });

    } catch (error) {
        console.error("❌ Error fetching profile:", error);
        bot.sendMessage(chatId, "⚠️ Failed to retrieve profile.");
    }
});

// Get Telegram ID
bot.onText(/\/id/, (msg) => {
    bot.sendMessage(msg.chat.id, `🆔 Your Telegram ID: ${msg.from.id}`);
});

bot.on('polling_error', (error) => {
    console.error(`Polling Error: ${error.message}`);
    // Optionally, integrate a retry mechanism here
    console.log('Debug info:', JSON.stringify(error));
});

// General error handler
bot.on('error', (error) => {
    console.error('❌ Bot error:', error);
});

//AI Powered Response
// Process requests from the queue
async function processPendingRequests() {
    if (isProcessingRequests) return;
    isProcessingRequests = true;

    while (requestQueue.length > 0) {
        const { userMessage, chatId } = requestQueue.shift();
        try {
            // Send typing indicator to improve user experience
            bot.sendChatAction(chatId, "typing");
            
            // Call the AI API and get the response 
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

        // Rate limit: wait 1 second between requests
        await new Promise(resolve => setTimeout(resolve, 1000)); 
    }

    isProcessingRequests = false;
}

// Enhanced /ask command with better error handling and user feedback
bot.onText(/\/ask(.*)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const telegramId = msg.from.id;
    
    // Extract user message, handling the case where there might be no space
    let userMessage = match[1].trim();
    
    // If no message provided, send an example
    if (!userMessage) {
        return bot.sendMessage(chatId, `
⚠️ Please provide a question after the /ask command.

*Correct format:*
/ask What is the capital of France?

Try again with your question.
        `, { parse_mode: "Markdown" });
    }

    try {
        // Check if user is registered
        const user = await User.findOne({ telegramId });
        if (!user) {
            return bot.sendMessage(chatId, "⚠️ Please register using /start before using this command.");
        }

        // Implement rate limiting
        const now = Date.now();
        const lastRequests = rateLimitMap.get(telegramId) || [];
        const updatedRequests = lastRequests.filter((time) => now - time < REQUEST_TIME_WINDOW);

        if (updatedRequests.length >= MAX_REQUESTS_PER_MINUTE) {
            return bot.sendMessage(chatId, `
⏳ *Rate Limit Reached*
You've reached the limit of ${MAX_REQUESTS_PER_MINUTE} questions per minute.
Please wait before asking another question.
            `, { parse_mode: "Markdown" });
        }

        // Update rate limit tracking
        updatedRequests.push(now);
        rateLimitMap.set(telegramId, updatedRequests);

        // Add request to queue
        requestQueue.push({ userMessage, chatId });
        bot.sendMessage(chatId, "🤖 Your question has been received. Processing...");
        
        // Log the question for monitoring
        console.log(`📝 User ${telegramId} (${user.username}) asked: ${userMessage}`);
        
        // Process the queue
        processPendingRequests();
    } catch (error) {
        console.error("❌ Error processing /ask command:", error);
        bot.sendMessage(chatId, "⚠️ An error occurred. Please try again later.");
    }
});

// Auto Welcome Message for new chat members
bot.on('new_chat_members', async (msg) => {
    const chatId = msg.chat.id;
    const newMembers = msg.new_chat_members;

    for (const user of newMembers) {
        try {
            let existingUser = await User.findOne({ telegramId: user.id });

            if (!existingUser) {
                existingUser = new User({
                    telegramId: user.id,
                    name: user.first_name,
                    username: user.username || "N/A",
                    role: "Member" // Default role for new users
                });

                await existingUser.save();
                console.log(`✅ New user added: ${user.first_name}`);
            }

            // Role-Based Welcome Message
            let welcomeMessage = `👋 Welcome, *${user.first_name}*! 🎉`;

            if (existingUser.role === "Admin") {
                welcomeMessage += `\n\nYou're an *Admin*! 🚀 Let us know if you need anything.`;
            } else {
                welcomeMessage += `\n\nYou're a valued *Member* of this community! 🎯`;
            }

            // Inline Buttons for Rules & Community Guidelines
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "📜 View Community Rules", url: "https://example.com/rules" }],
                        [{ text: "🔹 About Us", url: "https://example.com/about" }]
                    ]
                }
            };

            bot.sendMessage(chatId, welcomeMessage, { parse_mode: "Markdown", ...keyboard });

        } catch (error) {
            console.error("❌ Error adding new user:", error);
        }
    }
});

console.log("Bot object:", bot);

// Simple endpoint for checking server status
app.get('/', (req, res) => {
    res.json({ status: 'OK', message: 'Bot server is running' });
});

//Start server
app.listen(10000, () => {
    console.log("Server running on port 10000");
  });