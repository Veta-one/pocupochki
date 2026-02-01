const express = require('express');
const { authMiddleware, devAuthMiddleware } = require('../middleware/auth');
const List = require('../models/List');
const Store = require('../models/Store');
const Item = require('../models/Item');
const ActionHistory = require('../models/ActionHistory');
const User = require('../models/User');

const router = express.Router();

// Middleware выбирается в зависимости от NODE_ENV
const auth = process.env.NODE_ENV === 'development' ? devAuthMiddleware : authMiddleware;

/**
 * GET /api/lists
 * Получить все списки пользователя (свои + shared)
 */
router.get('/', auth, async (req, res) => {
  try {
    const lists = await List.findAllForUser(req.user.telegramId);

    // Добавляем информацию о владельце
    const listsWithOwners = await Promise.all(lists.map(async (list) => {
      const owner = await User.findOne({ telegramId: list.ownerId });
      return {
        ...list.toObject(),
        ownerName: owner ? `${owner.firstName}${owner.lastName ? ' ' + owner.lastName : ''}` : 'Unknown',
        ownerUsername: owner?.username
      };
    }));

    res.json({ lists: listsWithOwners });
  } catch (error) {
    console.error('Get lists error:', error);
    res.status(500).json({ error: 'Failed to get lists' });
  }
});

/**
 * GET /api/lists/:id
 * Получить список с магазинами и товарами
 */
router.get('/:id', auth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);

    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    const access = list.hasAccess(req.user.telegramId);
    if (!access.access) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const [stores, items, history] = await Promise.all([
      Store.findByListId(list._id),
      Item.findByListId(list._id),
      ActionHistory.getRecent(list._id, 50)
    ]);

    // Информация о владельце и участниках
    const owner = await User.findOne({ telegramId: list.ownerId });
    const sharedUsers = await Promise.all(
      list.sharedWith.map(async (s) => {
        const user = await User.findOne({ telegramId: s.telegramId });
        return {
          telegramId: s.telegramId,
          canEdit: s.canEdit,
          firstName: user?.firstName,
          username: user?.username
        };
      })
    );

    res.json({
      list: {
        ...list.toObject(),
        ownerName: owner ? `${owner.firstName}${owner.lastName ? ' ' + owner.lastName : ''}` : 'Unknown',
        ownerUsername: owner?.username
      },
      stores,
      items,
      history,
      sharedWith: sharedUsers,
      access
    });

  } catch (error) {
    console.error('Get list error:', error);
    res.status(500).json({ error: 'Failed to get list' });
  }
});

/**
 * POST /api/lists
 * Создать новый список
 */
router.post('/', auth, async (req, res) => {
  try {
    const { name } = req.body;

    const list = await List.create({
      ownerId: req.user.telegramId,
      name: name || 'Новый список',
      isDefault: false
    });

    res.status(201).json({ list });

  } catch (error) {
    console.error('Create list error:', error);
    res.status(500).json({ error: 'Failed to create list' });
  }
});

/**
 * PATCH /api/lists/:id
 * Обновить список
 */
router.patch('/:id', auth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);

    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    const access = list.hasAccess(req.user.telegramId);
    if (!access.canEdit) {
      return res.status(403).json({ error: 'Edit access denied' });
    }

    const { name, activeStoreFilter } = req.body;

    if (name !== undefined) list.name = name;
    if (activeStoreFilter !== undefined) list.activeStoreFilter = activeStoreFilter;

    await list.save();

    res.json({ list });

  } catch (error) {
    console.error('Update list error:', error);
    res.status(500).json({ error: 'Failed to update list' });
  }
});

/**
 * DELETE /api/lists/:id
 * Удалить список
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);

    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    // Только владелец может удалить список
    if (list.ownerId !== req.user.telegramId) {
      return res.status(403).json({ error: 'Only owner can delete list' });
    }

    // Нельзя удалить default список
    if (list.isDefault) {
      return res.status(400).json({ error: 'Cannot delete default list' });
    }

    // Удаляем все связанные данные
    await Promise.all([
      Item.deleteMany({ listId: list._id }),
      Store.deleteMany({ listId: list._id }),
      ActionHistory.deleteMany({ listId: list._id }),
      list.deleteOne()
    ]);

    res.json({ success: true });

  } catch (error) {
    console.error('Delete list error:', error);
    res.status(500).json({ error: 'Failed to delete list' });
  }
});

/**
 * POST /api/lists/:id/share
 * Добавить пользователя к списку
 */
