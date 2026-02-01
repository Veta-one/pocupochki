const mongoose = require('mongoose');

const actionHistorySchema = new mongoose.Schema({
  listId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'List',
    required: true,
    index: true
  },
  userId: {
    type: Number, // telegramId
    required: true
  },
  actionType: {
    type: String,
    required: true,
    enum: [
      'ADD_ITEM',
      'DELETE_ITEM',
      'UPDATE_ITEM',
      'TOGGLE_PURCHASED',
      'MOVE_ITEM',
      'ADD_STORE',
      'DELETE_STORE',
      'UPDATE_STORE_NAME',
      'VOICE_COMMAND_UPDATE',
      'CLEAR_PURCHASED',
      'PERMANENTLY_DELETE_PURCHASED'
    ]
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 дней
    index: { expireAfterSeconds: 0 } // TTL индекс
  }
});

// Составной индекс для получения истории
actionHistorySchema.index({ listId: 1, timestamp: -1 });

// Статический метод для добавления записи
actionHistorySchema.statics.addEntry = async function(listId, userId, actionType, payload, description = '') {
  return this.create({
    listId,
    userId,
    actionType,
    payload,
    description
  });
};

// Статический метод для получения последних N записей
actionHistorySchema.statics.getRecent = async function(listId, limit = 50) {
  return this.find({ listId })
    .sort({ timestamp: -1 })
    .limit(limit);
};

// Статический метод для отмены последнего действия
actionHistorySchema.statics.popLast = async function(listId) {
  const lastAction = await this.findOneAndDelete({ listId }, { sort: { timestamp: -1 } });
  return lastAction;
};

module.exports = mongoose.model('ActionHistory', actionHistorySchema);
