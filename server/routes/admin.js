const express = require('express');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const User = require('../models/User');
const List = require('../models/List');
const Item = require('../models/Item');
const Store = require('../models/Store');
const ActionHistory = require('../models/ActionHistory');

const router = express.Router();

// Все роуты требуют авторизации и прав админа
router.use(authMiddleware);
router.use(adminMiddleware);

/**
 * GET /api/admin/stats
 * Общая статистика
 */
router.get('/stats', async (req, res) => {
  try {
    const [
      totalUsers,
      activeUsers,
      bannedUsers,
      totalLists,
      totalItems,
      totalStores
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({
        lastActiveAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }),
      User.countDocuments({ isBanned: true }),
      List.countDocuments(),
      Item.countDocuments(),
      Store.countDocuments()
    ]);

    // Статистика за последние 24 часа
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [newUsersToday, actionsToday] = await Promise.all([
      User.countDocuments({ createdAt: { $gte: oneDayAgo } }),
      ActionHistory.countDocuments({ timestamp: { $gte: oneDayAgo } })
    ]);

    res.json({
      totalUsers,
      activeUsers,
      bannedUsers,
      totalLists,
      totalItems,
      totalStores,
      newUsersToday,
      actionsToday
    });

  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

/**
 * GET /api/admin/users
 * Список пользователей
 */
router.get('/users', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, banned } = req.query;

    const query = {};

    if (search) {
      query.$or = [
        { username: { $regex: search, $options: 'i' } },
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } }
      ];
    }

    if (banned === 'true') {
      query.isBanned = true;
    } else if (banned === 'false') {
      query.isBanned = false;
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .sort({ lastActiveAt: -1 })
        .skip((page - 1) * limit)
        .limit(parseInt(limit)),
      User.countDocuments(query)
    ]);

    // Добавляем статистику для каждого пользователя
    const usersWithStats = await Promise.all(users.map(async (user) => {
      const [listsCount, itemsCount] = await Promise.all([
        List.countDocuments({ ownerId: user.telegramId }),
        Item.countDocuments({
          listId: { $in: await List.find({ ownerId: user.telegramId }).select('_id') }
        })
      ]);

      return {
        ...user.toObject(),
        listsCount,
        itemsCount
      };
    }));

    res.json({
      users: usersWithStats,
      total,
      page: parseInt(page),
      totalPages: Math.ceil(total / limit)
    });

  } catch (error) {
    console.error('Admin get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

/**
 * GET /api/admin/users/:telegramId
 * Детальная информация о пользователе
 */
router.get('/users/:telegramId', async (req, res) => {
  try {
    const telegramId = parseInt(req.params.telegramId, 10);
    const user = await User.findOne({ telegramId });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [lists, recentActions] = await Promise.all([
      List.find({ ownerId: telegramId }),
      ActionHistory.find({ userId: telegramId })
        .sort({ timestamp: -1 })
        .limit(20)
    ]);

    res.json({
      user,
      lists,
      recentActions
    });

  } catch (error) {
    console.error('Admin get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

/**
 * POST /api/admin/users/:telegramId/ban
 * Забанить пользователя
 */
router.post('/users/:telegramId/ban', async (req, res) => {
  try {
    const telegramId = parseInt(req.params.telegramId, 10);
    const { reason } = req.body;

    const user = await User.findOne({ telegramId });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.isAdmin) {
      return res.status(400).json({ error: 'Cannot ban an admin' });
    }

    user.isBanned = true;
    user.banReason = reason || 'Не указана';
    await user.save();

    res.json({
      message: 'User banned successfully',
      user
    });

  } catch (error) {
    console.error('Admin ban user error:', error);
    res.status(500).json({ error: 'Failed to ban user' });
  }
});

/**
 * POST /api/admin/users/:telegramId/unban
 * Разбанить пользователя
 */
router.post('/users/:telegramId/unban', async (req, res) => {
  try {
    const telegramId = parseInt(req.params.telegramId, 10);
    const user = await User.findOne({ telegramId });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.isBanned = false;
    user.banReason = null;
    await user.save();

    res.json({
      message: 'User unbanned successfully',
      user
    });

  } catch (error) {
    console.error('Admin unban user error:', error);
    res.status(500).json({ error: 'Failed to unban user' });
  }
});

/**
 * POST /api/admin/users/:telegramId/make-admin
 * Сделать пользователя администратором
 */
router.post('/users/:telegramId/make-admin', async (req, res) => {
  try {
    const telegramId = parseInt(req.params.telegramId, 10);
    const user = await User.findOne({ telegramId });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    user.isAdmin = true;
    await user.save();

    res.json({
      message: 'User is now admin',
      user
    });

  } catch (error) {
    console.error('Admin make-admin error:', error);
    res.status(500).json({ error: 'Failed to make user admin' });
  }
});

/**
 * DELETE /api/admin/users/:telegramId
 * Удалить пользователя и все его данные
 */
router.delete('/users/:telegramId', async (req, res) => {
  try {
    const telegramId = parseInt(req.params.telegramId, 10);
    const user = await User.findOne({ telegramId });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.isAdmin) {
      return res.status(400).json({ error: 'Cannot delete an admin' });
    }

    // Удаляем все данные пользователя
    const lists = await List.find({ ownerId: telegramId });

    for (const list of lists) {
      await Promise.all([
        Item.deleteMany({ listId: list._id }),
        Store.deleteMany({ listId: list._id }),
        ActionHistory.deleteMany({ listId: list._id })
      ]);
    }

    await List.deleteMany({ ownerId: telegramId });

    // Удаляем из sharedWith других списков
    await List.updateMany(
      { 'sharedWith.telegramId': telegramId },
      { $pull: { sharedWith: { telegramId } } }
    );

    await user.deleteOne();

    res.json({
      message: 'User and all data deleted successfully'
    });

  } catch (error) {
    console.error('Admin delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
