const express = require('express');
const { validateInitData } = require('../middleware/telegramAuth');
const { createToken } = require('../middleware/auth');
const User = require('../models/User');
const List = require('../models/List');
const { notifyAdmin } = require('../services/telegramBot');

const router = express.Router();

/**
 * POST /api/auth/telegram
 * Авторизация через Telegram InitData
 */
router.post('/telegram', async (req, res) => {
  try {
    const { initData } = req.body;

    // Dev mode - создаём тестового пользователя
    if (process.env.NODE_ENV === 'development' && !initData) {
      const { user, isNew } = await User.findOrCreateFromTelegram({
        id: 1,
        first_name: 'Dev',
        last_name: 'User',
        username: 'devuser'
      });

      // Создаём дефолтный список если нужно
      let defaultList = await List.findOne({ ownerId: user.telegramId, isDefault: true });
      if (!defaultList) {
        defaultList = await List.createDefaultList(user.telegramId);
      }

      const token = createToken(user);

      return res.json({
        token,
        user: {
          telegramId: user.telegramId,
          username: user.username,
          firstName: user.firstName,
          lastName: user.lastName,
          isAdmin: user.isAdmin
        },
        defaultListId: defaultList._id
      });
    }

    // Валидация InitData
    if (!initData) {
      return res.status(400).json({ error: 'initData is required' });
    }

    const validation = validateInitData(initData, process.env.TELEGRAM_BOT_TOKEN);

    if (!validation.valid) {
      return res.status(401).json({ error: validation.error });
    }

    if (!validation.user) {
      return res.status(401).json({ error: 'User data not found in initData' });
    }

    // Находим или создаём пользователя
    const { user, isNew } = await User.findOrCreateFromTelegram(validation.user);

    // Проверяем бан
    if (user.isBanned) {
      return res.status(403).json({
        error: 'User is banned',
        reason: user.banReason
      });
    }

    // Создаём дефолтный список если нужно
    let defaultList = await List.findOne({ ownerId: user.telegramId, isDefault: true });
    if (!defaultList) {
      defaultList = await List.createDefaultList(user.telegramId);
    }

    // Уведомляем админа о новом пользователе
    if (isNew) {
      notifyAdmin(
        `🆕 Новый пользователь (через Web App)!\n\n` +
        `👤 ${user.firstName}${user.lastName ? ' ' + user.lastName : ''}\n` +
        `📛 @${user.username || 'без username'}\n` +
        `🆔 ID: ${user.telegramId}`
      );
    }

    // Создаём токен
    const token = createToken(user);

    res.json({
      token,
      user: {
        telegramId: user.telegramId,
        username: user.username,
        firstName: user.firstName,
        lastName: user.lastName,
        isAdmin: user.isAdmin
      },
      defaultListId: defaultList._id
    });

  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

module.exports = router;
