// js/app.js
import { initMainView, destroyMainView } from './mainViewLogic.js';
import { initEditView, destroyEditView } from './editViewLogic.js';
import {
  initTelegramWebApp,
  getInitData,
  isTelegramWebApp,
  showBackButton,
  hideBackButton,
  hapticFeedback,
  showAlert
} from './telegramWebApp.js';
import {
  authenticate,
  authenticateDev,
  getStoredToken,
  setAuthToken,
  getDefaultListId,
  getCurrentUser,
  processVoice
} from './api.js';

// --- Глобальное состояние приложения ---
export let shoppingListData = { stores: [], items: [], activeStoreFilter: "Все" };
export let actionHistory = [];
export let currentListId = null;
export let currentUser = null;

let currentPage = null;
let socket = null;
let authToken = null;

const appContainer = document.getElementById('app-container');

// Элементы навигационного меню
let navBottomNavigation, navMicButton, navMicIcon, navStopIcon, navUndoButton, navToggleButton, navMicStatus;
let currentUndoButton;

// Микрофон
let mediaRecorderFromApp;
let audioChunksFromApp = [];

// --- Авторизация ---
async function initAuth() {
  // Пробуем получить сохранённый токен
  const storedToken = getStoredToken();

  // Инициализируем Telegram Web App
  const tgData = initTelegramWebApp();

  if (tgData && tgData.initData) {
    // Мы в Telegram - авторизуемся через InitData
    try {
      updateGlobalMicStatus('Авторизация...');
      const authData = await authenticate(tgData.initData);
      authToken = authData.token;
      currentUser = authData.user;
      currentListId = authData.defaultListId;
      console.log('Authenticated via Telegram:', currentUser.firstName);
      return true;
    } catch (error) {
      console.error('Telegram authentication failed:', error);
      showAlert('Ошибка авторизации. Попробуйте перезапустить приложение.');
      return false;
    }
  } else if (storedToken) {
    // Есть сохранённый токен - используем его
    authToken = storedToken;
    setAuthToken(storedToken);

    // Получаем данные пользователя через API (при первом запросе)
    try {
      // Пробуем dev auth для получения user info
      const authData = await authenticateDev();
      currentUser = authData.user;
      currentListId = authData.defaultListId;
      console.log('Authenticated via stored token');
      return true;
    } catch (error) {
      console.warn('Stored token invalid, clearing...');
      setAuthToken(null);
    }
  }

  // Dev mode - авторизуемся без Telegram
  if (!isTelegramWebApp()) {
    try {
      console.log('Running in dev mode, authenticating...');
      const authData = await authenticateDev();
      authToken = authData.token;
      currentUser = authData.user;
      currentListId = authData.defaultListId;
      console.log('Authenticated in dev mode:', currentUser.firstName);
      return true;
    } catch (error) {
      console.error('Dev authentication failed:', error);
      return false;
    }
  }

  return false;
}

// --- WebSocket Управление ---
function connectWebSocket() {
  if (!currentListId || !authToken) {
    console.warn('Cannot connect WebSocket: no listId or token');
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log('WebSocket connection established.');
    // Авторизуемся по WebSocket
    socket.send(JSON.stringify({
      type: 'auth',
      payload: {
        token: authToken,
        listId: currentListId
      }
    }));
  };

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      handleWebSocketMessage(message);
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  };

  socket.onclose = (event) => {
    console.log(`WebSocket closed (code: ${event.code}). Reconnecting in 5s...`);
    setTimeout(connectWebSocket, 5000);
  };

  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

function handleWebSocketMessage(message) {
  console.log('WebSocket message:', message.type);

  switch (message.type) {
    case 'initial-data':
      handleInitialData(message.payload);
      break;

    case 'list-updated':
      handleListUpdated(message.payload);
      break;

    case 'history-updated':
      actionHistory = message.payload.history || message.payload;
      updateUndoButtonState();
      break;

    case 'user-presence':
      console.log('User presence:', message.payload);
      // Можно показывать кто онлайн
      break;

    case 'error':
      console.error('Server error:', message.payload);
      showAlert(`Ошибка: ${message.payload.message}`);
      break;

    case 'pong':
      // Heartbeat response
      break;

    default:
      console.warn('Unknown message type:', message.type);
  }
}

function handleInitialData(payload) {
  const { list, stores, items, history } = payload;

  // Преобразуем в формат совместимый со старым кодом
  shoppingListData = {
    stores: transformToLegacyFormat(stores, items),
    activeStoreFilter: list.activeStoreFilter || 'Все'
  };

  actionHistory = history || [];

  rerenderCurrentView();
  updateUndoButtonState();
  updateGlobalMicStatus('');
}

