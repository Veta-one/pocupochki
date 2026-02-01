const TelegramBot = require('node-telegram-bot-api');
const User = require('../models/User');
const List = require('../models/List');
const Store = require('../models/Store');
const Item = require('../models/Item');
const ActionHistory = require('../models/ActionHistory');
const { processTextCommand, processImageCommand } = require('./openrouterService');

let bot = null;
let adminId = null;

// Состояния пользователей для диалогов (chatId -> state)
const userStates = new Map();

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

  // Обработка голосовых сообщений
  bot.on('voice', async (msg) => {
    const chatId = msg.chat.id;
    const telegramUser = msg.from;

    try {
      // Проверяем/создаём пользователя
      const { user } = await User.findOrCreateFromTelegram(telegramUser);

      if (user.isBanned) {
        await bot.sendMessage(chatId, '⛔ Ваш аккаунт заблокирован.');
        return;
      }

      // Получаем дефолтный список
      let list = await List.findOne({ ownerId: user.telegramId, isDefault: true });
      if (!list) {
        list = await List.createDefaultList(user.telegramId);
      }

      // Проверяем есть ли транскрипция от Telegram Premium
      // В новых версиях API транскрипция может прийти отдельным сообщением
      // Пока отправляем инструкцию
      await bot.sendMessage(
        chatId,
        '🎤 Голосовое сообщение получено!\n\n' +
        'Для обработки голосовых сообщений, пожалуйста, отправьте *текстом* что нужно добавить в список.\n\n' +
        'Например: "молоко 2 литра, хлеб, яйца 10 штук"',
        { parse_mode: 'Markdown' }
      );

    } catch (error) {
      console.error('Voice message error:', error);
      await bot.sendMessage(chatId, '❌ Ошибка обработки голосового сообщения.');
    }
  });

  // Обработка изображений (фото списков, скриншоты товаров)
  bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const telegramUser = msg.from;

    try {
      // Проверяем/создаём пользователя
      const { user } = await User.findOrCreateFromTelegram(telegramUser);

      if (user.isBanned) {
        await bot.sendMessage(chatId, '⛔ Ваш аккаунт заблокирован.');
        return;
      }

      // Получаем дефолтный список
      let list = await List.findOne({ ownerId: user.telegramId, isDefault: true });
      if (!list) {
        list = await List.createDefaultList(user.telegramId);
      }

      // Отправляем статус
      const statusMsg = await bot.sendMessage(chatId, '🖼 Анализирую изображение...');

      // Получаем файл (берём самый большой размер)
      const photo = msg.photo[msg.photo.length - 1];
      const file = await bot.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

      // Скачиваем изображение
      const imageResponse = await fetch(fileUrl);
      const imageBuffer = await imageResponse.arrayBuffer();
      const imageBase64 = Buffer.from(imageBuffer).toString('base64');

      // Определяем MIME тип
      const mimeType = file.file_path.endsWith('.png') ? 'image/png' : 'image/jpeg';

      // Получаем текущие товары
      const currentItems = await Item.find({ listId: list._id, purchased: false }).populate('storeId');
      const itemsForPrompt = currentItems.map(item => ({
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        storeName: item.storeId?.name || 'Другое'
      }));

      // Обрабатываем через AI
      const result = await processImageCommand(imageBase64, mimeType, itemsForPrompt);

      if (result.error) {
        await bot.editMessageText('❌ ' + result.error, {
          chat_id: chatId,
          message_id: statusMsg.message_id
        });
        return;
      }

      // Применяем изменения
      const createdItems = [];

      if (result.stores) {
        for (const storeData of result.stores) {
          let store = await Store.findOne({ listId: list._id, name: storeData.name });
          if (!store) {
            store = await Store.createWithOrder(list._id, storeData.name);
          }

          for (const itemData of storeData.items) {
            // Проверяем нет ли уже такого товара
            const existingItem = await Item.findOne({
              listId: list._id,
              name: { $regex: new RegExp(`^${escapeRegex(itemData.name)}$`, 'i') },
              purchased: false
            });

            if (!existingItem) {
              const newItem = await Item.createWithOrder({
                listId: list._id,
                storeId: store._id,
                name: itemData.name,
                quantity: itemData.quantity || 0,
                unit: itemData.unit || '',
                emoji: itemData.emoji || '',
                notes: itemData.notes || ''
              });
              createdItems.push(newItem);
            }
          }
        }
      }

      // Записываем в историю
      if (createdItems.length > 0) {
        await ActionHistory.addEntry(
          list._id,
          user.telegramId,
          'TELEGRAM_IMAGE_COMMAND',
          { created: createdItems.map(i => i._id) },
          `Изображение: добавлено ${createdItems.length} товаров`
        );

        // Broadcast через WebSocket
        try {
          const { broadcastListUpdate } = require('./websocket');
          await broadcastListUpdate(list._id.toString());
        } catch (e) {
          console.warn('WebSocket broadcast failed:', e.message);
        }
      }

      // Формируем ответ
      let responseText;
      if (createdItems.length > 0) {
        responseText = `✅ Добавлено товаров: ${createdItems.length}\n\n`;
        createdItems.forEach(item => {
          responseText += `• ${item.emoji || '📦'} ${item.name}`;
          if (item.quantity > 0) responseText += ` (${item.quantity} ${item.unit || 'шт'})`;
          responseText += '\n';
        });
      } else {
        responseText = '📋 Товары на изображении уже есть в списке или не удалось распознать новые.';
      }

      const keyboard = {
        inline_keyboard: [[
          {
            text: '🛒 Открыть список',
            web_app: { url: process.env.WEBAPP_URL || 'https://shop.vetaone.site' }
          }
        ]]
      };

      await bot.editMessageText(responseText, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        reply_markup: keyboard
      });

    } catch (error) {
      console.error('Photo message error:', error);
      await bot.sendMessage(chatId, '❌ Ошибка обработки изображения. Попробуйте позже.');
    }
  });

  // Команда /cancel для отмены текущего действия
  bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id;
    if (userStates.has(chatId)) {
      userStates.delete(chatId);
      await bot.sendMessage(chatId, '❌ Действие отменено.');
    } else {
      await bot.sendMessage(chatId, 'Нечего отменять.');
    }
  });

  // Обработка текстовых сообщений (не команд)
  bot.on('text', async (msg) => {
    // Игнорируем команды
    if (msg.text.startsWith('/')) return;

    const chatId = msg.chat.id;
    const telegramUser = msg.from;
    const text = msg.text.trim();

    // Проверяем состояние пользователя
    const state = userStates.get(chatId);

    // Обработка ввода username для приглашения
    if (state?.action === 'waiting_invite_username') {
      userStates.delete(chatId);

      try {
        const { user } = await User.findOrCreateFromTelegram(telegramUser);

        // Получаем дефолтный список владельца
        const list = await List.findOne({ ownerId: user.telegramId, isDefault: true });
        if (!list) {
          await bot.sendMessage(chatId, '❌ У вас нет списка для приглашения.');
          return;
        }

        // Ищем пользователя по username
        const cleanUsername = text.replace('@', '').trim();
        const targetUser = await User.findOne({ username: cleanUsername });

        if (!targetUser) {
          await bot.sendMessage(
            chatId,
            `❌ Пользователь @${cleanUsername} не найден.\n\n` +
            'Убедитесь, что пользователь уже запускал бота командой /start.'
          );
          return;
        }

        if (targetUser.telegramId === user.telegramId) {
          await bot.sendMessage(chatId, '❌ Нельзя пригласить самого себя.');
          return;
        }

        // Проверяем, не добавлен ли уже
        const alreadyShared = list.sharedWith.some(s => s.telegramId === targetUser.telegramId);
        if (alreadyShared) {
          await bot.sendMessage(chatId, `⚠️ @${cleanUsername} уже имеет доступ к вашему списку.`);
          return;
        }

        // Добавляем пользователя
        list.sharedWith.push({
          telegramId: targetUser.telegramId,
          canEdit: true
        });
        await list.save();

        await bot.sendMessage(
          chatId,
          `✅ Пользователь @${cleanUsername} добавлен в ваш список!\n\n` +
          `Теперь он может видеть и редактировать список "${list.name}".`
        );

        // Уведомляем приглашённого пользователя
        try {
          await bot.sendMessage(
            targetUser.telegramId,
            `📬 Вас пригласили в список покупок!\n\n` +
            `👤 ${user.firstName} (@${user.username || 'нет'}) поделился с вами списком "${list.name}".\n\n` +
            `Откройте приложение, чтобы увидеть общий список.`,
            {
              reply_markup: {
                inline_keyboard: [[{
                  text: '🛒 Открыть список',
                  web_app: { url: process.env.WEBAPP_URL || 'https://shop.vetaone.site' }
                }]]
              }
            }
          );
        } catch (e) {
          // Пользователь мог заблокировать бота
          console.warn('Could not notify invited user:', e.message);
        }

      } catch (error) {
        console.error('Invite user error:', error);
        await bot.sendMessage(chatId, '❌ Ошибка при добавлении пользователя.');
      }
      return;
    }

    // Игнорируем пустые и короткие сообщения
    if (text.length < 2) return;

    try {
      // Проверяем/создаём пользователя
      const { user } = await User.findOrCreateFromTelegram(telegramUser);

      if (user.isBanned) {
        await bot.sendMessage(chatId, '⛔ Ваш аккаунт заблокирован.');
        return;
      }

      // Получаем дефолтный список
      let list = await List.findOne({ ownerId: user.telegramId, isDefault: true });
      if (!list) {
        list = await List.createDefaultList(user.telegramId);
      }

      // Отправляем статус
      const statusMsg = await bot.sendMessage(chatId, '⏳ Обрабатываю...');

      // Получаем текущие товары для контекста
      const currentItems = await Item.find({ listId: list._id, purchased: false }).populate('storeId');
      const itemsForPrompt = currentItems.map(item => ({
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        notes: item.notes,
        storeName: item.storeId?.name || 'Другое'
      }));

      // Обрабатываем через AI
      const result = await processTextCommand(text, itemsForPrompt);

      if (result.error) {
        await bot.editMessageText('❌ Не удалось распознать команду.', {
          chat_id: chatId,
          message_id: statusMsg.message_id
        });
        return;
      }

      // Применяем изменения
      const createdItems = [];
      const updatedItems = [];

      if (result.stores) {
        for (const storeData of result.stores) {
          let store = await Store.findOne({ listId: list._id, name: storeData.name });
          if (!store) {
            store = await Store.createWithOrder(list._id, storeData.name);
          }

          for (const itemData of storeData.items) {
            let existingItem = await Item.findOne({
              listId: list._id,
              name: { $regex: new RegExp(`^${escapeRegex(itemData.name)}$`, 'i') },
              purchased: false
            });

            if (existingItem) {
              if (itemData.quantity > 0) existingItem.quantity = itemData.quantity;
              if (itemData.unit) existingItem.unit = itemData.unit;
              if (itemData.emoji) existingItem.emoji = itemData.emoji;
              if (itemData.notes) existingItem.notes = itemData.notes;
              existingItem.storeId = store._id;
              await existingItem.save();
              updatedItems.push(existingItem);
            } else {
              const newItem = await Item.createWithOrder({
                listId: list._id,
                storeId: store._id,
                name: itemData.name,
                quantity: itemData.quantity || 0,
                unit: itemData.unit || '',
                emoji: itemData.emoji || '',
                notes: itemData.notes || ''
              });
              createdItems.push(newItem);
            }
          }
        }
      }

      // Записываем в историю
      await ActionHistory.addEntry(
        list._id,
        user.telegramId,
        'TELEGRAM_TEXT_COMMAND',
        { created: createdItems.map(i => i._id), updated: updatedItems.map(i => i._id) },
        `Telegram: создано ${createdItems.length}, обновлено ${updatedItems.length}`
      );

      // Broadcast через WebSocket
      try {
        const { broadcastListUpdate } = require('./websocket');
        await broadcastListUpdate(list._id.toString());
      } catch (e) {
        console.warn('WebSocket broadcast failed:', e.message);
      }

      // Формируем ответ
      const totalAdded = createdItems.length + updatedItems.length;
      let responseText = `✅ Добавлено товаров: ${totalAdded}\n\n`;

      if (createdItems.length > 0) {
        responseText += '🆕 *Новые:*\n';
        createdItems.forEach(item => {
          responseText += `• ${item.emoji || '📦'} ${item.name}`;
          if (item.quantity > 0) responseText += ` (${item.quantity} ${item.unit || 'шт'})`;
          responseText += '\n';
        });
      }

      if (updatedItems.length > 0) {
        responseText += '\n✏️ *Обновлены:*\n';
        updatedItems.forEach(item => {
          responseText += `• ${item.emoji || '📦'} ${item.name}`;
          if (item.quantity > 0) responseText += ` (${item.quantity} ${item.unit || 'шт'})`;
          responseText += '\n';
        });
      }

      const keyboard = {
        inline_keyboard: [[
          {
            text: '🛒 Открыть список',
            web_app: { url: process.env.WEBAPP_URL || 'https://shop.vetaone.site' }
          }
        ]]
      };

      await bot.editMessageText(responseText, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });

    } catch (error) {
      console.error('Text message processing error:', error);
      await bot.sendMessage(chatId, '❌ Ошибка обработки сообщения. Попробуйте позже.');
    }
  });

  // Обработка callback_query
  bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    try {
      if (data === 'share_invite') {
        // Устанавливаем состояние ожидания ввода username
        userStates.set(chatId, { action: 'waiting_invite_username' });

        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(
          chatId,
          '📨 Отправьте @username пользователя, которого хотите пригласить:\n\n' +
          'Например: @username\n\n' +
          '_Для отмены отправьте /cancel_',
          { parse_mode: 'Markdown' }
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

      if (data === 'share_leave') {
        const user = await User.findOne({ telegramId: query.from.id });
        // Находим списки, где пользователь приглашён (не владелец)
        const sharedLists = await List.find({
          'sharedWith.telegramId': user.telegramId
        });

        if (sharedLists.length === 0) {
          await bot.answerCallbackQuery(query.id);
          await bot.sendMessage(chatId, '📋 Вы не состоите в чужих списках.');
          return;
        }

        const keyboard = {
          inline_keyboard: sharedLists.map(list => ([{
            text: `🚪 Покинуть "${list.name}"`,
            callback_data: `leave_list_${list._id}`
          }]))
        };

        await bot.answerCallbackQuery(query.id);
        await bot.sendMessage(
          chatId,
          '📋 *Выберите список, который хотите покинуть:*',
          { parse_mode: 'Markdown', reply_markup: keyboard }
        );
      }

      // Обработка выхода из конкретного списка
      if (data.startsWith('leave_list_')) {
        const listId = data.replace('leave_list_', '');
        const list = await List.findById(listId);

        if (list) {
          list.sharedWith = list.sharedWith.filter(
            s => s.telegramId !== query.from.id
          );
          await list.save();

          await bot.answerCallbackQuery(query.id, { text: '✅ Вы покинули список' });
          await bot.sendMessage(chatId, `✅ Вы покинули список "${list.name}".`);
        } else {
          await bot.answerCallbackQuery(query.id, { text: '❌ Список не найден' });
        }
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

/**
 * Экранирование специальных символов для регулярного выражения
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  initBot,
  processUpdate,
  getBot,
  notifyAdmin
};
