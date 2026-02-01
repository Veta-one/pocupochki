const jwt = require('jsonwebtoken');
const User = require('../models/User');

// JWT секрет (берётся из env или генерируется)
const getJwtSecret = () => {
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }
  // Генерируем секрет из токена бота для консистентности
  return require('crypto')
    .createHash('sha256')
    .update(process.env.TELEGRAM_BOT_TOKEN || 'default-secret')
    .digest('hex');
};

/**
 * Создание JWT токена
 */
function createToken(user) {
  const payload = {
    telegramId: user.telegramId,
    username: user.username,
    isAdmin: user.isAdmin
  };

  return jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' });
}

/**
 * Верификация JWT токена
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, getJwtSecret());
  } catch (error) {
    return null;
  }
}

/**
 * Middleware для защиты роутов
 */
async function authMiddleware(req, res, next) {
  try {
    // Получаем токен из заголовка
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = verifyToken(token);

    if (!decoded) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Находим пользователя в БД
    const user = await User.findOne({ telegramId: decoded.telegramId });

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    if (user.isBanned) {
      return res.status(403).json({ error: 'User is banned', reason: user.banReason });
    }

    // Обновляем lastActiveAt
    user.lastActiveAt = new Date();
    await user.save();

    // Добавляем пользователя в request
    req.user = user;
    next();

  } catch (error) {
    console.error('Auth middleware error:', error);
    return res.status(500).json({ error: 'Authentication error' });
  }
}

/**
 * Middleware для проверки прав администратора
 */
function adminMiddleware(req, res, next) {
  if (!req.user || !req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

/**
 * Dev mode middleware - позволяет обойти авторизацию в development
 */
async function devAuthMiddleware(req, res, next) {
  // Если указан токен - используем обычную авторизацию
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authMiddleware(req, res, next);
  }

  // В dev mode создаём тестового пользователя
  if (process.env.NODE_ENV === 'development') {
    const devUser = await User.findOne({ telegramId: 1 });
    if (devUser) {
      req.user = devUser;
      return next();
    }

    // Создаём dev пользователя если его нет
    const { user } = await User.findOrCreateFromTelegram({
      id: 1,
      first_name: 'Dev',
      last_name: 'User',
      username: 'devuser'
    });
    req.user = user;
    return next();
  }

  return res.status(401).json({ error: 'No token provided' });
}

module.exports = {
  createToken,
  verifyToken,
  authMiddleware,
  adminMiddleware,
  devAuthMiddleware
};