function handleListUpdated(payload) {
  const { list, stores, items } = payload;

  shoppingListData = {
    stores: transformToLegacyFormat(stores, items),
    activeStoreFilter: list?.activeStoreFilter || shoppingListData.activeStoreFilter
  };

  rerenderCurrentView();
  hapticFeedback('notification', 'success');
}

/**
 * Преобразование нового формата (stores + items) в старый формат (stores с вложенными items)
 */
function transformToLegacyFormat(stores, items) {
  const storesMap = new Map();

  // Создаём карту магазинов
  for (const store of stores) {
    storesMap.set(store._id.toString(), {
      name: store.name,
      _id: store._id,
      items: []
    });
  }

  // Распределяем товары по магазинам
  for (const item of items) {
    const storeId = item.storeId?.toString() || item.storeId;
    const store = storesMap.get(storeId);
    if (store) {
      store.items.push({
        id: item._id,
        _id: item._id,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        emoji: item.emoji,
        notes: item.notes,
        purchased: item.purchased,
        storeId: item.storeId
      });
    }
  }

  return Array.from(storesMap.values());
}

function rerenderCurrentView() {
  if (currentPage === 'main' && typeof initMainView === 'function') {
    if (typeof destroyMainView === 'function') destroyMainView();
    initMainView(true);
  } else if (currentPage === 'edit' && typeof initEditView === 'function') {
    if (typeof destroyEditView === 'function') destroyEditView();
    initEditView(true);
  }
}

// --- Управление данными ---
export function generateId() {
  return 'item_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

export function saveData(actionDetailsForHistory = null) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    // Отправляем обновление через WebSocket
    socket.send(JSON.stringify({
      type: 'update-list',
      payload: { activeStoreFilter: shoppingListData.activeStoreFilter }
    }));

    // Если есть действие для истории
    if (actionDetailsForHistory) {
      actionDetailsForHistory.timestamp = Date.now();
      actionDetailsForHistory.id = `hist_${generateId()}`;

      // Оптимистичное обновление
      actionHistory.unshift(actionDetailsForHistory);
      updateUndoButtonState();
    }
  } else {
    console.error('WebSocket not connected');
    showAlert('Нет соединения с сервером');
  }
}

// Методы для работы с WebSocket (для совместимости со старым кодом)
export function sendWebSocketMessage(type, payload) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, payload }));
  }
}

export function addItem(storeId, item) {
  sendWebSocketMessage('add-item', { storeId, ...item });
}

export function updateItem(itemId, updates) {
  sendWebSocketMessage('update-item', { itemId, ...updates });
}

export function deleteItem(itemId) {
  sendWebSocketMessage('delete-item', { itemId });
}

export function togglePurchased(itemId) {
  sendWebSocketMessage('toggle-purchased', { itemId });
  hapticFeedback('impact', 'light');
}

export function addStore(name) {
  sendWebSocketMessage('add-store', { name });
}

export function updateStore(storeId, updates) {
  sendWebSocketMessage('update-store', { storeId, ...updates });
}

export function deleteStore(storeId) {
  sendWebSocketMessage('delete-store', { storeId });
}

export function moveItem(itemId, sourceStoreId, targetStoreId, newIndex) {
  sendWebSocketMessage('move-item', { itemId, sourceStoreId, targetStoreId, newIndex });
}

// --- UI функции ---
export function updateGlobalMicStatus(message, hideAfterMs = 0) {
  if (navMicStatus) {
    navMicStatus.textContent = message;
    if (hideAfterMs > 0) {
      setTimeout(() => {
        if (navMicStatus && navMicStatus.textContent === message) {
          navMicStatus.textContent = "";
        }
      }, hideAfterMs);
    }
  }
}

function updateUndoButtonState() {
  if (currentUndoButton) {
    currentUndoButton.disabled = actionHistory.length === 0;
    currentUndoButton.textContent = `Отменить (${actionHistory.length})`;
  }
}

function handleUndoClick() {
  if (actionHistory.length > 0 && socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'undo-last-action' }));
    hapticFeedback('impact', 'medium');
  }
}

