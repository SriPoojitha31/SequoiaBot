const mongoose = require('mongoose');

const ChatLogSchema = new mongoose.Schema({
    userId: Number,
    username: String,
    message: String,
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ChatLog', ChatLogSchema);
