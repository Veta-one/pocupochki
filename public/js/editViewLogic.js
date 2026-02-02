// public/js/editViewLogic.js
import { shoppingListData, saveData, generateId, navigateTo, addSwipeListeners, removeSwipeListeners, updateGlobalMicStatus, moveItem, reorderItem, reorderStores, addStore as addStoreWS, updateStore as updateStoreWS, deleteStore as deleteStoreWS, deleteItem as deleteItemWS, updateItem as updateItemWS } from './app.js';
import { hapticFeedback } from './telegramWebApp.js';

// --- Переменные на уровне модуля для DOM-элементов и состояния ---
let editScreen,
    addStoreButton,
    backButton,
    editPageContainer;

// SortableJS инстансы
let storesSortable = null;
let productSortables = [];

// --- Вспомогательная функция ---
function findStoreNameByProductId(productId) {
    for (const store of shoppingListData.stores) {
        if (store.items.some(item => item.id === productId)) {
            return store.name;
        }
    }
    return null;
}

// --- SortableJS Setup ---
function initSortable() {
    destroySortable(); // Очищаем предыдущие инстансы

    // Sortable для магазинов (переупорядочивание секций магазинов)
    if (editScreen) {
        storesSortable = new Sortable(editScreen, {
            animation: 250,
            easing: "cubic-bezier(0.25, 1, 0.5, 1)",
            handle: '.store-drag-handle', // Ручка для перетаскивания магазина
            draggable: '.store-section',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            filter: '#addStoreButton', // Исключаем кнопку "Добавить магазин"
            preventOnFilter: false,
            forceFallback: true, // Важно для мобильных!
            fallbackTolerance: 3,
            delay: 150, // Задержка перед началом drag на мобильных
            delayOnTouchOnly: true,
            touchStartThreshold: 5,
            onChoose: function() {
                hapticFeedback('impact', 'medium');
            },
            onEnd: function(evt) {
                if (evt.oldIndex === evt.newIndex) return;
                hapticFeedback('impact', 'light');

                // Обновляем локальные данные
                const oldIndex = evt.oldIndex;
                const newIndex = evt.newIndex;
                const [movedStore] = shoppingListData.stores.splice(oldIndex, 1);
                shoppingListData.stores.splice(newIndex, 0, movedStore);

                console.log(`Магазин "${movedStore.name}" перемещен с позиции ${oldIndex} на ${newIndex}`);

                // Собираем новый порядок магазинов с их _id
                const storeOrders = [];
                const storeSections = editScreen.querySelectorAll('.store-section');
                storeSections.forEach((section, index) => {
                    const storeId = section.dataset.storeId;
                    if (storeId) {
                        storeOrders.push({ storeId, order: index });
                    }
                });

                // Отправляем на сервер
                if (storeOrders.length > 0) {
                    reorderStores(storeOrders);
                }
            }
        });
    }

    // Sortable для товаров внутри каждого магазина
    const productContainers = document.querySelectorAll('.product-items-container');
    productContainers.forEach(container => {
        const sortable = new Sortable(container, {
            group: 'products', // Позволяет перетаскивать между разными контейнерами
            animation: 250,
            easing: "cubic-bezier(0.25, 1, 0.5, 1)",
            handle: '.product-drag-handle', // Ручка для перетаскивания товара
            draggable: '.product-item',
            ghostClass: 'sortable-ghost',
            chosenClass: 'sortable-chosen',
            dragClass: 'sortable-drag',
            forceFallback: true, // Важно для мобильных!
            fallbackTolerance: 3,
            delay: 100,
            delayOnTouchOnly: true,
            touchStartThreshold: 3,
            emptyInsertThreshold: 20, // Порог для вставки в пустой контейнер
            onChoose: function() {
                hapticFeedback('impact', 'light');
            },
            onStart: function(evt) {
                // Добавляем класс ко всем контейнерам для визуального feedback
                document.querySelectorAll('.product-items-container').forEach(c => {
                    c.classList.add('drop-zone-active');
                });
            },
            onAdd: function(evt) {
                // Удаляем пустое сообщение при добавлении товара в контейнер
                const container = evt.to;
                const emptyMsg = container.querySelector('.empty-store-message');
                if (emptyMsg) {
                    emptyMsg.remove();
                }
            },
            onRemove: function(evt) {
                // Добавляем пустое сообщение если контейнер стал пустым
                const container = evt.from;
                if (container.querySelectorAll('.product-item').length === 0) {
                    const storeName = container.dataset.storeName;
                    const emptyMessage = document.createElement('p');
                    emptyMessage.className = 'empty-store-message text-xs text-gray-500 p-2 text-center pointer-events-none';
                    emptyMessage.textContent = 'Перетащите сюда товары';
                    container.appendChild(emptyMessage);
                }
            },
            onEnd: function(evt) {
                // Убираем классы
                document.querySelectorAll('.product-items-container').forEach(c => {
                    c.classList.remove('drop-zone-active');
                });

                const itemEl = evt.item;
                const productId = itemEl.dataset.productId;
                const fromContainer = evt.from;
                const toContainer = evt.to;
                const sourceStoreName = fromContainer.dataset.storeName;
                const targetStoreName = toContainer.dataset.storeName;
                const sourceStoreId = fromContainer.dataset.storeId;
                const targetStoreId = toContainer.dataset.storeId;
                const oldIndex = evt.oldIndex;
                const newIndex = evt.newIndex;

                // Если перемещение в тот же контейнер на ту же позицию - ничего не делаем
                if (fromContainer === toContainer && oldIndex === newIndex) return;

                hapticFeedback('impact', 'light');

                const sourceStore = shoppingListData.stores.find(s => s.name === sourceStoreName);
                const targetStore = shoppingListData.stores.find(s => s.name === targetStoreName);

                if (!sourceStore) {
                    console.error(`Source store "${sourceStoreName}" not found`);
                    renderEditScreenDOM(); // Восстанавливаем UI
                    return;
                }

                // Находим товар по ID в исходном магазине
                const productIndex = sourceStore.items.findIndex(p => (p.id && p.id.toString() === productId) || (p._id && p._id.toString() === productId));
                if (productIndex === -1) {
                    console.error(`Product "${productId}" not found in store "${sourceStoreName}"`);
                    renderEditScreenDOM();
                    return;
                }

                // Извлекаем товар
                const [product] = sourceStore.items.splice(productIndex, 1);
                const itemId = (product._id || product.id)?.toString();

                if (fromContainer === toContainer) {
                    // Перемещение внутри одного магазина
                    sourceStore.items.splice(newIndex, 0, product);
                    console.log(`Товар "${product.name}" перемещен внутри "${sourceStoreName}" с ${oldIndex} на ${newIndex}`);

                    // Отправляем на сервер
                    if (itemId && sourceStoreId) {
                        reorderItem(itemId, sourceStoreId, newIndex);
                    }
                } else {
                    // Перемещение между магазинами
                    if (!targetStore) {
                        console.error(`Target store "${targetStoreName}" not found`);
                        sourceStore.items.splice(productIndex, 0, product); // Возвращаем обратно
                        renderEditScreenDOM();
                        return;
                    }

                    targetStore.items.splice(newIndex, 0, product);
                    console.log(`Товар "${product.name}" перемещен из "${sourceStoreName}" в "${targetStoreName}" на позицию ${newIndex}`);

                    // Отправляем на сервер
                    if (itemId && sourceStoreId && targetStoreId) {
                        moveItem(itemId, sourceStoreId, targetStoreId, newIndex);
                    }
                }

                // Обновляем data-атрибуты у элемента
                itemEl.dataset.storeName = targetStoreName;
                if (targetStoreId) itemEl.dataset.storeId = targetStoreId;
            }
        });
        productSortables.push(sortable);
    });
}

