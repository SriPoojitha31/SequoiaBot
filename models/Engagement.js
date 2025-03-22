const mongoose = require('mongoose');

const engagementSchema = new mongoose.Schema({
  userId: String,
  points: Number,
  // Add other fields if needed
});

module.exports = mongoose.model('Engagement', engagementSchema);
