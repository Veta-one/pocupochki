const express = require('express');
const { authMiddleware, devAuthMiddleware } = require('../middleware/auth');
const { processVoiceCommand, processTextCommand } = require('../services/openrouterService');
const List = require('../models/List');
const Store = require('../models/Store');
const Item = require('../models/Item');
const ActionHistory = require('../models/ActionHistory');
const { notifyAdmin } = require('../services/telegramBot');

const router = express.Router();

const auth = process.env.NODE_ENV === 'development' ? devAuthMiddleware : authMiddleware;

/**
 * POST /api/voice/process
 * Обработка голосовой команды
 */
router.post('/process', auth, async (req, res) => {
  try {
    const { audioBase64, mimeType, listId, text } = req.body;

    // Проверяем доступ к списку
    const list = await List.findById(listId);
    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    const access = list.hasAccess(req.user.telegramId);
    if (!access.canEdit) {
      return res.status(403).json({ error: 'Edit access denied' });
    }

    // Получаем текущие товары
    const currentItems = await Item.find({ listId, purchased: false }).populate('storeId');
    const itemsForPrompt = currentItems.map(item => ({
      id: item._id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      notes: item.notes,
      storeName: item.storeId?.name || 'Другое'
    }));

    let result;

    // Обрабатываем голос или текст
    if (audioBase64 && mimeType) {
      result = await processVoiceCommand(audioBase64, mimeType, itemsForPrompt);
    } else if (text) {
      result = await processTextCommand(text, itemsForPrompt);
    } else {
      return res.status(400).json({ error: 'audioBase64/mimeType or text is required' });
    }

    // Проверяем на ошибку
    if (result.error) {
      return res.status(400).json({ error: result.error });
    }

    // Применяем изменения
    const createdItems = [];
    const updatedItems = [];

    if (result.stores) {
      for (const storeData of result.stores) {
        // Находим или создаём магазин
        let store = await Store.findOne({ listId: list._id, name: storeData.name });
        if (!store) {
          store = await Store.createWithOrder(list._id, storeData.name);
        }

        // Обрабатываем товары
        for (const itemData of storeData.items) {
          // Ищем существующий товар в этом магазине
          let existingItem = await Item.findOne({
            listId: list._id,
            storeId: store._id,
            name: { $regex: new RegExp(`^${escapeRegex(itemData.name)}$`, 'i') },
            purchased: false
          });

          // Или ищем в любом магазине
          if (!existingItem) {
            existingItem = await Item.findOne({
              listId: list._id,
              name: { $regex: new RegExp(`^${escapeRegex(itemData.name)}$`, 'i') },
              purchased: false
            });
          }

          if (existingItem) {
            // Обновляем существующий
            if (itemData.quantity > 0) existingItem.quantity = itemData.quantity;
            if (itemData.unit) existingItem.unit = itemData.unit;
            if (itemData.emoji) existingItem.emoji = itemData.emoji;
            if (itemData.notes) existingItem.notes = itemData.notes;
            // Перемещаем в новый магазин если нужно
            existingItem.storeId = store._id;
            await existingItem.save();
            updatedItems.push(existingItem);
          } else {
            // Создаём новый
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
      req.user.telegramId,
      'VOICE_COMMAND_UPDATE',
      {
        created: createdItems.map(i => i._id),
        updated: updatedItems.map(i => i._id)
      },
      `Голосовая команда: создано ${createdItems.length}, обновлено ${updatedItems.length}`
    );

    // Уведомляем админа об использовании API (опционально, можно убрать)
    // notifyAdmin(`🎤 @${req.user.username || req.user.firstName} использовал голосовой ввод`);

    // Получаем обновлённые данные
    const [stores, items, history] = await Promise.all([
      Store.findByListId(list._id),
      Item.findByListId(list._id),
      ActionHistory.getRecent(list._id, 50)
    ]);

    res.json({
      success: true,
      created: createdItems.length,
      updated: updatedItems.length,
      stores,
      items,
      history
    });

  } catch (error) {
    console.error('Voice processing error:', error);
    res.status(500).json({ error: 'Failed to process voice command' });
  }
});

/**
 * Экранирование специальных символов для регулярного выражения
 */
function escapeRegex(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = router;