function destroySortable() {
    if (storesSortable) {
        storesSortable.destroy();
        storesSortable = null;
    }
    productSortables.forEach(s => s.destroy());
    productSortables = [];
}

// --- UI Рендеринг и логика элементов ---
function createProductItemDOM(product, storeName, storeId) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'product-item flex items-center gap-2 p-3 bg-[#2d372a] rounded-lg';
    itemDiv.dataset.productId = (product._id || product.id)?.toString();
    itemDiv.dataset.storeName = storeName;
    if (storeId) itemDiv.dataset.storeId = storeId.toString();

    itemDiv.innerHTML = `
        <button class="product-drag-handle text-gray-400 hover:text-white transition-colors p-1 touch-none">
            <svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="20"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle><circle cx="5" cy="5" r="1"></circle><circle cx="5" cy="12" r="1"></circle><circle cx="5" cy="19" r="1"></circle></svg>
        </button>
        <div class="flex flex-col flex-grow min-w-0">
            <input class="product-name-input bg-transparent text-white text-sm font-medium focus:ring-0 border-0 p-0 focus:border-[#53d22c] w-full" type="text" value="${product.name}">
            <input class="notes-input bg-transparent text-gray-500 text-xs focus:ring-0 border-0 p-0 focus:border-[#53d22c] w-full mt-0.5" type="text" placeholder="Заметка..." value="${product.notes || ''}">
        </div>
        <div class="flex items-center gap-1">
            <button class="quantity-decrease text-gray-400 hover:text-white transition-colors rounded-full w-6 h-6 flex items-center justify-center bg-[#1f251d] hover:bg-[#3a4a36]">
                <svg fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="16"><line x1="5" x2="19" y1="12" y2="12"></line></svg>
            </button>
            <span class="quantity-value text-white text-sm w-7 text-center tabular-nums">${product.quantity}</span>
            <button class="quantity-increase text-gray-400 hover:text-white transition-colors rounded-full w-6 h-6 flex items-center justify-center bg-[#1f251d] hover:bg-[#3a4a36]">
                <svg fill="none" height="16" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="16"><line x1="12" x2="12" y1="5" y2="19"></line><line x1="5" x2="19" y1="12" y2="12"></line></svg>
            </button>
        </div>
        <input class="unit-input bg-transparent text-gray-400 text-sm w-8 focus:ring-0 border-0 p-0 focus:border-[#53d22c] text-center" type="text" value="${product.unit}">
        <button class="delete-item-button text-red-500 hover:text-red-400 transition-colors p-1">
            <svg fill="none" height="18" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="18"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
    `;

    const productNameInput = itemDiv.querySelector('.product-name-input');
    const unitInput = itemDiv.querySelector('.unit-input');
    const notesInput = itemDiv.querySelector('.notes-input');

    productNameInput.addEventListener('change', (e) => {
        const oldName = product.name;
        const newNameTrimmed = e.target.value.trim();
        if (oldName !== newNameTrimmed && newNameTrimmed) {
            product.name = newNameTrimmed;
            const itemId = (product._id || product.id)?.toString();
            if (itemId) {
                updateItemWS(itemId, { name: newNameTrimmed });
            }
        } else if (!newNameTrimmed && oldName) {
            e.target.value = oldName;
        }
    });

    unitInput.addEventListener('change', (e) => {
        const oldUnit = product.unit;
        const newUnitTrimmed = e.target.value.trim();
        if (oldUnit !== newUnitTrimmed && newUnitTrimmed) {
            product.unit = newUnitTrimmed;
            const itemId = (product._id || product.id)?.toString();
            if (itemId) {
                updateItemWS(itemId, { unit: newUnitTrimmed });
            }
        } else if (!newUnitTrimmed && oldUnit) {
            e.target.value = oldUnit;
        }
    });

    notesInput.addEventListener('change', (e) => {
        const oldNotes = product.notes;
        const newNotesTrimmed = e.target.value.trim();
        if (oldNotes !== newNotesTrimmed) {
            product.notes = newNotesTrimmed;
            const itemId = (product._id || product.id)?.toString();
            if (itemId) {
                updateItemWS(itemId, { notes: newNotesTrimmed });
            }
        }
    });

    itemDiv.querySelector('.quantity-decrease').addEventListener('click', () => updateQuantity(product, -1, itemDiv.querySelector('.quantity-value'), storeName));
    itemDiv.querySelector('.quantity-increase').addEventListener('click', () => updateQuantity(product, 1, itemDiv.querySelector('.quantity-value'), storeName));
    itemDiv.querySelector('.delete-item-button').addEventListener('click', () => deleteProduct(product.id, storeName));

    return itemDiv;
}

