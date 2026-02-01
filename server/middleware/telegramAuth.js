const crypto = require('crypto');

/**
 * Валидация Telegram InitData
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function validateInitData(initData, botToken) {
  if (!initData || !botToken) {
    return { valid: false, error: 'Missing initData or botToken' };
  }

  try {
    const urlParams = new URLSearchParams(initData);
    const hash = urlParams.get('hash');

    if (!hash) {
      return { valid: false, error: 'Missing hash in initData' };
    }

    urlParams.delete('hash');

    // Сортировка параметров по алфавиту и создание data-check-string
    const dataCheckString = [...urlParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n');

    // HMAC-SHA256 с секретным ключом
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    const calculatedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    if (calculatedHash !== hash) {
      return { valid: false, error: 'Invalid hash' };
    }

    // Проверка времени (initData действителен в течение 24 часов)
    const authDate = urlParams.get('auth_date');
    if (authDate) {
      const authTimestamp = parseInt(authDate, 10) * 1000;
      const now = Date.now();
      const maxAge = 24 * 60 * 60 * 1000; // 24 часа

      if (now - authTimestamp > maxAge) {
        return { valid: false, error: 'InitData expired' };
      }
    }

    // Извлечение данных пользователя
    const userStr = urlParams.get('user');
    let user = null;

    if (userStr) {
      try {
        user = JSON.parse(userStr);
      } catch (e) {
        return { valid: false, error: 'Invalid user data' };
      }
    }

    return {
      valid: true,
      user,
      queryId: urlParams.get('query_id'),
      authDate: authDate ? new Date(parseInt(authDate, 10) * 1000) : null
    };

  } catch (error) {
    return { valid: false, error: error.message };
  }
}

/**
 * Парсинг initData без валидации (для dev mode)
 */
function parseInitDataUnsafe(initData) {
  try {
    const urlParams = new URLSearchParams(initData);
    const userStr = urlParams.get('user');

    if (userStr) {
      return JSON.parse(userStr);
    }

    return null;
  } catch (error) {
    return null;
  }
}

module.exports = {
  validateInitData,
  parseInitDataUnsafe
};
