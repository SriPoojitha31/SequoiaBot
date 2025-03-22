// When creating userStates
userStates[telegramId] = {
  step: "name",
  createdAt: Date.now()
};

// In message handler, clean up if stale (e.g., older than 5 minutes)
const state = userStates[telegramId];
if (state && Date.now() - state.createdAt > 5 * 60 * 1000) {
  delete userStates[telegramId];
  return bot.sendMessage(chatId, "⚠️ Session timed out. Please type /start to begin onboarding again.");
}
