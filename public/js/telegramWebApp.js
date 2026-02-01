// Telegram Web App SDK Integration
// https://core.telegram.org/bots/webapps

const tg = window.Telegram?.WebApp;

// Состояние
let isInitialized = false;
let currentUser = null;

/**
 * Инициализация Telegram Web App
 * @returns {Object|null} Данные пользователя или null если не в Telegram
 */
export function initTelegramWebApp() {
  if (!tg) {
    console.warn('Telegram WebApp SDK not available. Running in dev mode.');
    return null;
  }

  if (isInitialized) {
    return {
      user: tg.initDataUnsafe?.user,
      initData: tg.initData
    };
  }

  try {
    // Сообщаем Telegram что приложение готово
    tg.ready();

    // Раскрываем на весь экран
    tg.expand();

    // Применяем тему Telegram
    applyTelegramTheme();

    // Настраиваем кнопку "Назад"
    setupBackButton();

    // Слушаем изменения темы
    tg.onEvent('themeChanged', applyTelegramTheme);

    // Слушаем изменения viewport
    tg.onEvent('viewportChanged', handleViewportChange);

    isInitialized = true;

    currentUser = tg.initDataUnsafe?.user;

    console.log('Telegram WebApp initialized', {
      platform: tg.platform,
      colorScheme: tg.colorScheme,
      user: currentUser?.first_name
    });

    return {
      user: currentUser,
      initData: tg.initData
    };

  } catch (error) {
    console.error('Failed to initialize Telegram WebApp:', error);
    return null;
  }
}

/**
 * Применение темы Telegram к приложению
 */
function applyTelegramTheme() {
  if (!tg?.themeParams) return;

  const root = document.documentElement;
  const params = tg.themeParams;

  // Основные цвета
  if (params.bg_color) {
    root.style.setProperty('--tg-theme-bg-color', params.bg_color);
  }
  if (params.text_color) {
    root.style.setProperty('--tg-theme-text-color', params.text_color);
  }
  if (params.hint_color) {
    root.style.setProperty('--tg-theme-hint-color', params.hint_color);
  }
  if (params.link_color) {
    root.style.setProperty('--tg-theme-link-color', params.link_color);
  }
  if (params.button_color) {
    root.style.setProperty('--tg-theme-button-color', params.button_color);
  }
  if (params.button_text_color) {
    root.style.setProperty('--tg-theme-button-text-color', params.button_text_color);
  }
  if (params.secondary_bg_color) {
    root.style.setProperty('--tg-theme-secondary-bg-color', params.secondary_bg_color);
  }
  if (params.header_bg_color) {
    root.style.setProperty('--tg-theme-header-bg-color', params.header_bg_color);
  }
  if (params.accent_text_color) {
    root.style.setProperty('--tg-theme-accent-text-color', params.accent_text_color);
  }
  if (params.section_bg_color) {
    root.style.setProperty('--tg-theme-section-bg-color', params.section_bg_color);
  }
  if (params.section_header_text_color) {
    root.style.setProperty('--tg-theme-section-header-text-color', params.section_header_text_color);
  }
  if (params.subtitle_text_color) {
    root.style.setProperty('--tg-theme-subtitle-text-color', params.subtitle_text_color);
  }
  if (params.destructive_text_color) {
    root.style.setProperty('--tg-theme-destructive-text-color', params.destructive_text_color);
  }

  // Устанавливаем класс темы
  document.body.classList.remove('theme-light', 'theme-dark');
  document.body.classList.add(`theme-${tg.colorScheme || 'dark'}`);
}

/**
 * Настройка кнопки "Назад"
 */
let backButtonCallback = null;

function setupBackButton() {
  if (!tg?.BackButton) return;

  tg.BackButton.onClick(() => {
    if (backButtonCallback) {
      backButtonCallback();
    }
  });
}

/**
 * Показать кнопку "Назад" с callback
 */
export function showBackButton(callback) {
  if (!tg?.BackButton) return;

  backButtonCallback = callback;
  tg.BackButton.show();
}

/**
 * Скрыть кнопку "Назад"
 */
export function hideBackButton() {
  if (!tg?.BackButton) return;

  backButtonCallback = null;
  tg.BackButton.hide();
}

