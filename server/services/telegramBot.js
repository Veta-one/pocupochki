const TelegramBot = require('node-telegram-bot-api');
const User = require('../models/User');
const List = require('../models/List');

let bot = null;
let adminId = null;

/**
 * Инициализация бота
 */
function initBot(webhookUrl = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;

  if (!token) {
    console.error('TELEGRAM_BOT_TOKEN is not set');
    return null;
  }

  // В production используем webhook, в development - polling
  if (webhookUrl || process.env.NODE_ENV === 'production') {
    bot = new TelegramBot(token);

    if (webhookUrl) {
      bot.setWebHook(webhookUrl).then(() => {
        console.log('Telegram webhook set to:', webhookUrl);
      }).catch(err => {
        console.error('Failed to set webhook:', err);
      });
    }
  } else {
    bot = new TelegramBot(token, { polling: true });
    console.log('Telegram bot started with polling');
  }

  // Загружаем admin ID из env или БД
  adminId = process.env.ADMIN_TELEGRAM_ID ? parseInt(process.env.ADMIN_TELEGRAM_ID, 10) : null;

  setupHandlers();

  return bot;
}

/**
 * Настройка обработчиков команд
 */
function setupHandlers() {
  if (!bot) return;

  // /start - регистрация и приветствие
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramUser = msg.from;

    try {
      const { user, isNew } = await User.findOrCreateFromTelegram(telegramUser);

      // Если это первый пользователь - сохраняем его как админа
      if (user.isAdmin && !adminId) {
        adminId = user.telegramId;
      }

      // Создаём дефолтный список если его нет
      const existingList = await List.findOne({ ownerId: user.telegramId, isDefault: true });
      if (!existingList) {
        await List.createDefaultList(user.telegramId);
      }

      // Уведомляем админа о новом пользователе
      if (isNew && adminId && adminId !== user.telegramId) {
        notifyAdmin(
          `🆕 Новый пользователь!\n\n` +
          `👤 ${user.firstName}${user.lastName ? ' ' + user.lastName : ''}\n` +
          `📛 @${user.username || 'без username'}\n` +
          `🆔 ID: ${user.telegramId}\n` +
          `🌐 Язык: ${user.languageCode}`
        );
      }

      // Приветственное сообщение
      const welcomeText = isNew
        ? `Привет, ${user.firstName}! 👋\n\n` +
          `Добро пожаловать в Pocupochki - умный список покупок с голосовым управлением!\n\n` +
          `🎤 Диктуйте список голосом\n` +
          `✅ Отмечайте купленное одним тапом\n` +
          `👥 Делитесь списком с семьёй\n\n` +
          `Нажмите кнопку ниже, чтобы открыть приложение.`
        : `С возвращением, ${user.firstName}! 👋\n\n` +
          `Нажмите кнопку ниже, чтобы открыть список покупок.`;

      const keyboard = {
        inline_keyboard: [[
          {
            text: '🛒 Открыть список покупок',
            web_app: { url: process.env.WEBAPP_URL || 'https://shop.vetaone.site' }
          }
        ]]
      };

      await bot.sendMessage(chatId, welcomeText, { reply_markup: keyboard });

    } catch (error) {
      console.error('Error in /start handler:', error);
      await bot.sendMessage(chatId, 'Произошла ошибка. Попробуйте позже.');
    }
  });

  // /help - справка
  bot.onText(/\/help/, async (msg) => {
    const helpText = `📖 *Справка по Pocupochki*\n\n` +
      `*Как использовать:*\n` +
      `1️⃣ Нажмите кнопку "Открыть список покупок"\n` +
      `2️⃣ Диктуйте товары голосом или добавляйте вручную\n` +
      `3️⃣ Тапните на товар, чтобы отметить как купленный\n\n` +
      `*Голосовые команды:*\n` +
      `"Купить молоко 2 литра, хлеб, яйца 10 штук"\n` +
      `"В Пятёрочке нужны помидоры и огурцы"\n\n` +
      `*Команды бота:*\n` +
      `/start - Открыть приложение\n` +
      `/share - Поделиться списком\n` +
      `/help - Эта справка`;

    await bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'Markdown' });
  });

  // /share - управление доступом
  bot.onText(/\/share/, async (msg) => {
    const chatId = msg.chat.id;

    const keyboard = {
      inline_keyboard: [
        [{ text: '➕ Пригласить пользователя', callback_data: 'share_invite' }],
        [{ text: '👥 Мои участники', callback_data: 'share_list' }],
        [{ text: '🚪 Покинуть чужой список', callback_data: 'share_leave' }]
      ]
    };

    await bot.sendMessage(
      chatId,
      '👥 *Управление доступом к списку*\n\nВыберите действие:',
      { parse_mode: 'Markdown', reply_markup: keyboard }
    );
  });

  // /admin - панель администратора
  bot.onText(/\/admin/, async (msg) => {
    const user = await User.findOne({ telegramId: msg.from.id });

    if (!user || !user.isAdmin) {
      await bot.sendMessage(msg.chat.id, '⛔ У вас нет прав администратора.');
      return;
    }

    const stats = await getStats();

    const adminText = `🛠 *Панель администратора*\n\n` +
      `👥 Пользователей: ${stats.totalUsers}\n` +
      `📋 Списков: ${stats.totalLists}\n` +
      `📦 Товаров: ${stats.totalItems}\n` +
      `🚫 Забанено: ${stats.bannedUsers}`;

    const keyboard = {
      inline_keyboard: [
        [{ text: '👥 Список пользователей', callback_data: 'admin_users' }],
        [{ text: '📊 Подробная статистика', callback_data: 'admin_stats' }]
      ]
    };

    await bot.sendMessage(msg.chat.id, adminText, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
  });

  // /ban <user_id> <reason> - забанить пользователя
  bot.onText(/\/ban (\d+)(.*)/, async (msg, match) => {
    const admin = await User.findOne({ telegramId: msg.from.id });

    if (!admin || !admin.isAdmin) {
      await bot.sendMessage(msg.chat.id, '⛔ У вас нет прав администратора.');
      return;
    }

    const targetId = parseInt(match[1], 10);
    const reason = match[2]?.trim() || 'Не указана';

    const targetUser = await User.findOne({ telegramId: targetId });

    if (!targetUser) {
      await bot.sendMessage(msg.chat.id, '❌ Пользователь не найден.');
      return;
    }

    if (targetUser.isAdmin) {
      await bot.sendMessage(msg.chat.id, '❌ Нельзя забанить администратора.');
      return;
    }

    targetUser.isBanned = true;
    targetUser.banReason = reason;
    await targetUser.save();

    await bot.sendMessage(
      msg.chat.id,
      `✅ Пользователь ${targetUser.firstName} (@${targetUser.username || 'нет'}) забанен.\nПричина: ${reason}`
    );
  });

  // /unban <user_id> - разбанить пользователя
  bot.onText(/\/unban (\d+)/, async (msg, match) => {
    const admin = await User.findOne({ telegramId: msg.from.id });

    if (!admin || !admin.isAdmin) {
      await bot.sendMessage(msg.chat.id, '⛔ У вас нет прав администратора.');
      return;
    }

    const targetId = parseInt(match[1], 10);
    const targetUser = await User.findOne({ telegramId: targetId });

    if (!targetUser) {
      await bot.sendMessage(msg.chat.id, '❌ Пользователь не найден.');
      return;
    }

    targetUser.isBanned = false;
    targetUser.banReason = null;
    await targetUser.save();

    await bot.sendMessage(
      msg.chat.id,
      `✅ Пользователь ${targetUser.firstName} (@${targetUser.username || 'нет'}) разбанен.`
    );
  });

  // Обработка callback_query
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    try {
      if (data === 'share_invite') {
        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(
          chatId,
          '📨 Отправьте @username пользователя, которого хотите пригласить:\n\n' +
          'Например: @username'
        );
      }

      if (data === 'share_list') {
        const user = await User.findOne({ telegramId: query.from.id });
        const lists = await List.find({ ownerId: user.telegramId });

        let text = '👥 *Участники ваших списков:*\n\n';

        for (const list of lists) {
          if (list.sharedWith.length > 0) {
            text += `📋 *${list.name}*:\n`;
            for (const shared of list.sharedWith) {
              const sharedUser = await User.findOne({ telegramId: shared.telegramId });
              text += `  • ${sharedUser?.firstName || 'Неизвестный'} (@${sharedUser?.username || 'нет'})\n`;
            }
            text += '\n';
          }
        }

        if (text === '👥 *Участники ваших списков:*\n\n') {
          text = '👤 У вас пока нет участников в списках.\n\nИспользуйте "Пригласить пользователя", чтобы добавить кого-то.';
        }

        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      }

      if (data === 'admin_users') {
        const admin = await User.findOne({ telegramId: query.from.id });
        if (!admin?.isAdmin) {
          await bot.answerCallbackQuery(query.id, { text: '⛔ Нет доступа' });
          return;
        }

        const users = await User.find().sort({ lastActiveAt: -1 }).limit(20);
        let text = '👥 *Последние пользователи:*\n\n';

        for (const u of users) {
          const status = u.isBanned ? '🚫' : (u.isAdmin ? '👑' : '👤');
          text += `${status} ${u.firstName} (@${u.username || 'нет'})\n`;
          text += `   ID: \`${u.telegramId}\`\n\n`;
        }

        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
      }

    } catch (error) {
      console.error('Callback query error:', error);
      await bot.answerCallbackQuery(query.id, { text: 'Ошибка' });
    }
  });
}

/**
 * Получение статистики
 */
async function getStats() {
  const User = require('../models/User');
  const List = require('../models/List');
  const Item = require('../models/Item');

  const [totalUsers, totalLists, totalItems, bannedUsers] = await Promise.all([
    User.countDocuments(),
    List.countDocuments(),
    Item.countDocuments(),
    User.countDocuments({ isBanned: true })
  ]);

  return { totalUsers, totalLists, totalItems, bannedUsers };
}

/**
 * Отправка уведомления администратору
 */
function notifyAdmin(message) {
  if (!bot || !adminId) return;

  bot.sendMessage(adminId, message).catch(err => {
    console.error('Failed to notify admin:', err);
  });
}

/**
 * Обработка webhook запроса
 */
function processUpdate(update) {
  if (bot) {
    bot.processUpdate(update);
  }
}

/**
 * Получение экземпляра бота
 */
function getBot() {
  return bot;
}

module.exports = {
  initBot,
  processUpdate,
  getBot,
  notifyAdmin
};
