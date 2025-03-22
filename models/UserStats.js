const mongoose = require("mongoose");

const userStatsSchema = new mongoose.Schema({
  telegramId: { type: Number, required: true, unique: true },
  username: String,
  firstName: String,
  points: { type: Number, default: 0 },
  messagesSent: { type: Number, default: 0 },
  lastMessageAt: Date
}, { timestamps: true });

module.exports = mongoose.model("UserStats", userStatsSchema);