function createStoreSectionDOM(store) {
    const section = document.createElement('section');
    section.className = 'store-section bg-[#1f251d] rounded-xl p-4';
    section.dataset.storeName = store.name;
    if (store._id) section.dataset.storeId = store._id.toString();

    const headerDiv = document.createElement('div');
    headerDiv.className = 'flex items-center justify-between mb-4';

    const headerDraggablePart = document.createElement('div');
    headerDraggablePart.className = 'store-drag-handle flex items-center gap-2 flex-grow cursor-grab active:cursor-grabbing touch-none';
    headerDraggablePart.innerHTML = `
        <svg fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24" class="text-gray-400"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle><circle cx="5" cy="5" r="1"></circle><circle cx="5" cy="12" r="1"></circle><circle cx="5" cy="19" r="1"></circle></svg>
        <input class="store-name-input bg-transparent text-white text-lg font-semibold focus:ring-0 border-0 p-0 focus:border-[#53d22c] w-full" type="text" value="${store.name}">
    `;

    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete-store-button text-red-500 hover:text-red-400 transition-colors p-1';
    deleteButton.innerHTML = `<svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="20"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>`;

    headerDiv.appendChild(headerDraggablePart);
    headerDiv.appendChild(deleteButton);

    const productItemsContainer = document.createElement('div');
    productItemsContainer.className = 'product-items-container space-y-3 min-h-[60px] rounded-lg transition-colors duration-200';
    productItemsContainer.dataset.storeName = store.name;
    if (store._id) productItemsContainer.dataset.storeId = store._id.toString();

    const itemsToDisplay = store.items.filter(product => !product.purchased);

    if (itemsToDisplay.length === 0) {
        const emptyMessage = document.createElement('p');
        emptyMessage.className = 'empty-store-message text-xs text-gray-500 p-2 text-center pointer-events-none';
        emptyMessage.textContent = store.items.length > 0
            ? `Все товары в "${store.name}" куплены`
            : 'Перетащите сюда товары';
        productItemsContainer.appendChild(emptyMessage);
    } else {
        itemsToDisplay.forEach(product => {
            productItemsContainer.appendChild(createProductItemDOM(product, store.name, store._id));
        });
    }

    section.appendChild(headerDiv);
    section.appendChild(productItemsContainer);

    // Слушатели событий
    headerDraggablePart.querySelector('.store-name-input').addEventListener('change', (e) => updateStoreName(store.name, e.target.value, section.querySelector('.store-name-input')));
    headerDraggablePart.querySelector('.store-name-input').addEventListener('click', (e) => e.stopPropagation());
    headerDraggablePart.querySelector('.store-name-input').addEventListener('mousedown', (e) => e.stopPropagation());
    headerDraggablePart.querySelector('.store-name-input').addEventListener('touchstart', (e) => e.stopPropagation());
    deleteButton.addEventListener('click', () => deleteStore(store.name));

    return section;
}

