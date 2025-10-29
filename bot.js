const TelegramBot = require('node-telegram-bot-api');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Simple in-memory storage
let pollData = {
  isActive: false,
  messageId: null,
  courts: {
    courtA: { players: [], max: 12, emoji: '🟢', name: 'Court A — Teams 1 & 2 🏐' },
    courtB: { players: [], max: 12, emoji: '🔵', name: 'Court B — Teams 3 & 4 🏐' },
    courtC: { players: [], max: 12, emoji: '🔴', name: 'Court C — Teams 5 & 6 🏐' }
  }
};

// Bot token from environment variable
const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Store group chat ID
const GROUP_CHAT_ID = process.env.CHAT_ID || '-5040590820';

// Start web server (required for Railway)
app.get('/', (req, res) => {
  res.send('VolleyBot is running!');
});

app.listen(PORT, () => {
  console.log(`Bot server running on port ${PORT}`);
});

// Generate poll message with buttons
function generatePollMessage() {
  let message = `👋 Hey! Ready for another Volley🏐 on the court?\n📅 This Sunday from 10:00 to 13:00\n⚡ Pick your court below and join the game — all levels welcome!\n\n`;
  
  Object.keys(pollData.courts).forEach(courtKey => {
    const court = pollData.courts[courtKey];
    message += `${court.emoji} ${court.name} (${court.players.length}/${court.max})\n`;
  });
  
  return message;
}

// Generate inline keyboard
function generateKeyboard() {
  return {
    inline_keyboard: [
      [
        { 
          text: `${pollData.courts.courtA.emoji} Court A (${pollData.courts.courtA.players.length}/${pollData.courts.courtA.max})`, 
          callback_data: 'courtA' 
        }
      ],
      [
        { 
          text: `${pollData.courts.courtB.emoji} Court B (${pollData.courts.courtB.players.length}/${pollData.courts.courtB.max})`, 
          callback_data: 'courtB' 
        }
      ],
      [
        { 
          text: `${pollData.courts.courtC.emoji} Court C (${pollData.courts.courtC.players.length}/${pollData.courts.courtC.max})`, 
          callback_data: 'courtC' 
        }
      ],
      [
        { text: '🚫 Leave Court', callback_data: 'leave' }
      ]
    ]
  };
}

// Handle /newmatch command
bot.onText(/\/newmatch/, (msg) => {
  if (msg.chat.id.toString() === GROUP_CHAT_ID.replace('-', '-100')) {
    resetPoll();
    
    const message = generatePollMessage();
    const keyboard = generateKeyboard();
    
    bot.sendMessage(GROUP_CHAT_ID, message, { 
      reply_markup: keyboard,
      parse_mode: 'Markdown'
    }).then(sentMessage => {
      pollData.messageId = sentMessage.message_id;
      pollData.isActive = true;
    });
  }
});

// Handle button clicks
bot.on('callback_query', (query) => {
  const userId = query.from.id;
  const username = query.from.username ? `@${query.from.username}` : query.from.first_name;
  const courtKey = query.data;
  
  if (!pollData.isActive) {
    bot.answerCallbackQuery(query.id, { text: '❌ No active poll found!' });
    return;
  }
  
  if (courtKey === 'leave') {
    leaveCourt(userId, username, query);
    return;
  }
  
  if (pollData.courts[courtKey]) {
    joinCourt(userId, username, courtKey, query);
  }
});

// Handle player joining a court
function joinCourt(userId, username, courtKey, query) {
  const court = pollData.courts[courtKey];
  
  // Remove player from any other court
  Object.keys(pollData.courts).forEach(key => {
    const otherCourt = pollData.courts[key];
    const playerIndex = otherCourt.players.findIndex(p => p.id === userId);
    if (playerIndex !== -1) {
      otherCourt.players.splice(playerIndex, 1);
    }
  });
  
  // Check if court is full
  if (court.players.length >= court.max) {
    bot.answerCallbackQuery(query.id, { 
      text: `❌ ${court.emoji} ${court.name.split('—')[0]} is full! Please choose another court.` 
    });
    return;
  }
  
  // Add player to court
  if (!court.players.find(p => p.id === userId)) {
    court.players.push({ id: userId, username: username });
  }
  
  // Update message
  updatePollMessage();
  
  // Send confirmation
  bot.answerCallbackQuery(query.id, { 
    text: `✅ You joined ${court.emoji} ${court.name.split('—')[0]}` 
  });
  
  // Announce join
  bot.sendMessage(GROUP_CHAT_ID, 
    `✅ ${username} joined ${court.emoji} ${court.name.split('—')[0]} (${court.players.length}/${court.max})`
  );
  
  // Check if court became full
  if (court.players.length === court.max) {
    bot.sendMessage(GROUP_CHAT_ID, 
      `🟢 ${court.name.split('—')[0]} is now full! Please vote for other courts.`
    );
  }
  
  checkAllCourtsFull();
}

