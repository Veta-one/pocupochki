const WebSocket = require('ws');
const { verifyToken } = require('../middleware/auth');
const User = require('../models/User');
const List = require('../models/List');
const Store = require('../models/Store');
const Item = require('../models/Item');
const ActionHistory = require('../models/ActionHistory');

// Хранилище подключений: listId -> Set<WebSocket>
const listConnections = new Map();

// Хранилище данных о подключениях: WebSocket -> { telegramId, listId }
const connectionData = new Map();

/**
 * Инициализация WebSocket сервера
 */
function initWebSocket(server) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    console.log('WebSocket client connected');

    // Устанавливаем таймаут для авторизации
    const authTimeout = setTimeout(() => {
      if (!connectionData.has(ws)) {
        ws.close(4001, 'Authentication timeout');
      }
    }, 30000);

    ws.on('message', async (messageStr) => {
      try {
        const message = JSON.parse(messageStr);
        await handleMessage(ws, message, authTimeout);
      } catch (error) {
        console.error('WebSocket message error:', error);
        sendError(ws, error.message);
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      handleDisconnect(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    // Пинг для поддержания соединения
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });

  // Интервал для проверки живых соединений
  const pingInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  return wss;
}

/**
 * Обработка входящих сообщений
 */
async function handleMessage(ws, message, authTimeout) {
  const { type, payload } = message;

  switch (type) {
    case 'auth':
      await handleAuth(ws, payload, authTimeout);
      break;

    case 'update-list':
      await handleUpdateList(ws, payload);
      break;

    case 'add-item':
      await handleAddItem(ws, payload);
      break;

    case 'update-item':
      await handleUpdateItem(ws, payload);
      break;

    case 'delete-item':
      await handleDeleteItem(ws, payload);
      break;

    case 'toggle-purchased':
      await handleTogglePurchased(ws, payload);
      break;

    case 'add-store':
      await handleAddStore(ws, payload);
      break;

    case 'update-store':
      await handleUpdateStore(ws, payload);
      break;

    case 'delete-store':
      await handleDeleteStore(ws, payload);
      break;

    case 'move-item':
      await handleMoveItem(ws, payload);
      break;

    case 'undo-last-action':
      await handleUndo(ws);
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    default:
      console.warn('Unknown message type:', type);
  }
}

/**
 * Авторизация по токену
 */
async function handleAuth(ws, payload, authTimeout) {
  const { token, listId } = payload;

  // Dev mode
  let decoded;
  if (process.env.NODE_ENV === 'development' && !token) {
    decoded = { telegramId: 1 };
  } else {
    decoded = verifyToken(token);
    if (!decoded) {
      ws.close(4002, 'Invalid token');
      return;
    }
  }

  const user = await User.findOne({ telegramId: decoded.telegramId });
  if (!user) {
    ws.close(4003, 'User not found');
    return;
  }

  if (user.isBanned) {
    ws.close(4004, 'User is banned');
    return;
  }

  // Проверяем доступ к списку
  const list = await List.findById(listId);
  if (!list) {
    ws.close(4005, 'List not found');
    return;
  }

  const access = list.hasAccess(decoded.telegramId);
  if (!access.access) {
    ws.close(4006, 'Access denied');
    return;
  }

  // Отменяем таймаут авторизации
  clearTimeout(authTimeout);

  // Сохраняем данные о подключении
  connectionData.set(ws, {
    telegramId: decoded.telegramId,
    listId: listId,
    canEdit: access.canEdit,
    isOwner: access.isOwner
  });

  // Добавляем в группу подключений к списку
  if (!listConnections.has(listId)) {
    listConnections.set(listId, new Set());
  }
  listConnections.get(listId).add(ws);

  // Отправляем начальные данные
  await sendInitialData(ws, listId);

  // Уведомляем других о присоединении
  broadcastToList(listId, {
    type: 'user-presence',
    payload: {
      telegramId: decoded.telegramId,
      firstName: user.firstName,
      status: 'online'
    }
  }, ws);
}

/**
 * Отправка начальных данных после авторизации
 */
async function sendInitialData(ws, listId) {
  const [list, stores, items, history] = await Promise.all([
    List.findById(listId),
    Store.findByListId(listId),
    Item.findByListId(listId),
    ActionHistory.getRecent(listId, 50)
  ]);

  ws.send(JSON.stringify({
    type: 'initial-data',
    payload: {
      list,
      stores,
      items,
      history
    }
  }));
}

/**
 * Обработка отключения
 */
function handleDisconnect(ws) {
  const data = connectionData.get(ws);
  if (!data) return;

  const { telegramId, listId } = data;

  // Удаляем из группы подключений
  const connections = listConnections.get(listId);
  if (connections) {
    connections.delete(ws);
    if (connections.size === 0) {
      listConnections.delete(listId);
    }
  }

  // Удаляем данные о подключении
  connectionData.delete(ws);

  // Уведомляем других об отключении
  broadcastToList(listId, {
    type: 'user-presence',
    payload: {
      telegramId,
      status: 'offline'
    }
  });
}

/**
 * Обновление настроек списка
 */
async function handleUpdateList(ws, payload) {
  const data = connectionData.get(ws);
  if (!data || !data.canEdit) return;

  const { activeStoreFilter } = payload;
  const list = await List.findById(data.listId);

  if (activeStoreFilter !== undefined) {
    list.activeStoreFilter = activeStoreFilter;
  }

  await list.save();

  broadcastToList(data.listId, {
    type: 'list-updated',
    payload: { list }
  });
}

/**
 * Добавление товара
 */
async function handleAddItem(ws, payload) {
  const data = connectionData.get(ws);
  if (!data || !data.canEdit) return;

  const item = await Item.createWithOrder({
    listId: data.listId,
    ...payload
  });

  await ActionHistory.addEntry(
    data.listId,
    data.telegramId,
    'ADD_ITEM',
    { item: item.toObject() },
    `Добавлен товар "${item.name}"`
  );

  await broadcastListUpdate(data.listId);
}

/**
 * Обновление товара
 */
async function handleUpdateItem(ws, payload) {
  const data = connectionData.get(ws);
  if (!data || !data.canEdit) return;

  const { itemId, ...updates } = payload;
  const item = await Item.findById(itemId);
  if (!item || item.listId.toString() !== data.listId) return;

  const previousState = item.toObject();

  Object.assign(item, updates);
  await item.save();

  await ActionHistory.addEntry(
    data.listId,
    data.telegramId,
    'UPDATE_ITEM',
    { itemId, previousState, newState: item.toObject() },
    `Обновлён товар "${item.name}"`
  );

  await broadcastListUpdate(data.listId);
}

/**
 * Удаление товара
 */
async function handleDeleteItem(ws, payload) {
  const data = connectionData.get(ws);
  if (!data || !data.canEdit) return;

  const { itemId } = payload;
  const item = await Item.findById(itemId);
  if (!item || item.listId.toString() !== data.listId) return;

  const deletedItem = item.toObject();
  await item.deleteOne();

  await ActionHistory.addEntry(
    data.listId,
    data.telegramId,
    'DELETE_ITEM',
    { item: deletedItem },
    `Удалён товар "${deletedItem.name}"`
  );

  await broadcastListUpdate(data.listId);
}

/**
 * Toggle purchased
 */
async function handleTogglePurchased(ws, payload) {
  const data = connectionData.get(ws);
  if (!data) return; // Не требует canEdit для отметки купленного

  const { itemId } = payload;
  const item = await Item.findById(itemId);
  if (!item || item.listId.toString() !== data.listId) return;

  const wasPurchased = item.purchased;
  console.log(`=== TOGGLE PURCHASED ===`);
  console.log(`Item: ${item.name}, was: ${wasPurchased}, will be: ${!wasPurchased}`);

  await item.togglePurchased(data.telegramId);

  console.log(`After toggle: ${item.name}, purchased=${item.purchased}`);

  await ActionHistory.addEntry(
    data.listId,
    data.telegramId,
    'TOGGLE_PURCHASED',
    { itemId, wasPurchased },
    `Товар "${item.name}" ${item.purchased ? 'куплен' : 'не куплен'}`
  );

  await broadcastListUpdate(data.listId);
}

/**
 * Добавление магазина
 */
async function handleAddStore(ws, payload) {
  const data = connectionData.get(ws);
  if (!data || !data.canEdit) return;

  const { name } = payload;
  const store = await Store.createWithOrder(data.listId, name);

  await ActionHistory.addEntry(
    data.listId,
    data.telegramId,
    'ADD_STORE',
    { store: store.toObject() },
    `Добавлен магазин "${name}"`
  );

  await broadcastListUpdate(data.listId);
}

/**
 * Обновление магазина
 */
async function handleUpdateStore(ws, payload) {
  const data = connectionData.get(ws);
  if (!data || !data.canEdit) return;

  const { storeId, name, order } = payload;
  const store = await Store.findById(storeId);
  if (!store || store.listId.toString() !== data.listId) return;

  const previousName = store.name;

  if (name !== undefined) store.name = name;
  if (order !== undefined) store.order = order;
  await store.save();

  if (name && name !== previousName) {
    await ActionHistory.addEntry(
      data.listId,
      data.telegramId,
      'UPDATE_STORE_NAME',
      { storeId, previousName, newName: name },
      `Магазин "${previousName}" переименован в "${name}"`
    );
  }

  await broadcastListUpdate(data.listId);
}

/**
 * Удаление магазина
 */
async function handleDeleteStore(ws, payload) {
  const data = connectionData.get(ws);
  if (!data || !data.canEdit) return;

  const { storeId } = payload;
  const store = await Store.findById(storeId);
  if (!store || store.listId.toString() !== data.listId) return;

  const deletedStore = store.toObject();
  const deletedItems = await Item.find({ storeId }).lean();

  // Удаляем все товары магазина
  await Item.deleteMany({ storeId });
  await store.deleteOne();

  await ActionHistory.addEntry(
    data.listId,
    data.telegramId,
    'DELETE_STORE',
    { store: deletedStore, items: deletedItems },
    `Удалён магазин "${deletedStore.name}" с ${deletedItems.length} товарами`
  );

  await broadcastListUpdate(data.listId);
}

/**
 * Перемещение товара между магазинами
 */
async function handleMoveItem(ws, payload) {
  const data = connectionData.get(ws);
  if (!data || !data.canEdit) return;

  const { itemId, sourceStoreId, targetStoreId, newIndex } = payload;
  const item = await Item.findById(itemId);
  if (!item || item.listId.toString() !== data.listId) return;

  const previousStoreId = item.storeId.toString();
  const previousOrder = item.order;

  item.storeId = targetStoreId;
  item.order = newIndex;
  await item.save();

  await ActionHistory.addEntry(
    data.listId,
    data.telegramId,
    'MOVE_ITEM',
    { itemId, sourceStoreId, targetStoreId, previousOrder, newIndex },
    `Товар "${item.name}" перемещён`
  );

  await broadcastListUpdate(data.listId);
}

/**
 * Отмена последнего действия
 */
async function handleUndo(ws) {
  const data = connectionData.get(ws);
  if (!data || !data.canEdit) return;

  const lastAction = await ActionHistory.popLast(data.listId);
  if (!lastAction) {
    ws.send(JSON.stringify({
      type: 'info',
      payload: { message: 'Нечего отменять' }
    }));
    return;
  }

  // Выполняем обратное действие
  try {
    await executeUndo(lastAction);
    await broadcastListUpdate(data.listId);
  } catch (error) {
    console.error('Undo error:', error);
    sendError(ws, 'Не удалось отменить действие');
  }
}

/**
 * Выполнение отмены действия
 */
async function executeUndo(action) {
  const { actionType, payload } = action;

  switch (actionType) {
    case 'ADD_ITEM':
      if (payload.item?._id) {
        await Item.findByIdAndDelete(payload.item._id);
      }
      break;

    case 'DELETE_ITEM':
      if (payload.item) {
        await Item.create(payload.item);
      }
      break;

    case 'UPDATE_ITEM':
      if (payload.itemId && payload.previousState) {
        await Item.findByIdAndUpdate(payload.itemId, payload.previousState);
      }
      break;

    case 'TOGGLE_PURCHASED':
      if (payload.itemId) {
        const item = await Item.findById(payload.itemId);
        if (item) {
          item.purchased = payload.wasPurchased;
          await item.save();
        }
      }
      break;

    case 'ADD_STORE':
      if (payload.store?._id) {
        await Item.deleteMany({ storeId: payload.store._id });
        await Store.findByIdAndDelete(payload.store._id);
      }
      break;

    case 'DELETE_STORE':
      if (payload.store) {
        await Store.create(payload.store);
        if (payload.items?.length) {
          await Item.insertMany(payload.items);
        }
      }
      break;

    case 'UPDATE_STORE_NAME':
      if (payload.storeId && payload.previousName) {
        await Store.findByIdAndUpdate(payload.storeId, { name: payload.previousName });
      }
      break;

    case 'MOVE_ITEM':
      if (payload.itemId) {
        await Item.findByIdAndUpdate(payload.itemId, {
          storeId: payload.sourceStoreId,
          order: payload.previousOrder
        });
      }
      break;
  }
}

/**
 * Рассылка обновления всем подключённым к списку
 */
async function broadcastListUpdate(listId) {
  const [list, stores, items, history] = await Promise.all([
    List.findById(listId),
    Store.findByListId(listId),
    Item.findByListId(listId),
    ActionHistory.getRecent(listId, 50)
  ]);

  // Debug: проверяем статус purchased для всех товаров
  console.log('=== broadcastListUpdate ===');
  console.log('List ID:', listId);
  console.log('Items count:', items.length);
  items.forEach(item => {
    console.log(`  - ${item.name}: purchased=${item.purchased}, id=${item._id}`);
  });

  broadcastToList(listId, {
    type: 'list-updated',
    payload: { list, stores, items }
  });

  broadcastToList(listId, {
    type: 'history-updated',
    payload: { history }
  });
}

/**
 * Рассылка сообщения всем подключённым к списку
 */
function broadcastToList(listId, message, excludeWs = null) {
  const connections = listConnections.get(listId);
  if (!connections) return;

  const messageStr = JSON.stringify(message);

  connections.forEach((ws) => {
    if (ws !== excludeWs && ws.readyState === WebSocket.OPEN) {
      ws.send(messageStr);
    }
  });
}

/**
 * Отправка ошибки клиенту
 */
function sendError(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message }
    }));
  }
}

module.exports = {
  initWebSocket,
  broadcastToList,
  broadcastListUpdate
};