function renderEditScreenDOM() {
    console.log("renderEditScreenDOM called");
    if (!editScreen) {
        console.error("renderEditScreenDOM: editScreen not found!");
        return;
    }

    // Уничтожаем старые Sortable инстансы перед перерисовкой
    destroySortable();

    const existingSections = editScreen.querySelectorAll('.store-section');
    existingSections.forEach(sec => sec.remove());

    if (shoppingListData.stores && shoppingListData.stores.length > 0) {
        shoppingListData.stores.forEach(store => {
            const storeSectionDOM = createStoreSectionDOM(store);
            if (addStoreButton && editScreen.contains(addStoreButton)) {
                editScreen.insertBefore(storeSectionDOM, addStoreButton);
            } else {
                editScreen.appendChild(storeSectionDOM);
            }
        });
    }

    // Инициализируем SortableJS после рендеринга
    // Используем setTimeout чтобы DOM успел обновиться
    setTimeout(() => {
        initSortable();
    }, 0);
}

function updateQuantity(product, change, quantityValueElement, storeName) {
    const oldQuantity = product.quantity;
    let currentQuantity = parseFloat(product.quantity);
    const unit = product.unit.toLowerCase();
    let step = 1;

    if (unit === "гр" || unit === "г" || unit === "грамм") step = 50;
    else if (unit === "кг" || unit === "килограмм") step = 0.1;

    currentQuantity += (change * step);

    if (unit === "кг" || unit === "л" || (step < 1 && step > 0)) {
        currentQuantity = parseFloat(currentQuantity.toFixed(Math.max(1, (step.toString().split('.')[1] || '').length)));
    } else {
        currentQuantity = Math.round(currentQuantity);
    }

    if (currentQuantity < 0) {
        currentQuantity = 0;
    }

    if (oldQuantity === 0 && change < 0) {
        currentQuantity = 0;
    }

    if (product.quantity !== currentQuantity) {
        product.quantity = currentQuantity;
        if(quantityValueElement) quantityValueElement.textContent = product.quantity;
        const itemId = (product._id || product.id)?.toString();
        if (itemId) {
            updateItemWS(itemId, { quantity: currentQuantity });
        }
    }
}

