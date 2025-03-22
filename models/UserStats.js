const mongoose = require("mongoose");

const UserStatsSchema = new mongoose.Schema({
    telegramId: { type: Number, required: true, unique: true },
    username: String,
    firstName: String,
    messageCount: { type: Number, default: 0 },
    points: { type: Number, default: 0 },
});

module.exports = mongoose.model("UserStats", UserStatsSchema);
