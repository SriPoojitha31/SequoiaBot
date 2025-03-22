const mongoose = require("mongoose");

// Configuration constants (adjust as needed)
const REQUEST_TIME_WINDOW = 60 * 1000; // 1 minute in milliseconds
const MAX_REQUESTS_PER_MINUTE = 5;

// Admin Telegram IDs 
const adminIds = [5559338907];
const groupId = '-1002570334546';

const userSchema = new mongoose.Schema({
    telegramId: {
        type: Number,
        required: true,
        unique: true
    },
    username: {
        type: String
    },
    joinedAt: {
        type: Date,
        default: Date.now
    },
    isAdmin: {
        type: Boolean,
        default: false
    },
    lastRequestTime: {
        type: Date,
        default: null
    },
    requestCount: {
        type: Number,
        default: 0
    },
    totalRequests: {
        type: Number,
        default: 0
    },
    banned: {
        type: Boolean,
        default: false
    },
    banReason: {
        type: String,
        default: ""
    },
    credits: {
        type: Number,
        default: 10
    }
});

// Method to check if user is rate limited
userSchema.methods.isRateLimited = function () {
    if (this.isAdmin || adminIds.includes(this.telegramId)) return false; // Admins bypass rate limiting

    const now = new Date();
    if (!this.lastRequestTime) return false;

    const timeElapsed = now - this.lastRequestTime;
    return timeElapsed < REQUEST_TIME_WINDOW && this.requestCount >= MAX_REQUESTS_PER_MINUTE;
};

// Method to update request count
userSchema.methods.updateRequestCount = function () {
    const now = new Date();

    // Reset count if outside time window
    if (!this.lastRequestTime || (now - this.lastRequestTime) >= REQUEST_TIME_WINDOW) {
        this.requestCount = 1;
    } else {
        this.requestCount += 1;
    }

    this.lastRequestTime = now;
    this.totalRequests += 1;
    return this.save();
};

// Method to check if user is admin
userSchema.methods.checkAdmin = function () {
    return this.isAdmin || adminIds.includes(this.telegramId);
};

// Method to add credits
userSchema.methods.addCredits = function (amount) {
    this.credits += amount;
    return this.save();
};

// Method to use one credit
userSchema.methods.useCredit = function () {
    if (this.credits <= 0) return false;
    this.credits -= 1;
    return this.save();
};

module.exports = mongoose.model("User", userSchema);