function updateStoreName(oldName, newName, inputElement) {
    newName = newName.trim();
    if (oldName === newName || !newName) {
        if (inputElement) inputElement.value = oldName;
        return;
    }
    const storeExists = shoppingListData.stores.find(s => s.name === newName);
    if (storeExists) {
        alert("Магазин с таким именем уже существует!");
        if (inputElement) inputElement.value = oldName;
        return;
    }
    const storeToUpdate = shoppingListData.stores.find(s => s.name === oldName);
    if (storeToUpdate) {
        // Оптимистичное обновление локального состояния
        storeToUpdate.name = newName;
        if (shoppingListData.activeStoreFilter === oldName) {
            shoppingListData.activeStoreFilter = newName;
        }
        renderEditScreenDOM();

        // Отправляем на сервер через WebSocket
        if (storeToUpdate._id) {
            updateStoreWS(storeToUpdate._id.toString(), { name: newName });
        }
    }
}

function deleteStore(storeName) {
    const storeIndex = shoppingListData.stores.findIndex(s => s.name === storeName);
    if (storeIndex === -1) return;

    if (confirm(`Вы уверены, что хотите удалить магазин "${storeName}" и все его товары?`)) {
        const deletedStore = shoppingListData.stores[storeIndex];
        const storeId = deletedStore._id?.toString();

        // Оптимистичное обновление локального состояния
        shoppingListData.stores.splice(storeIndex, 1);
        if (shoppingListData.activeStoreFilter === storeName) {
            shoppingListData.activeStoreFilter = "Все";
        }
        renderEditScreenDOM();

        // Отправляем на сервер через WebSocket
        if (storeId) {
            deleteStoreWS(storeId);
        }
    }
}

