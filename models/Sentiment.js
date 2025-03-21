const mongoose = require('mongoose');

const sentimentSchema = new mongoose.Schema({
  userId: Number,
  username: String,
  text: String,
  score: Number,
  sentiment: String,
  timestamp: Date
});

module.exports = mongoose.model('Sentiment', sentimentSchema);
