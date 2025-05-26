// server/utils/fileUtils.js
const fs = require('fs').promises;
const path = require('path');

const dataPath = path.join(__dirname, '..', 'data');
const listDataFile = path.join(dataPath, 'shoppingListData.json');
const historyDataFile = path.join(dataPath, 'actionHistory.json');

async function ensureDataFilesExist() {
    try {
        await fs.mkdir(dataPath, { recursive: true }); // Создаем папку data, если ее нет

        // Проверяем и создаем shoppingListData.json, если не существует
        try {
            await fs.access(listDataFile);
        } catch (error) {
            await fs.writeFile(listDataFile, JSON.stringify({ stores: [], activeStoreFilter: "Все" }, null, 2));
            console.log('Created shoppingListData.json');
        }

        // Проверяем и создаем actionHistory.json, если не существует
        try {
            await fs.access(historyDataFile);
        } catch (error) {
            await fs.writeFile(historyDataFile, JSON.stringify([], null, 2));
            console.log('Created actionHistory.json');
        }
    } catch (err) {
        console.error("Error ensuring data files:", err);
    }
}


async function readData(fileType = 'list') {
    const filePath = fileType === 'history' ? historyDataFile : listDataFile;
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        const parsedData = JSON.parse(data);
        // Убедимся, что все товары имеют поле notes, если загружаем список
        if (fileType === 'list' && parsedData.stores) {
            parsedData.stores.forEach(store => {
                if (store.items) {
                    store.items.forEach(item => {
                        if (typeof item.notes === 'undefined') {
                            item.notes = ""; // Добавляем поле notes, если оно отсутствует
                        }
                    });
                }
            });
        }
        return parsedData;
    } catch (error) {
        console.error(`Error reading ${filePath}:`, error);
        if (fileType === 'history') return [];
        // Возвращаем дефолтную структуру. Поле 'notes' будет добавлено при создании товаров.
        return { stores: [], activeStoreFilter: "Все" };
    }
}

async function writeData(data, fileType = 'list') {
    const filePath = fileType === 'history' ? historyDataFile : listDataFile;
    try {
        await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        console.error(`Error writing ${filePath}:`, error);
    }
}

module.exports = { readData, writeData, ensureDataFilesExist };