function deleteProduct(productId, storeName) {
    const store = shoppingListData.stores.find(s => s.name === storeName);
    if (store) {
        const itemIndex = store.items.findIndex(item => (item.id === productId) || (item._id?.toString() === productId));
        if (itemIndex === -1) return;

        const deletedItem = store.items[itemIndex];
        const itemId = (deletedItem._id || deletedItem.id)?.toString();

        // Оптимистичное обновление локального состояния
        store.items.splice(itemIndex, 1);
        renderEditScreenDOM();

        // Отправляем на сервер через WebSocket
        if (itemId) {
            deleteItemWS(itemId);
        }
    }
}

export async function sendAudioToGeminiFromEditView(base64Audio, mimeType, geminiModelInstance, previousShoppingListDataForUndo) {
    if (!geminiModelInstance) {
        alert("Модель Gemini не инициализирована для голосового ввода.");
        updateGlobalMicStatus("Ошибка Gemini!", 3000);
        return;
    }
    updateGlobalMicStatus("Ответ от Gemini...");
    console.log("editViewLogic: Sending audio to Gemini via global handler...");

    const currentStoresForPrompt = shoppingListData.stores
        .filter(store => store.items.some(item => !item.purchased))
        .map(store => ({
            name: store.name,
            items: store.items.filter(item => !item.purchased).map(item => ({
                id: item.id, name: item.name, quantity: item.quantity, unit: item.unit, emoji: item.emoji, notes: item.notes
            }))
        }));
    const currentListJSON = JSON.stringify(currentStoresForPrompt, null, 2);

    const prompt = `
Ты — умный помощник для составления списка покупок. В списке редактирования показываются только НЕКУПЛЕННЫЕ товары.
Текущий НЕКУПЛЕННЫЙ список покупок (в формате JSON):
\`\`\`json
${currentListJSON}
\`\`\`
Пользователь сейчас произнесет голосовую команду. Твоя задача — обновить список покупок на основе этой команды.
Правила обновления:
1.  Обновляй или добавляй товары только в этот список НЕКУПЛЕННЫХ товаров.
2.  Если пользователь называет продукт, который уже есть в списке (сверяйся по названию и существующему \`id\`), ОБНОВИ его количество, единицу измерения, магазин или заметку. **Если количество для существующего товара не уточнено в команде, НЕ МЕНЯЙ его.** Для остальных свойств этого продукта, которые не были явно изменены командой, сохрани их текущие значения.
3.  Если пользователь называет новый продукт, ДОБАВЬ его в список. **Если количество для нового продукта не указано явно, установи "quantity": 0.** По умолчанию он не куплен.
Каждый продукт должен содержать 'name', 'quantity' (число, **может быть 0, если не указано для нового товара**), 'unit' (строка), 'emoji', 'notes'. Если продукт существовал, ОБЯЗАТЕЛЬНО включи его 'id'.
Пример ответа:
[
  { "name": "Магазин А", "items": [
    { "id": "item_abc123", "name": "Молоко", "quantity": 2, "unit": "л", "emoji": "🥛", "notes": "Без лактозы" },
    { "name": "Мука", "quantity": 0, "unit": "кг", "emoji": "🌾", "notes": "Высший сорт" }
  ] }
]
Если команда не относится к списку или не понятна, верни ИСХОДНЫЙ НЕКУПЛЕННЫЙ список (\`currentListJSON\`) без изменений.
Голосовая команда: (аудио данные)
`;

    try {
        const result = await geminiModelInstance.generateContent([
            prompt, { inlineData: { data: base64Audio, mimeType: mimeType } }
        ]);
        const response = await result.response;
        const text = response.text();
        console.log("Gemini response text (from editViewLogic):", text);

        let updatedStoresArrayFromGemini;
        try {
            const match = text.match(/```json\s*([\s\S]*?)\s*```/);
            const cleanedText = match ? match[1].trim() : text.trim();
            updatedStoresArrayFromGemini = JSON.parse(cleanedText);
        } catch (e) {
            console.error("Failed to parse Gemini JSON response (from editViewLogic):", e, "Raw text:", text);
            alert("Ошибка разбора ответа голосового помощника.");
            return;
        }

        console.log("PARSED Gemini response (from editViewLogic):", JSON.stringify(updatedStoresArrayFromGemini, null, 2));
        updateGlobalMicStatus("Обработка ответа...");
        if (Array.isArray(updatedStoresArrayFromGemini)) {
            const oldUnpurchasedItemsMap = new Map();
            previousShoppingListDataForUndo.stores.forEach(store => {
                store.items.forEach(item => {
                    if (!item.purchased) {
                        oldUnpurchasedItemsMap.set(item.id, JSON.parse(JSON.stringify(item)));
                    }
                });
            });

            let newProcessedFullShoppingList = JSON.parse(JSON.stringify(previousShoppingListDataForUndo));

            newProcessedFullShoppingList.stores.forEach(store => {
                store.items = store.items.filter(item => item.purchased);
            });

            for (const storeDataFromGemini of updatedStoresArrayFromGemini) {
                const storeName = storeDataFromGemini.name || "Неизвестный магазин";
                const itemsFromGemini = storeDataFromGemini.items || [];

                let targetStore = newProcessedFullShoppingList.stores.find(s => s.name === storeName);
                if (!targetStore) {
                    targetStore = { name: storeName, items: [] };
                    newProcessedFullShoppingList.stores.push(targetStore);
                }

                for (const itemDataFromGemini of itemsFromGemini) {
                    const itemId = itemDataFromGemini.id || generateId();
                    const oldUnpurchasedItem = oldUnpurchasedItemsMap.get(itemDataFromGemini.id);

                    const newItem = {
                        id: itemId,
                        name: itemDataFromGemini.name || (oldUnpurchasedItem ? oldUnpurchasedItem.name : "Неизвестный продукт"),
                        quantity: (typeof itemDataFromGemini.quantity !== 'undefined')
                        ? parseFloat(itemDataFromGemini.quantity)
                        : (oldUnpurchasedItem ? oldUnpurchasedItem.quantity : 0),
                        unit: itemDataFromGemini.unit || (oldUnpurchasedItem ? oldUnpurchasedItem.unit : "шт"),
                        emoji: itemDataFromGemini.emoji || (oldUnpurchasedItem ? oldUnpurchasedItem.emoji : "🛒"),
                        purchased: false,
                        notes: ""
                    };

                    const geminiNotes = itemDataFromGemini.notes;
                    const oldNotes = oldUnpurchasedItem ? oldUnpurchasedItem.notes : undefined;

                    if (typeof geminiNotes !== 'undefined' && geminiNotes !== "") {
                        newItem.notes = geminiNotes;
                    } else if (typeof oldNotes !== 'undefined' && oldNotes !== "") {
                        newItem.notes = oldNotes;
                    } else if (typeof geminiNotes !== 'undefined') {
                        newItem.notes = geminiNotes;
                    }

                    targetStore.items.push(newItem);
                    if (oldUnpurchasedItem) {
                        oldUnpurchasedItemsMap.delete(itemDataFromGemini.id);
                    }
                }
            }

            oldUnpurchasedItemsMap.forEach(forgottenItem => {
                let originalStoreName = null;
                for (const store of previousShoppingListDataForUndo.stores) {
                    if (store.items.some(i => i.id === forgottenItem.id)) {
                        originalStoreName = store.name;
                        break;
                    }
                }
                if (originalStoreName) {
                    let targetStore = newProcessedFullShoppingList.stores.find(s => s.name === originalStoreName);
                    if (!targetStore) {
                        targetStore = { name: originalStoreName, items: [] };
                        newProcessedFullShoppingList.stores.push(targetStore);
                    }
                    if (!targetStore.items.some(i => i.id === forgottenItem.id)) {
                        if (!forgottenItem.purchased) targetStore.items.push(forgottenItem);
                    }
                }
            });

            const newShoppingListStateForCompare = { stores: newProcessedFullShoppingList.stores, activeStoreFilter: shoppingListData.activeStoreFilter };
            const newShoppingListString = JSON.stringify(newShoppingListStateForCompare);
            const oldShoppingListString = JSON.stringify(previousShoppingListDataForUndo);

            shoppingListData.stores = newProcessedFullShoppingList.stores;

            console.log("shoppingListData обновлен голосовой командой (editViewLogic). Ожидаем обновления от сервера.");
            updateGlobalMicStatus("Список обновлен!", 2000);
            if (newShoppingListString !== oldShoppingListString) {
                saveData({
                    actionType: 'VOICE_COMMAND_UPDATE',
                    payload: {
                        previousShoppingListData: JSON.parse(JSON.stringify(previousShoppingListDataForUndo))
                    },
                    description: 'Обновление списка голосовой командой (из ред.)'
                });
            } else {
                console.log("Gemini command resulted in no functional change to the list (editViewLogic).");
                updateGlobalMicStatus("Изменений нет.", 2000);
            }
        } else {
            alert("Не удалось обновить список голосовой командой (неверный формат ответа).");
            updateGlobalMicStatus("Ошибка формата ответа!", 3000);
        }
    } catch (error) {
        console.error("Error with Gemini API (from editViewLogic):", error);
        alert("Ошибка при обработке голосовой команды: " + (error.message || "Неизвестная ошибка"));
        updateGlobalMicStatus("Ошибка API Gemini!", 3000);
    }
}
window.sendAudioToGeminiFromEditView = sendAudioToGeminiFromEditView;


