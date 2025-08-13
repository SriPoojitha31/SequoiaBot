const mongoose = require('mongoose');

const ChatLogSchema = new mongoose.Schema({
    userId: Number,
    username: String,
    chatId: String,
    message: String,
    isBot: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ChatLog', ChatLogSchema);
