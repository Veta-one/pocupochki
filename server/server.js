// server/server.js
require('dotenv').config({ path: './.env' });
const express = require('express');
// const http = require('http'); // Можно закомментировать или удалить, если http больше не нужен
const https = require('https');   // Используем https
const fs = require('fs');
const WebSocket = require('ws');
const path = require('path');
const { readData, writeData, ensureDataFilesExist } = require('./utils/fileUtils');

const app = express();

// Опции для HTTPS сервера
const httpsOptions = {
    key: fs.readFileSync(path.join(__dirname, 'key.pem')),    // Убедитесь, что файлы key.pem и cert.pem
    cert: fs.readFileSync(path.join(__dirname, 'cert.pem')) // находятся в папке server/
};

// Создаем HTTPS сервер
const server = https.createServer(httpsOptions, app); // <--- ИСПРАВЛЕНО: используем https.createServer и httpsOptions

// WebSocket сервер теперь будет работать поверх HTTPS
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 5050;

ensureDataFilesExist().then(() => {
    console.log('Data files checked/initialized.');
}).catch(err => {
    console.error("Critical error initializing data files:", err);
    process.exit(1);
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/shopping-list', async (req, res) => {
    try {
        const data = await readData('list');
        res.json(data);
    } catch (error) {
        console.error("SERVER HTTP GET /api/shopping-list error:", error);
        res.status(500).json({ error: 'Failed to load shopping list' });
    }
});

app.get('/api/history', async (req, res) => {
    try {
        const data = await readData('history');
        res.json(data);
    } catch (error) {
        console.error("SERVER HTTP GET /api/history error:", error);
        res.status(500).json({ error: 'Failed to load history' });
    }
});

