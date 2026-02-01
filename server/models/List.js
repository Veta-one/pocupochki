const mongoose = require('mongoose');

const sharedWithSchema = new mongoose.Schema({
  telegramId: {
    type: Number,
    required: true
  },
  canEdit: {
    type: Boolean,
    default: true
  },
  addedAt: {
    type: Date,
    default: Date.now
  }
}, { _id: false });

const listSchema = new mongoose.Schema({
  ownerId: {
    type: Number,
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    default: 'Мой список'
  },
  activeStoreFilter: {
    type: String,
    default: 'Все'
  },
  isDefault: {
    type: Boolean,
    default: false
  },
  sharedWith: [sharedWithSchema],
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Индекс для поиска списков, к которым есть доступ
listSchema.index({ 'sharedWith.telegramId': 1 });
listSchema.index({ ownerId: 1, isDefault: 1 });

// Обновить updatedAt при сохранении
listSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

// Статический метод для получения всех списков пользователя (свои + shared)
listSchema.statics.findAllForUser = async function(telegramId) {
  return this.find({
    $or: [
      { ownerId: telegramId },
      { 'sharedWith.telegramId': telegramId }
    ]
  }).sort({ isDefault: -1, updatedAt: -1 });
};

// Метод для проверки доступа
listSchema.methods.hasAccess = function(telegramId) {
  if (this.ownerId === telegramId) return { access: true, canEdit: true, isOwner: true };

  const shared = this.sharedWith.find(s => s.telegramId === telegramId);
  if (shared) return { access: true, canEdit: shared.canEdit, isOwner: false };

  return { access: false, canEdit: false, isOwner: false };
};

// Статический метод для создания дефолтного списка
listSchema.statics.createDefaultList = async function(telegramId) {
  return this.create({
    ownerId: telegramId,
    name: 'Мой список',
    isDefault: true
  });
};

module.exports = mongoose.model('List', listSchema);