/**
 * Обработка изменения viewport
 */
function handleViewportChange(event) {
  // Можно добавить логику для обработки клавиатуры и т.д.
  console.log('Viewport changed:', event);
}

/**
 * Показать Main Button
 */
export function showMainButton(text, callback, options = {}) {
  if (!tg?.MainButton) return;

  tg.MainButton.setText(text);

  if (options.color) {
    tg.MainButton.color = options.color;
  }
  if (options.textColor) {
    tg.MainButton.textColor = options.textColor;
  }

  tg.MainButton.onClick(callback);
  tg.MainButton.show();

  if (options.progress) {
    tg.MainButton.showProgress();
  }
}

/**
 * Скрыть Main Button
 */
export function hideMainButton() {
  if (!tg?.MainButton) return;
  tg.MainButton.hide();
  tg.MainButton.hideProgress();
}

/**
 * Обновить текст Main Button
 */
export function updateMainButton(text, showProgress = false) {
  if (!tg?.MainButton) return;

  tg.MainButton.setText(text);

  if (showProgress) {
    tg.MainButton.showProgress();
  } else {
    tg.MainButton.hideProgress();
  }
}

/**
 * Haptic feedback
 */
export function hapticFeedback(type = 'impact', style = 'medium') {
  if (!tg?.HapticFeedback) return;

  switch (type) {
    case 'impact':
      tg.HapticFeedback.impactOccurred(style); // light, medium, heavy, rigid, soft
      break;
    case 'notification':
      tg.HapticFeedback.notificationOccurred(style); // success, warning, error
      break;
    case 'selection':
      tg.HapticFeedback.selectionChanged();
      break;
  }
}

/**
 * Показать popup
 */
export function showPopup(title, message, buttons = []) {
  if (!tg?.showPopup) {
    alert(`${title}\n\n${message}`);
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    tg.showPopup({
      title,
      message,
      buttons: buttons.length ? buttons : [{ type: 'ok' }]
    }, (buttonId) => {
      resolve(buttonId);
    });
  });
}

/**
 * Показать confirm
 */
export function showConfirm(message) {
  if (!tg?.showConfirm) {
    return Promise.resolve(confirm(message));
  }

  return new Promise((resolve) => {
    tg.showConfirm(message, (confirmed) => {
      resolve(confirmed);
    });
  });
}

/**
 * Показать alert
 */
export function showAlert(message) {
  if (!tg?.showAlert) {
    alert(message);
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    tg.showAlert(message, resolve);
  });
}

/**
 * Закрыть Web App
 */
export function closeWebApp() {
  if (tg?.close) {
    tg.close();
  }
}

/**
 * Получить InitData для авторизации
 */
export function getInitData() {
  return tg?.initData || null;
}

/**
 * Получить данные пользователя
 */
export function getUser() {
  return currentUser || tg?.initDataUnsafe?.user || null;
}

/**
 * Проверить, запущено ли в Telegram
 */
export function isTelegramWebApp() {
  return !!tg && !!tg.initData;
}

/**
 * Получить платформу
 */
export function getPlatform() {
  return tg?.platform || 'unknown';
}

/**
 * Получить цветовую схему
 */
export function getColorScheme() {
  return tg?.colorScheme || 'dark';
}

/**
 * Открыть ссылку во внутреннем браузере Telegram
 */
export function openLink(url, options = {}) {
  if (tg?.openLink) {
    tg.openLink(url, options);
  } else {
    window.open(url, '_blank');
  }
}

/**
 * Открыть Telegram ссылку (профиль, канал и т.д.)
 */
export function openTelegramLink(url) {
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(url);
  } else {
    window.open(url, '_blank');
  }
}

/**
 * Запросить контакт пользователя
 */
export function requestContact() {
  if (!tg?.requestContact) {
    return Promise.reject(new Error('Not supported'));
  }

  return new Promise((resolve, reject) => {
    tg.requestContact((shared, contact) => {
      if (shared) {
        resolve(contact);
      } else {
        reject(new Error('Contact not shared'));
      }
    });
  });
}

/**
 * Экспорт объекта tg для прямого доступа
 */
export const telegram = tg;