wss.on('connection', (ws, req) => {
    const clientIp = req.socket.remoteAddress;
    console.log(`Client connected from ${clientIp}`);

    readData('list').then(data => {
        ws.send(JSON.stringify({ type: 'initial-data', payload: data }));
    }).catch(err => {
        console.error("SERVER: Failed to send initial list data to client:", err);
        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Failed to load initial list data.'} }));
    });

    readData('history').then(data => {
        ws.send(JSON.stringify({ type: 'history-updated', payload: data }));
    }).catch(err => {
        console.error("SERVER: Failed to send initial history data to client:", err);
    });

    ws.on('message', async (messageStr) => {
        let parsedMessage;
        try {
            parsedMessage = JSON.parse(messageStr);
            console.log(`SERVER: Received type: ${parsedMessage.type} from client ${clientIp}`);

            if (parsedMessage.type === 'update-list') {
                const newListData = parsedMessage.payload;
                if (!newListData || typeof newListData.stores === 'undefined' || typeof newListData.activeStoreFilter === 'undefined') {
                    console.error("SERVER: Invalid 'update-list' payload:", newListData);
                    ws.send(JSON.stringify({ type: 'error', payload: { message: 'Invalid data format for update-list.' } }));
                    return;
                }
                await writeData(newListData, 'list');
                // broadcast({ type: 'list-updated', payload: newListData }, ws); // СТАРЫЙ ВАРИАНТ
                broadcast({ type: 'list-updated', payload: newListData });    // <--- НОВЫЙ ВАРИАНТ (БЕЗ ", ws")
            }  else if (parsedMessage.type === 'add-history') {
                const historyEntry = parsedMessage.payload;
                if (!historyEntry || !historyEntry.actionType || !historyEntry.payload) {
                    console.error("SERVER: Invalid 'add-history' payload:", historyEntry);
                    ws.send(JSON.stringify({ type: 'error', payload: { message: 'Invalid data format for add-history.' } }));
                    return;
                }
                const currentHistory = await readData('history');
                currentHistory.unshift(historyEntry);
                await writeData(currentHistory, 'history');
                broadcast({ type: 'history-updated', payload: currentHistory }); // Оповещаем всех
            } else if (parsedMessage.type === 'get-history') {
                 const currentHistory = await readData('history');
                 ws.send(JSON.stringify({ type: 'history-updated', payload: currentHistory }));
            } else if (parsedMessage.type === 'undo-last-action') {
                console.log("SERVER: Processing undo-last-action");
                let history = await readData('history');
                let currentList = await readData('list');

                if (history.length > 0) {
                    const actionToUndo = history.shift();
                    console.log("SERVER: Undoing action:", actionToUndo.actionType, "with ID:", actionToUndo.id);

                    switch (actionToUndo.actionType) {
                        case 'ADD_ITEM':
                            if (actionToUndo.payload.storeName && actionToUndo.payload.addedItem) {
                                const store = currentList.stores.find(s => s.name === actionToUndo.payload.storeName);
                                if (store) {
                                    store.items = store.items.filter(item => item.id !== actionToUndo.payload.addedItem.id);
                                }
                            }
                            break;
                        case 'DELETE_ITEM':
                            if (actionToUndo.payload.deletedItem && actionToUndo.payload.storeName) {
                                const store = currentList.stores.find(s => s.name === actionToUndo.payload.storeName);
                                if (store) {
                                    const index = typeof actionToUndo.payload.originalIndex === 'number' ? actionToUndo.payload.originalIndex : store.items.length;
                                    store.items.splice(index, 0, actionToUndo.payload.deletedItem);
                                }
                            }
                            break;
                        case 'ADD_STORE':
                             if (actionToUndo.payload.storeName) {
                                currentList.stores = currentList.stores.filter(s => s.name !== actionToUndo.payload.storeName);
                             }
                            break;
                        case 'DELETE_STORE':
                            if (actionToUndo.payload.deletedStoreData) {
                                const index = typeof actionToUndo.payload.originalIndex === 'number' ? actionToUndo.payload.originalIndex : currentList.stores.length;
                                currentList.stores.splice(index, 0, actionToUndo.payload.deletedStoreData);
                            }
                            break;

                            case 'MOVE_ITEM':
                                if (actionToUndo.payload &&
                                    actionToUndo.payload.itemId &&
                                    actionToUndo.payload.sourceStoreName &&
                                    actionToUndo.payload.targetStoreName &&
                                    typeof actionToUndo.payload.originalIndexInSource === 'number' &&
                                    typeof actionToUndo.payload.newIndexInTarget === 'number') {
    
                                    const { itemId, sourceStoreName, targetStoreName, originalIndexInSource, newIndexInTarget } = actionToUndo.payload;
                                    
                                    console.log(`SERVER: Undoing MOVE_ITEM - Item ID: ${itemId}, from ${targetStoreName} back to ${sourceStoreName}`);
    
                                    const targetStore = currentList.stores.find(s => s.name === targetStoreName);
                                    const sourceStore = currentList.stores.find(s => s.name === sourceStoreName);
    
                                    if (targetStore && sourceStore) {
                                        // 1. Найти и удалить товар из ТЕКУЩЕГО (целевого при перемещении) магазина
                                        const itemIndexInTarget = targetStore.items.findIndex(item => item.id === itemId);
                                        if (itemIndexInTarget !== -1) {
                                            const [itemToMoveBack] = targetStore.items.splice(itemIndexInTarget, 1);
    
                                            // 2. Вставить товар обратно в ИСХОДНЫЙ магазин на его ОРИГИНАЛЬНУЮ позицию
                                            // Убедимся, что originalIndexInSource не выходит за пределы
                                            const insertionIndex = Math.min(originalIndexInSource, sourceStore.items.length);
                                            sourceStore.items.splice(insertionIndex, 0, itemToMoveBack);
                                            console.log(`  Moved item back to "${sourceStoreName}" at index ${insertionIndex}`);
                                        } else {
                                            console.warn(`SERVER: Undo MOVE_ITEM - Item ${itemId} not found in target store ${targetStoreName}. History may be inconsistent.`);
                                            history.unshift(actionToUndo); // Вернуть действие в историю, так как отмена не удалась
                                        }
                                    } else {
                                        console.warn(`SERVER: Undo MOVE_ITEM - Source or target store not found. Source: ${sourceStoreName}, Target: ${targetStoreName}.`);
                                        history.unshift(actionToUndo);
                                    }
                                } else {
                                    console.warn("SERVER: Invalid payload for undo MOVE_ITEM.", actionToUndo.payload);
                                    history.unshift(actionToUndo);
                                }
                                break;
                        case 'UPDATE_STORE_NAME':
                            if (actionToUndo.payload.previousStoreName && actionToUndo.payload.newStoreName) {
                                const store = currentList.stores.find(s => s.name === actionToUndo.payload.newStoreName);
                                if (store) {
                                    store.name = actionToUndo.payload.previousStoreName;
                                    if (currentList.activeStoreFilter === actionToUndo.payload.newStoreName) {
                                        currentList.activeStoreFilter = actionToUndo.payload.previousStoreName;
                                    }
                                }
                            }
                            break;
                        case 'UPDATE_ITEM_PROPERTY':
                        case 'UPDATE_ITEM_QUANTITY':
                        case 'UPDATE_ITEM_NAME':
                        case 'UPDATE_ITEM_UNIT':
                            if (actionToUndo.payload.itemId && actionToUndo.payload.storeName && actionToUndo.payload.hasOwnProperty('previousValue')) {
                                const store = currentList.stores.find(s => s.name === actionToUndo.payload.storeName);
                                if (store) {
                                    const item = store.items.find(i => i.id === actionToUndo.payload.itemId);
                                    if (item && actionToUndo.payload.propertyName) { // Общий случай
                                        item[actionToUndo.payload.propertyName] = actionToUndo.payload.previousValue;
                                    } else if (item && actionToUndo.actionType === 'UPDATE_ITEM_QUANTITY' && actionToUndo.payload.hasOwnProperty('previousQuantity')) { // Специфичный для количества
                                        item.quantity = actionToUndo.payload.previousQuantity;
                                    }
                                    // Добавьте другие специфичные случаи, если propertyName не используется
                                }
                            }
                            break;
                        case 'TOGGLE_PURCHASED':
                            if (actionToUndo.payload.itemId && actionToUndo.payload.storeName && actionToUndo.payload.hasOwnProperty('wasPurchased')) {
                                const store = currentList.stores.find(s => s.name === actionToUndo.payload.storeName);
                                if (store) {
                                    const item = store.items.find(i => i.id === actionToUndo.payload.itemId);
                                    if (item) {
                                        item.purchased = actionToUndo.payload.wasPurchased;
                                    }
                                }
                            }
                            break;
                            case 'CLEAR_PURCHASED': // Если вы хотите, чтобы старый CLEAR_PURCHASED тоже восстанавливал весь список
                            case 'PERMANENTLY_DELETE_PURCHASED': // <--- НОВЫЙ CASE
                            case 'VOICE_COMMAND_UPDATE':
                                if (actionToUndo.payload.previousShoppingListData) {
                                    console.log("SERVER: Undoing bulk list update (CLEAR_PURCHASED/PERMANENTLY_DELETE_PURCHASED/VOICE_COMMAND_UPDATE) by restoring previous list.");
                                    currentList = actionToUndo.payload.previousShoppingListData;
                                } else {
                                    console.warn("SERVER: Cannot undo bulk list update, no previousShoppingListData found in history entry:", actionToUndo);
                                    // Если нет previousShoppingListData, действие не может быть отменено корректно,
                                    // поэтому возвращаем его в историю, чтобы не потерять.
                                    history.unshift(actionToUndo); 
                                }
                                break;
                            default:
                            console.warn(`SERVER: Unknown actionType for undo: ${actionToUndo.actionType}. Action not reverted.`);
                            history.unshift(actionToUndo);
                            break;
                    }

                    await writeData(currentList, 'list');
                    await writeData(history, 'history');
                    
                    broadcast({ type: 'list-updated', payload: currentList }); // Всем, т.к. это результат undo
                    broadcast({ type: 'history-updated', payload: history }); // Всем
                } else {
                    console.log("SERVER: No actions in history to undo.");
                    ws.send(JSON.stringify({ type: 'info', payload: { message: 'No actions to undo.' } }));
                }
            } else {
                console.warn(`SERVER: Received unknown message type: ${parsedMessage.type} from client ${clientIp}`);
            }

        } catch (error) {
            console.error(`SERVER: Failed to process message from ${clientIp} or broadcast:`, error, "Original message:", messageStr);
            ws.send(JSON.stringify({ type: 'error', payload: { message: 'Server error processing your request.', details: error.message } }));
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`Client ${clientIp} disconnected. Code: ${code}, Reason: ${reason ? reason.toString() : 'N/A'}`);
    });

    ws.on('error', (error) => {
        console.error(`SERVER: WebSocket error for client ${clientIp}:`, error);
    });
});

