# 🤖 SequoiaBot – AI-Powered Telegram Bot for Community Management

SequoiaBot is a smart community manager Telegram bot built using Node.js, MongoDB, and Telegram Bot API. It supports:
- 🧠 AI-powered replies
- 💬 User onboarding & registration
- 📢 Admin-only announcements
- 🎯 Sentiment analysis
- ⏰ Scheduled motivational messages

## 🚀 Features
- AI-based responses with rate-limiting
- Scheduled announcements using `node-cron`
- Sentiment analysis to track engagement
- MongoDB for user profile management
- Admin-only features for control and moderation
- leaderboard of top 5 users

## 🛠 Tech Stack
- Node.js
- Express.js
- Telegram Bot API
- MongoDB & Mongoose
- node-cron
- OpenAI API
- OpenRouter API
- HuggingFace API

## 🔧 Setup & Run Locally
```bash
git clone https://github.com/SriPoojitha31/SequoiaBot.git
cd SequoiaBot
npm install
npm start
```
## 👾 Deployment 
Deployed on Render
Live: https://sequoia-bot.onrender.com

``
## 📲 Contact
Linkdin:www.linkedin.com/in/sri-poojitha-jorige-377270294

Created with 💙 by SriPoojitha31

# Telegram AI Bot

A powerful Telegram bot with advanced AI capabilities, user management, and engagement features.

## Features

- **Advanced AI Responses**: Get high-quality answers to any question using specialized prompts
- **Conversation History**: The bot remembers previous interactions for more contextual responses
- **Multiple AI Models**: Uses OpenRouter API with fallbacks to ensure reliable responses
- **User Management**: Track user stats, points, and engagement
- **Admin Commands**: Broadcast announcements and manage users
- **Rate Limiting**: Prevents abuse with configurable request limits

## Commands

- `/start` - Register and start using the bot
- `/help` - Show help message
- `/ask <question>` - Ask the AI assistant anything
- `/profile` - View your profile
- `/leaderboard` - See the top users
- `/id` - Get your Telegram ID
- `/faq` - View frequently asked questions

### Admin Commands

- `/announce <message>` - Broadcast to all users
- `/users` - List registered users

## AI Capabilities

The bot uses specialized prompts based on the type of question:

- **Technical/Coding**: Expert programming assistance with code examples
- **Math/Science**: Step-by-step solutions and explanations
- **History/Culture**: Accurate historical information with context
- **Health/Medical**: General health information with appropriate disclaimers
- **Business/Finance**: Financial insights with balanced perspectives
- **General**: Comprehensive answers on any topic

## Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Create a `.env` file with the following variables:
   ```
   BOT_TOKEN=your_telegram_bot_token
   MONGODB_URI=your_mongodb_connection_string
   OPENROUTER_API_KEY=your_openrouter_api_key
   HUGGINGFACE_API_KEY=your_huggingface_api_key
   BOT_URL=your_bot_url
   PORT=10000
   GROUP_ID=your_group_id
   ADMIN_IDS=[your_admin_id]
   MAX_REQUESTS_PER_MINUTE=5
   ```
4. Start the server: `node server.js`

## Deployment

The bot is designed to be deployed on platforms like Render, Heroku, or any Node.js hosting service.

## License

MIT
=======
```
Created with 💙 by SriPoojitha31
