// models/User.js
const mongoose = require('mongoose');
const ChatLog=require('./ChatLog.js');
const Engagement = require('./Engagement.js');
const userSchema = new mongoose.Schema({
  telegramId: String,
  name: String,
  username: String,
  email: String,
  role: { type: String, default: "Member" },
  points: { type: Number, default: 0 },
  lastMessage: String,
  lastActive: { type: Date, default: Date.now },
  joinedAt: { type: Date, default: Date.now },
  isAdmin: { type: Boolean, default: false }
});

module.exports = mongoose.model('User', userSchema); // ✅ correct export
