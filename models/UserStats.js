// models/UserStats.js
const mongoose = require('mongoose');

const UserStatsSchema = new mongoose.Schema({
  userId: Number,
  username: String,
  firstName: String,
  messageCount: {
    type: Number,
    default: 0
  }
});

module.exports = mongoose.model("UserStats", UserStatsSchema);
