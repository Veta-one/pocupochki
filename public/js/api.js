// API Client для взаимодействия с сервером

const API_BASE = '/api';

let authToken = null;
let currentUser = null;
let defaultListId = null;

/**
 * Установить токен авторизации
 */
export function setAuthToken(token) {
  authToken = token;
  if (token) {
    localStorage.setItem('authToken', token);
  } else {
    localStorage.removeItem('authToken');
  }
}

/**
 * Получить токен из localStorage
 */
export function getStoredToken() {
  return localStorage.getItem('authToken');
}

/**
 * Получить текущего пользователя
 */
export function getCurrentUser() {
  return currentUser;
}

/**
 * Получить ID дефолтного списка
 */
export function getDefaultListId() {
  return defaultListId;
}

/**
 * Базовый fetch с авторизацией
 */
async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers
    });

    // Если токен истёк - пробуем обновить
    if (response.status === 401) {
      const data = await response.json();
      if (data.error === 'Invalid or expired token') {
        // Удаляем токен и перенаправляем на авторизацию
        setAuthToken(null);
        window.dispatchEvent(new CustomEvent('auth-required'));
      }
      throw new Error(data.error || 'Unauthorized');
    }

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `HTTP error ${response.status}`);
    }

    return response.json();
  } catch (error) {
    console.error(`API error (${endpoint}):`, error);
    throw error;
  }
}

// ==================== Auth ====================

/**
 * Авторизация через Telegram InitData
 */
export async function authenticate(initData) {
  const data = await apiFetch('/auth/telegram', {
    method: 'POST',
    body: JSON.stringify({ initData })
  });

  authToken = data.token;
  currentUser = data.user;
  defaultListId = data.defaultListId;

  setAuthToken(data.token);

  return data;
}

/**
 * Dev mode авторизация (без Telegram)
 */
export async function authenticateDev() {
  const data = await apiFetch('/auth/telegram', {
    method: 'POST',
    body: JSON.stringify({})
  });

  authToken = data.token;
  currentUser = data.user;
  defaultListId = data.defaultListId;

  setAuthToken(data.token);

  return data;
}

// ==================== Lists ====================

/**
 * Получить все списки пользователя
 */
export async function getLists() {
  return apiFetch('/lists');
}

/**
 * Получить список с товарами и магазинами
 */
export async function getList(listId) {
  return apiFetch(`/lists/${listId}`);
}

/**
 * Создать новый список
 */
export async function createList(name) {
  return apiFetch('/lists', {
    method: 'POST',
    body: JSON.stringify({ name })
  });
}

/**
 * Обновить список
 */
export async function updateList(listId, updates) {
  return apiFetch(`/lists/${listId}`, {
    method: 'PATCH',
    body: JSON.stringify(updates)
  });
}

/**
 * Удалить список
 */
export async function deleteList(listId) {
  return apiFetch(`/lists/${listId}`, {
    method: 'DELETE'
  });
}

/**
 * Поделиться списком с пользователем
 */
export async function shareList(listId, username, canEdit = true) {
  return apiFetch(`/lists/${listId}/share`, {
    method: 'POST',
    body: JSON.stringify({ username, canEdit })
  });
}

/**
 * Убрать пользователя из списка
 */
export async function unshareList(listId, telegramId) {
  return apiFetch(`/lists/${listId}/share/${telegramId}`, {
    method: 'DELETE'
  });
}

// ==================== Stores ====================

/**
 * Добавить магазин
 */
export async function addStore(listId, name) {
  return apiFetch(`/lists/${listId}/stores`, {
    method: 'POST',
    body: JSON.stringify({ name })
  });
}

// ==================== Items ====================

/**
 * Добавить товар
 */
export async function addItem(listId, item) {
  return apiFetch(`/lists/${listId}/items`, {
    method: 'POST',
    body: JSON.stringify(item)
  });
}

/**
 * Массовое добавление товаров
 */
export async function addItemsBulk(listId, stores) {
  return apiFetch(`/lists/${listId}/items/bulk`, {
    method: 'POST',
    body: JSON.stringify({ stores })
  });
}

// ==================== Voice ====================

/**
 * Обработать голосовую команду
 */
export async function processVoice(listId, audioBase64, mimeType) {
  return apiFetch('/voice/process', {
    method: 'POST',
    body: JSON.stringify({
      listId,
      audioBase64,
      mimeType
    })
  });
}

/**
 * Обработать текстовую команду
 */
export async function processText(listId, text) {
  return apiFetch('/voice/process', {
    method: 'POST',
    body: JSON.stringify({
      listId,
      text
    })
  });
}

// ==================== Admin ====================

/**
 * Получить статистику (только для админа)
 */
export async function getAdminStats() {
  return apiFetch('/admin/stats');
}

/**
 * Получить список пользователей (только для админа)
 */
export async function getAdminUsers(params = {}) {
  const query = new URLSearchParams(params).toString();
  return apiFetch(`/admin/users${query ? '?' + query : ''}`);
}

/**
 * Забанить пользователя (только для админа)
 */
export async function banUser(telegramId, reason) {
  return apiFetch(`/admin/users/${telegramId}/ban`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });
}

/**
 * Разбанить пользователя (только для админа)
 */
export async function unbanUser(telegramId) {
  return apiFetch(`/admin/users/${telegramId}/unban`, {
    method: 'POST'
  });
}
