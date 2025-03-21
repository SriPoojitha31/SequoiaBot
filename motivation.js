// motivation.js

const motivationalQuotes = [
    "Push yourself, because no one else is going to do it for you 💪",
    "Success doesn’t just find you. You have to go out and get it 🚀",
    "Dream it. Wish it. Do it 🔥",
    "Great things never come from comfort zones ⚡",
    "Believe you can and you're halfway there 🌟",
    "Stay positive, work hard, make it happen ✨"
  ];
  
  function getMotivationalQuote() {
    const randomIndex = Math.floor(Math.random() * motivationalQuotes.length);
    return motivationalQuotes[randomIndex];
  }
  
  module.exports = { getMotivationalQuote };
  