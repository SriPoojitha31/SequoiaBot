// models/User.js
const mongoose = require('mongoose');
const ChatLog=require('./ChatLog.js');
const Engagement = require('./Engagement.js');
const userSchema = new mongoose.Schema({
  telegramId: String,
  name: String,
  username: String,
  points: { type: Number, default: 0 },
  lastMessage: String,
  lastActive: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', userSchema); // ✅ correct export
