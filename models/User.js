const mongoose = require("mongoose");

// Configuration constants (adjust as needed)
const REQUEST_TIME_WINDOW = 60 * 1000; // 1 minute in milliseconds
const MAX_REQUESTS_PER_MINUTE = 5;

// Admin Telegram IDs
const adminIds = [5559338907];
const groupId = '-1002570334546';

// User Schema Definition
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

// Method: Check if user is rate-limited
userSchema.methods.isRateLimited = function () {
    if (this.isAdmin || adminIds.includes(this.telegramId)) return false; // Admins bypass rate limiting
    const now = new Date();

    // If there's no request time recorded, not rate limited
    if (!this.lastRequestTime) return false;

    const timeElapsed = now - this.lastRequestTime;
    // Return true if within time window and request count exceeded
    return timeElapsed < REQUEST_TIME_WINDOW && this.requestCount >= MAX_REQUESTS_PER_MINUTE;
};

// Method: Update request count, resets if outside of the time window
userSchema.methods.updateRequestCount = async function () {
    const now = new Date();

    // Reset count if outside time window
    if (!this.lastRequestTime || (now - this.lastRequestTime) >= REQUEST_TIME_WINDOW) {
        this.requestCount = 1; // Reset to 1 for first request in new time window
    } else {
        this.requestCount += 1; // Increment the request count
    }

    // Set the last request time to now, and increment total request count
    this.lastRequestTime = now;
    this.totalRequests += 1;

    return this.save(); // Save the updated user document
};

// Method: Check if user is an admin
userSchema.methods.checkAdmin = function () {
    return this.isAdmin || adminIds.includes(this.telegramId);
};

// Method: Add credits to a user
userSchema.methods.addCredits = async function (amount) {
    this.credits += amount;
    return this.save(); // Save updated credits to the database
};

// Method: Use a credit, returns false if no credits remaining
userSchema.methods.useCredit = async function () {
    if (this.credits <= 0) return false; // Insufficient credits to use
    this.credits -= 1; // Deduct one credit
    return this.save(); // Save the updated credits
};

// Chat Log Schema Definition
const chatLogSchema = new mongoose.Schema({
    telegramId: {
        type: Number,
        required: true
    },
    message: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now // Defaults to the current date/time
    },
});

// ChatLog Model
const ChatLog = mongoose.model("ChatLog", chatLogSchema);

// User Model
const User = mongoose.model("User", userSchema);

module.exports = {
    User,
    ChatLog
};