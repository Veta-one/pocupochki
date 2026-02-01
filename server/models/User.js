const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  telegramId: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  username: {
    type: String,
    default: null
  },
  firstName: {
    type: String,
    required: true
  },
  lastName: {
    type: String,
    default: null
  },
  languageCode: {
    type: String,
    default: 'ru'
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  banReason: {
    type: String,
    default: null
  },
  settings: {
    notificationsEnabled: {
      type: Boolean,
      default: true
    },
    theme: {
      type: String,
      enum: ['auto', 'light', 'dark'],
      default: 'auto'
    }
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  lastActiveAt: {
    type: Date,
    default: Date.now
  }
});

// Обновить lastActiveAt при каждом сохранении
userSchema.pre('save', function(next) {
  this.lastActiveAt = new Date();
  next();
});

// Статический метод для поиска или создания пользователя
userSchema.statics.findOrCreateFromTelegram = async function(telegramUser) {
  let user = await this.findOne({ telegramId: telegramUser.id });

  if (!user) {
    // Проверяем, есть ли уже пользователи (первый становится админом)
    const usersCount = await this.countDocuments();
    const isFirstUser = usersCount === 0;

    user = await this.create({
      telegramId: telegramUser.id,
      username: telegramUser.username || null,
      firstName: telegramUser.first_name,
      lastName: telegramUser.last_name || null,
      languageCode: telegramUser.language_code || 'ru',
      isAdmin: isFirstUser
    });

    return { user, isNew: true };
  }

  // Обновляем данные пользователя
  user.username = telegramUser.username || user.username;
  user.firstName = telegramUser.first_name;
  user.lastName = telegramUser.last_name || user.lastName;
  user.lastActiveAt = new Date();
  await user.save();

  return { user, isNew: false };
};

module.exports = mongoose.model('User', userSchema);