// --- Голосовой ввод ---
async function handleGlobalMicButtonClick() {
  if (!navMicButton || navMicButton.disabled) return;

  if (mediaRecorderFromApp && mediaRecorderFromApp.state === "recording") {
    // Остановить запись
    mediaRecorderFromApp.stop();
    updateGlobalMicStatus("Обработка...");
    navMicButton.classList.remove('recording', 'bg-red-500');
    navMicButton.classList.add('bg-[#53d22c]');
    if (navMicIcon) navMicIcon.classList.remove('hidden');
    if (navStopIcon) navStopIcon.classList.add('hidden');
  } else {
    // Начать запись
    try {
      updateGlobalMicStatus("Запрос микрофона...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const options = { mimeType: 'audio/webm;codecs=opus' };
      if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'audio/webm';
        if (!MediaRecorder.isTypeSupported(options.mimeType)) options.mimeType = '';
      }

      mediaRecorderFromApp = new MediaRecorder(stream, options.mimeType ? options : undefined);
      audioChunksFromApp = [];

      mediaRecorderFromApp.ondataavailable = event => audioChunksFromApp.push(event.data);

      mediaRecorderFromApp.onstop = async () => {
        navMicButton.classList.remove('recording', 'bg-red-500');
        navMicButton.classList.add('bg-[#53d22c]');
        if (navMicIcon) navMicIcon.classList.remove('hidden');
        if (navStopIcon) navStopIcon.classList.add('hidden');

        updateGlobalMicStatus("Обработка...");

        if (audioChunksFromApp.length === 0) {
          updateGlobalMicStatus("Нет аудио", 2000);
          return;
        }

        const audioBlob = new Blob(audioChunksFromApp, { type: mediaRecorderFromApp.mimeType || 'audio/webm' });
        if (audioBlob.size === 0) {
          updateGlobalMicStatus("Пустой файл", 2000);
          return;
        }

        // Конвертируем в base64 и отправляем на сервер
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = async () => {
          const base64Audio = reader.result.split(',')[1];
          const audioMimeType = audioBlob.type || 'audio/webm';

          try {
            updateGlobalMicStatus("Отправка...");
            const result = await processVoice(currentListId, base64Audio, audioMimeType);

            if (result.success) {
              updateGlobalMicStatus(`+${result.created} товаров`, 3000);
              hapticFeedback('notification', 'success');
              // Данные придут через WebSocket
            } else {
              updateGlobalMicStatus("Ошибка", 3000);
            }
          } catch (error) {
            console.error('Voice processing error:', error);
            updateGlobalMicStatus("Ошибка API", 3000);
            showAlert('Не удалось обработать голосовую команду');
          }
        };

        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorderFromApp.onerror = (event) => {
        console.error("MediaRecorder error:", event.error);
        navMicButton.classList.remove('recording', 'bg-red-500');
        navMicButton.classList.add('bg-[#53d22c]');
        if (navMicIcon) navMicIcon.classList.remove('hidden');
        if (navStopIcon) navStopIcon.classList.add('hidden');
        stream.getTracks().forEach(track => track.stop());
        updateGlobalMicStatus("Ошибка записи", 3000);
      };

      mediaRecorderFromApp.start();
      updateGlobalMicStatus("Говорите...");
      navMicButton.classList.add('recording', 'bg-red-500');
      navMicButton.classList.remove('bg-[#53d22c]');
      if (navMicIcon) navMicIcon.classList.add('hidden');
      if (navStopIcon) navStopIcon.classList.remove('hidden');
      hapticFeedback('impact', 'medium');

    } catch (err) {
      console.error("Error accessing microphone:", err);
      showAlert("Ошибка доступа к микрофону: " + err.message);
      updateGlobalMicStatus("Ошибка микрофона", 3000);
    }
  }
}

// --- SPA Роутинг ---
async function loadViewHTML(viewName) {
  try {
    const response = await fetch(`partials/${viewName}.html`);
    if (!response.ok) throw new Error(`Failed to load ${viewName}.html`);
    return await response.text();
  } catch (error) {
    console.error("Error loading view HTML:", error);
    appContainer.innerHTML = `<p class="text-red-500 p-4">Ошибка загрузки: ${error.message}</p>`;
    return null;
  }
}

export async function navigateTo(path) {
  const previousPageType = currentPage;

  if (previousPageType === 'main' && typeof destroyMainView === 'function') destroyMainView();
  if (previousPageType === 'edit' && typeof destroyEditView === 'function') destroyEditView();

  let newViewHTML = '';
  let newPageType = '';
  let initFunction = null;

  document.body.classList.remove('transition-to-main', 'transition-to-edit');

  if (path === '/' || path === 'index.html' || path === '#main') {
    newPageType = 'main';
    if (previousPageType === 'edit') {
      document.body.classList.add('transition-to-main');
    }
    document.body.classList.remove('edit-view-active');
    document.body.classList.add('main-view-active');
    newViewHTML = await loadViewHTML('mainView');
    initFunction = initMainView;
    if (navToggleButton) navToggleButton.textContent = 'Редактировать';

    // Telegram BackButton
    if (isTelegramWebApp()) {
      hideBackButton();
    }
  } else if (path === '#edit') {
    newPageType = 'edit';
    if (previousPageType === 'main') {
      document.body.classList.add('transition-to-edit');
    }
    document.body.classList.remove('main-view-active');
    document.body.classList.add('edit-view-active');
    newViewHTML = await loadViewHTML('editView');
    initFunction = initEditView;
    if (navToggleButton) navToggleButton.textContent = 'Список';

    // Telegram BackButton
    if (isTelegramWebApp()) {
      showBackButton(() => navigateTo('#main'));
    }
  } else {
    history.replaceState({ path: 'main' }, '', '#main');
    return navigateTo('#main');
  }

  if (!newViewHTML) return;

  appContainer.innerHTML = newViewHTML;

  if (window.location.hash !== path) {
    history.pushState({ path: newPageType }, '', path);
  }

  currentPage = newPageType;

  requestAnimationFrame(() => {
    if (typeof initFunction === 'function') {
      initFunction();
    }
    updateUndoButtonState();
    setTimeout(() => {
      document.body.classList.remove('transition-to-main', 'transition-to-edit');
    }, 400);
  });
}

window.onpopstate = (event) => {
  if (event.state && event.state.path) {
    navigateTo(event.state.path === 'main' ? '#main' : '#edit');
  } else {
    navigateTo(window.location.hash || '#main');
  }
};

// Слушаем событие требования авторизации
window.addEventListener('auth-required', () => {
  console.log('Re-authentication required');
  initAuth().then(() => connectWebSocket());
});

// --- Инициализация приложения ---
function initAppUI() {
  navBottomNavigation = document.getElementById('bottom-navigation');
  navMicButton = document.getElementById('navMicButton');
  navMicIcon = document.getElementById('navMicIcon');
  navStopIcon = document.getElementById('navStopIcon');
  navUndoButton = document.getElementById('navUndoButton');
  navToggleButton = document.getElementById('navToggleButton');
  navMicStatus = document.getElementById('navMicStatus');

  currentUndoButton = navUndoButton;

  if (navUndoButton) {
    navUndoButton.addEventListener('click', handleUndoClick);
  }
  if (navToggleButton) {
    navToggleButton.addEventListener('click', () => {
      navigateTo(currentPage === 'main' ? '#edit' : '#main');
    });
  }
  if (navMicButton) {
    navMicButton.addEventListener('click', handleGlobalMicButtonClick);
  }
  if (navBottomNavigation) {
    addSwipeListeners(navBottomNavigation,
      () => { if (currentPage === 'main') navigateTo('#edit'); },
      () => { if (currentPage === 'edit') navigateTo('#main'); }
    );
  }

  updateUndoButtonState();
}

document.addEventListener('DOMContentLoaded', async () => {
  initAppUI();

  // Показываем загрузку
  appContainer.innerHTML = '<div class="flex items-center justify-center h-screen"><p class="text-gray-400">Загрузка...</p></div>';

  // Авторизация
  const authSuccess = await initAuth();

  if (!authSuccess) {
    appContainer.innerHTML = '<div class="flex items-center justify-center h-screen"><p class="text-red-500">Ошибка авторизации</p></div>';
    return;
  }

  // Подключаем WebSocket
  connectWebSocket();

  // Переходим на начальную страницу
  const initialPath = window.location.hash || '#main';
  navigateTo(['#main', '#edit'].includes(initialPath) ? initialPath : '#main');
});

// --- Вспомогательные функции ---
export function addSwipeListeners(element, onSwipeLeft, onSwipeRight) {
  let touchstartX = 0;
  const swipeThreshold = 70;

  if (!element._swipeHandlers) {
    element._swipeHandlers = {};
  }

  if (element._swipeHandlers.touchstart) element.removeEventListener('touchstart', element._swipeHandlers.touchstart);
  if (element._swipeHandlers.touchend) element.removeEventListener('touchend', element._swipeHandlers.touchend);

  element._swipeHandlers.touchstart = e => {
    const target = e.target;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.closest('button') || target.closest('[draggable="true"]')) {
      touchstartX = 0;
      return;
    }
    touchstartX = e.changedTouches[0].screenX;
  };

  element._swipeHandlers.touchend = e => {
    if (touchstartX === 0) return;
    const touchendX = e.changedTouches[0].screenX;
    if (touchendX < touchstartX - swipeThreshold && onSwipeLeft) onSwipeLeft();
    else if (touchendX > touchstartX + swipeThreshold && onSwipeRight) onSwipeRight();
    touchstartX = 0;
  };

  element.addEventListener('touchstart', element._swipeHandlers.touchstart, { passive: true });
  element.addEventListener('touchend', element._swipeHandlers.touchend, { passive: true });
}

export function removeSwipeListeners(element) {
  if (element && element._swipeHandlers) {
    if (element._swipeHandlers.touchstart) element.removeEventListener('touchstart', element._swipeHandlers.touchstart);
    if (element._swipeHandlers.touchend) element.removeEventListener('touchend', element._swipeHandlers.touchend);
    delete element._swipeHandlers;
  }
}

// Экспорт для совместимости
export { currentListId as listId };