// --- Инициализация и уничтожение View ---
export function initEditView(isReload = false) {
    console.log("Initializing Edit View", "Reload:", isReload);
    editScreen = document.getElementById('editScreen');
    addStoreButton = document.getElementById('addStoreButton');
    backButton = document.getElementById('backButton');
    editPageContainer = document.getElementById('editPageContainer');

    if (!editScreen || !addStoreButton || !backButton || !editPageContainer) {
        console.error("Edit view critical elements not found in DOM! Aborting initEditView.");
        const appContainer = document.getElementById('app-container');
        if (appContainer) appContainer.innerHTML = "<p class='p-4 text-red-500'>Ошибка загрузки экрана редактирования.</p>";
        return;
    }

    renderEditScreenDOM();

    backButton.removeEventListener('click', handleBackButtonClick);
    backButton.addEventListener('click', handleBackButtonClick);

    addStoreButton.removeEventListener('click', handleAddStoreClick);
    addStoreButton.addEventListener('click', handleAddStoreClick);

    if (editPageContainer) {
        removeSwipeListeners(editPageContainer);
        addSwipeListeners(editPageContainer, null, () => navigateTo('#main'));
    }
}

function handleBackButtonClick() {
    navigateTo('#main');
}

function handleAddStoreClick() {
    let newStoreName = "Новый магазин";
    let counter = 1;
    while (shoppingListData.stores.find(s => s.name === newStoreName)) {
        newStoreName = `Новый магазин ${counter++}`;
    }

    // Оптимистичное обновление локального состояния
    const newStore = { name: newStoreName, items: [] };
    shoppingListData.stores.push(newStore);
    renderEditScreenDOM();

    // Отправляем на сервер через WebSocket
    addStoreWS(newStoreName);
}

export function destroyEditView() {
    console.log("Destroying Edit View");

    destroySortable();

    if (editPageContainer) {
        removeSwipeListeners(editPageContainer);
    }

    if (backButton) backButton.removeEventListener('click', handleBackButtonClick);
    if (addStoreButton) addStoreButton.removeEventListener('click', handleAddStoreClick);

    editScreen = null;
    addStoreButton = null;
    backButton = null;
    editPageContainer = null;
}