// Функция для рассылки сообщений всем подключенным клиентам (можно исключить отправителя)
function broadcast(data, exceptClient = null) {
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            if (exceptClient === null || client !== exceptClient) { // Если exceptClient не указан ИЛИ текущий клиент не exceptClient
                client.send(JSON.stringify(data));
            }
        }
    });
}

const HISTORY_CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;
setInterval(async () => {
    try {
        console.log('SERVER: Running scheduled history cleanup...');
        let history = await readData('history');
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

        const актуальнаяИстория = history.filter(entry => entry.timestamp && entry.timestamp > sevenDaysAgo);

        if (актуальнаяИстория.length < history.length) {
            const numRemoved = history.length - актуальнаяИстория.length;
            console.log(`SERVER: Removed ${numRemoved} old history entr${numRemoved > 1 ? 'ies' : 'y'}.`);
            await writeData(актуальнаяИстория, 'history');
            broadcast({ type: 'history-updated', payload: актуальнаяИстория }); // Оповещаем всех
        } else {
            console.log('SERVER: No old history entries to remove.');
        }
    } catch (error) {
        console.error("SERVER: Error during scheduled history cleanup:", error);
    }
}, HISTORY_CLEANUP_INTERVAL);

server.listen(PORT, () => {
    console.log(`Server listening securely on port ${PORT}`); // Упоминаем "securely"
    console.log(`Open https://localhost:${PORT} or https://YOUR_SERVER_IP:${PORT} in your browser.`); // Используем https://
});

process.on('uncaughtException', (error) => {
  console.error('SERVER: Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('SERVER: Unhandled Rejection at:', promise, 'reason:', reason);
});