router.post('/:id/share', auth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);

    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    // Только владелец может делиться списком
    if (list.ownerId !== req.user.telegramId) {
      return res.status(403).json({ error: 'Only owner can share list' });
    }

    const { username, telegramId, canEdit = true } = req.body;

    // Находим пользователя по username или telegramId
    let targetUser;
    if (telegramId) {
      targetUser = await User.findOne({ telegramId });
    } else if (username) {
      const cleanUsername = username.replace('@', '');
      targetUser = await User.findOne({ username: cleanUsername });
    }

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (targetUser.telegramId === req.user.telegramId) {
      return res.status(400).json({ error: 'Cannot share with yourself' });
    }

    // Проверяем, не добавлен ли уже
    const alreadyShared = list.sharedWith.some(s => s.telegramId === targetUser.telegramId);
    if (alreadyShared) {
      return res.status(400).json({ error: 'User already has access' });
    }

    list.sharedWith.push({
      telegramId: targetUser.telegramId,
      canEdit
    });

    await list.save();

    res.json({
      list,
      addedUser: {
        telegramId: targetUser.telegramId,
        firstName: targetUser.firstName,
        username: targetUser.username
      }
    });

  } catch (error) {
    console.error('Share list error:', error);
    res.status(500).json({ error: 'Failed to share list' });
  }
});

/**
 * DELETE /api/lists/:id/share/:telegramId
 * Удалить пользователя из списка
 */
router.delete('/:id/share/:telegramId', auth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);

    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    const targetId = parseInt(req.params.telegramId, 10);

    // Владелец может удалить любого, участник может удалить себя
    if (list.ownerId !== req.user.telegramId && req.user.telegramId !== targetId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    list.sharedWith = list.sharedWith.filter(s => s.telegramId !== targetId);
    await list.save();

    res.json({ list });

  } catch (error) {
    console.error('Remove share error:', error);
    res.status(500).json({ error: 'Failed to remove user from list' });
  }
});

/**
 * POST /api/lists/:id/stores
 * Добавить магазин
 */
router.post('/:id/stores', auth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);

    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    const access = list.hasAccess(req.user.telegramId);
    if (!access.canEdit) {
      return res.status(403).json({ error: 'Edit access denied' });
    }

    const { name } = req.body;
    const store = await Store.createWithOrder(list._id, name);

    await ActionHistory.addEntry(
      list._id,
      req.user.telegramId,
      'ADD_STORE',
      { store: store.toObject() },
      `Добавлен магазин "${name}"`
    );

    res.status(201).json({ store });

  } catch (error) {
    console.error('Add store error:', error);
    res.status(500).json({ error: 'Failed to add store' });
  }
});

/**
 * POST /api/lists/:id/items
 * Добавить товар
 */
router.post('/:id/items', auth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);

    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    const access = list.hasAccess(req.user.telegramId);
    if (!access.canEdit) {
      return res.status(403).json({ error: 'Edit access denied' });
    }

    const item = await Item.createWithOrder({
      listId: list._id,
      ...req.body
    });

    await ActionHistory.addEntry(
      list._id,
      req.user.telegramId,
      'ADD_ITEM',
      { item: item.toObject() },
      `Добавлен товар "${item.name}"`
    );

    res.status(201).json({ item });

  } catch (error) {
    console.error('Add item error:', error);
    res.status(500).json({ error: 'Failed to add item' });
  }
});

/**
 * POST /api/lists/:id/items/bulk
 * Массовое добавление товаров (после голосовой команды)
 */
router.post('/:id/items/bulk', auth, async (req, res) => {
  try {
    const list = await List.findById(req.params.id);

    if (!list) {
      return res.status(404).json({ error: 'List not found' });
    }

    const access = list.hasAccess(req.user.telegramId);
    if (!access.canEdit) {
      return res.status(403).json({ error: 'Edit access denied' });
    }

    const { stores: storesData } = req.body;
    const createdItems = [];

    for (const storeData of storesData) {
      // Находим или создаём магазин
      let store = await Store.findOne({ listId: list._id, name: storeData.name });
      if (!store) {
        store = await Store.createWithOrder(list._id, storeData.name);
      }

      // Добавляем товары
      for (const itemData of storeData.items) {
        // Проверяем существующий товар
        const existingItem = await Item.findOne({
          listId: list._id,
          storeId: store._id,
          name: itemData.name,
          purchased: false
        });

        if (existingItem) {
          // Обновляем существующий
          if (itemData.quantity > 0) existingItem.quantity = itemData.quantity;
          if (itemData.unit) existingItem.unit = itemData.unit;
          if (itemData.emoji) existingItem.emoji = itemData.emoji;
          if (itemData.notes) existingItem.notes = itemData.notes;
          await existingItem.save();
          createdItems.push(existingItem);
        } else {
          // Создаём новый
          const item = await Item.createWithOrder({
            listId: list._id,
            storeId: store._id,
            ...itemData
          });
          createdItems.push(item);
        }
      }
    }

    // Записываем в историю
    await ActionHistory.addEntry(
      list._id,
      req.user.telegramId,
      'VOICE_COMMAND_UPDATE',
      { itemsCount: createdItems.length },
      `Добавлено ${createdItems.length} товаров голосовой командой`
    );

    res.json({ items: createdItems });

  } catch (error) {
    console.error('Bulk add items error:', error);
    res.status(500).json({ error: 'Failed to add items' });
  }
});

module.exports = router;