// Handle player leaving
function leaveCourt(userId, username, query) {
  let leftCourt = null;
  
  Object.keys(pollData.courts).forEach(courtKey => {
    const court = pollData.courts[courtKey];
    const playerIndex = court.players.findIndex(p => p.id === userId);
    
    if (playerIndex !== -1) {
      leftCourt = court;
      court.players.splice(playerIndex, 1);
    }
  });
  
  if (leftCourt) {
    updatePollMessage();
    bot.answerCallbackQuery(query.id, { text: `✅ You left ${leftCourt.emoji} ${leftCourt.name.split('—')[0]}` });
    
    bot.sendMessage(GROUP_CHAT_ID, 
      `♻️ ${username} left ${leftCourt.emoji} ${leftCourt.name.split('—')[0]}. Spot reopened (${leftCourt.players.length}/${leftCourt.max})`
    );
  } else {
    bot.answerCallbackQuery(query.id, { text: '❌ You are not in any court!' });
  }
}

// Update the poll message
function updatePollMessage() {
  if (!pollData.messageId) return;
  
  const message = generatePollMessage();
  const keyboard = generateKeyboard();
  
  bot.editMessageText(message, {
    chat_id: GROUP_CHAT_ID,
    message_id: pollData.messageId,
    reply_markup: keyboard,
    parse_mode: 'Markdown'
  }).catch(error => {
    console.log('Error updating message:', error.message);
  });
}

// Check if all courts are full
function checkAllCourtsFull() {
  const allFull = Object.keys(pollData.courts).every(courtKey => {
    return pollData.courts[courtKey].players.length >= pollData.courts[courtKey].max;
  });
  
  if (allFull && pollData.isActive) {
    pollData.isActive = false;
    bot.sendMessage(GROUP_CHAT_ID, '🚫 Poll closed! Thanks everyone — see you on Sunday 🏐💪');
  }
}

// Handle /status command
bot.onText(/\/status/, (msg) => {
  if (msg.chat.id.toString() === GROUP_CHAT_ID.replace('-', '-100')) {
    let statusMessage = '📊 **Current Status:**\n\n';
    
    Object.keys(pollData.courts).forEach(courtKey => {
      const court = pollData.courts[courtKey];
      statusMessage += `${court.emoji} **${court.name}** (${court.players.length}/${court.max}):\n`;
      
      if (court.players.length > 0) {
        court.players.forEach((player, index) => {
          statusMessage += `${index + 1}. ${player.username}\n`;
        });
      } else {
        statusMessage += `No players yet\n`;
      }
      statusMessage += '\n';
    });
    
    bot.sendMessage(GROUP_CHAT_ID, statusMessage, { parse_mode: 'Markdown' });
  }
});

// Handle /closepoll command
bot.onText(/\/closepoll/, (msg) => {
  if (msg.chat.id.toString() === GROUP_CHAT_ID.replace('-', '-100')) {
    pollData.isActive = false;
    bot.sendMessage(GROUP_CHAT_ID, '🚫 Poll manually closed by admin.');
  }
});

// Reset poll data
function resetPoll() {
  pollData = {
    isActive: false,
    messageId: null,
    courts: {
      courtA: { players: [], max: 12, emoji: '🟢', name: 'Court A — Teams 1 & 2 🏐' },
      courtB: { players: [], max: 12, emoji: '🔵', name: 'Court B — Teams 3 & 4 🏐' },
      courtC: { players: [], max: 12, emoji: '🔴', name: 'Court C — Teams 5 & 6 🏐' }
    }
  };
}

console.log('🏐 VolleyBot is running...');
