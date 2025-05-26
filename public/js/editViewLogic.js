// public/js/editViewLogic.js
import { shoppingListData, saveData, generateId, navigateTo, addSwipeListeners, removeSwipeListeners, updateGlobalMicStatus } from './app.js'; // <--- Добавлен updateGlobalMicStatus

// --- Переменные на уровне модуля для DOM-элементов и состояния ---
let editScreen,
    addStoreButton,
    backButton,
    editPageContainer;


// D&D переменные
let draggedDOMElement = null;
let draggedItemData = null;

// --- Вспомогательная функция ---
function findStoreNameByProductId(productId) {
    for (const store of shoppingListData.stores) {
        if (store.items.some(item => item.id === productId)) {
            return store.name;
        }
    }
    return null; // Если товар не найден ни в одном магазине
}

// --- Drag and Drop Логика ---
function handleDragStart(e) {
    // Логика из вашего предыдущего edit.html, адаптированная
    const productItem = e.target.closest('.product-item');
    const storeSection = e.target.closest('.store-section');
    let draggableElement = null;

    if (productItem && (e.target.classList.contains('drag-handle') || e.target.closest('.drag-handle') || e.target === productItem)) {
        draggableElement = productItem;
        draggedItemData = {
            type: 'product',
            id: draggableElement.dataset.productId,
            sourceStore: draggableElement.dataset.storeName // <--- ЭТО УЖЕ ДОЛЖНО БЫТЬ
        };
    }  else if (storeSection) {
        const headerDraggablePart = storeSection.querySelector('.drag-handle'); // Ищем ручку в заголовке магазина
        // Позволяем тащить за ручку или за всю секцию, если ручки нет или клик по ней
        if ( (headerDraggablePart && headerDraggablePart.contains(e.target)) || e.target === storeSection || (e.target.classList.contains('drag-handle') && storeSection.contains(e.target)) ) {
           draggableElement = storeSection;
            draggedItemData = {
                type: 'store',
                id: draggableElement.dataset.storeName
            };
        }
    }

    if (!draggableElement || !draggedItemData) {
        // e.preventDefault(); // Не всегда нужно, браузер сам обрабатывает, если нет draggable
        return;
    }
    
    draggedDOMElement = draggableElement;
    e.dataTransfer.effectAllowed = 'move';
    try {
        e.dataTransfer.setData('text/json', JSON.stringify(draggedItemData));
    } catch (error) {
        console.error("Error setting drag data:", error);
        // e.preventDefault(); // Предотвратить начало перетаскивания, если данные не установились
        return;
    }
    
    // Небольшая задержка перед добавлением класса 'dragging'
    // чтобы браузер успел создать "призрачное" изображение элемента
    setTimeout(() => { if (draggedDOMElement) draggedDOMElement.classList.add('dragging'); }, 0);
}

function handleDragEnd(e) {
    console.log("--- handleDragEnd --- effectAllowed:", e.dataTransfer.effectAllowed, "dropEffect:", e.dataTransfer.dropEffect); // <--- НОВЫЙ ЛОГ
    if (draggedDOMElement) {
        draggedDOMElement.classList.remove('dragging');
    }
    draggedDOMElement = null;
    draggedItemData = null;
    // Очистка классов подсветки зон для drop
    document.querySelectorAll('.drag-over-store .product-items-container').forEach(el => el.classList.remove('drag-over-store'));
    document.querySelectorAll('.drag-over-main').forEach(el => el.classList.remove('drag-over-main'));
    if (editScreen) editScreen.classList.remove('drag-over-main'); // На всякий случай
}

// public/js/editViewLogic.js
function handleDragOverProductContainer(e) {
    e.preventDefault(); 
    if (draggedItemData && draggedItemData.type === 'product') { // Только если тащим товар
        const targetContainer = e.target.closest('.product-items-container');
        if (targetContainer) {
            if (!targetContainer.classList.contains('drag-over-store')) {
                document.querySelectorAll('.drag-over-store').forEach(el => el.classList.remove('drag-over-store'));
                targetContainer.classList.add('drag-over-store');
            }
            e.dataTransfer.dropEffect = 'move';
            // console.log('Drag over product container:', targetContainer.dataset.storeName); 
        }
    } else {
        // Если тащим не товар (например, магазин), то на контейнере товаров drop не разрешен
        // или можно вообще ничего не делать, так как handleDragOverEditScreen должен перехватить
        // e.dataTransfer.dropEffect = 'none'; // Можно и так, если хотим явно запретить
    }
}

function handleDragLeaveProductContainer(e) {
    const targetContainer = e.target.closest('.product-items-container');
    if (targetContainer && !targetContainer.contains(e.relatedTarget)) { // Уходим из контейнера, а не на дочерний элемент
        targetContainer.classList.remove('drag-over-store');
    }
}

function handleDropOnProductContainer(e) {
    console.log("--- handleDropOnProductContainer ENTERED ---", e.target); // <--- НОВЫЙ ЛОГ В САМОМ НАЧАЛЕ

    e.preventDefault();
    e.stopPropagation(); 
    const targetProductContainer = e.target.closest('.product-items-container');
    if (!targetProductContainer) {
        console.warn("D&D Drop: Target product container not found.");
        return;
    }

    targetProductContainer.classList.remove('drag-over-store');

    const dataTransfer = e.dataTransfer.getData('text/json');
    if (!dataTransfer) {
        console.warn("D&D Drop: No data transferred.");
        return;
    }
    let draggedData;
    try {
      draggedData = JSON.parse(dataTransfer);
    } catch (error) {
      console.error("D&D Drop: Error parsing dragged data:", error);
      return;
    }

    if (!draggedData || draggedData.type !== 'product' || !draggedData.id) {
        console.warn("D&D Drop: Invalid or non-product data.", draggedData);
        return;
    }

    const productId = draggedData.id;
    const sourceStoreName = draggedData.sourceStore;
    const targetStoreName = targetProductContainer.dataset.storeName;

    console.log(`D&D Product Drop: Item ID "${productId}" from store "${sourceStoreName}" to store "${targetStoreName}"`);

    const sourceStore = shoppingListData.stores.find(s => s.name === sourceStoreName);
    const targetStore = shoppingListData.stores.find(s => s.name === targetStoreName);

    if (!sourceStore) {
        console.error(`D&D Drop: Source store "${sourceStoreName}" not found!`);
        return;
    }
    if (!targetStore) {
        console.error(`D&D Drop: Target store "${targetStoreName}" not found!`);
        return;
    }

    const productIndexInSource = sourceStore.items.findIndex(p => p.id === productId);
    if (productIndexInSource === -1) {
        console.error(`D&D Drop: Product ID "${productId}" not found in source store "${sourceStoreName}".`);
        // Это может случиться, если данные сильно рассинхронизированы, или ошибка в dragStart
        return;
    }
    
    // Извлекаем товар из исходного магазина
    const [productToMove] = sourceStore.items.splice(productIndexInSource, 1);
    console.log(`  Removed item "${productToMove.name}" from source store "${sourceStoreName}" at index ${productIndexInSource}`);

    // Определяем позицию для вставки в целевом магазине
    const afterElement = getDragAfterElement(targetProductContainer, e.clientY, '.product-item');
    let targetIndexInData;

    if (afterElement == null) { // Вставляем в конец списка целевого магазина
        targetStore.items.push(productToMove);
        targetIndexInData = targetStore.items.length - 1;
        console.log(`  Appended item "${productToMove.name}" to target store "${targetStoreName}"`);
    } else {
        const targetProductDOMId = afterElement.dataset.productId;
        // Находим индекс элемента, ПЕРЕД которым нужно вставить
        targetIndexInData = targetStore.items.findIndex(p => p.id === targetProductDOMId);
        
        if (targetIndexInData === -1) {
            // Если afterElement не найден в данных (маловероятно, если DOM синхронизирован с данными)
            // или если targetStore.items был пуст, но afterElement как-то определился (не должно быть)
            targetStore.items.push(productToMove); // Вставляем в конец как fallback
            targetIndexInData = targetStore.items.length - 1;
            console.warn(`  afterElement ID "${targetProductDOMId}" not found in target store data. Appended item "${productToMove.name}".`);
        } else {
            targetStore.items.splice(targetIndexInData, 0, productToMove); // Вставляем перед элементом "afterElement"
            console.log(`  Inserted item "${productToMove.name}" into target store "${targetStoreName}" at index ${targetIndexInData}`);
        }
    }
    
    // Обновляем dataset.storeName у перемещенного элемента в DOM (хотя renderEditScreenDOM все перерисует)
    // Это может быть полезно, если есть какая-то логика, зависящая от dataset сразу после drop до ререндера.
    // const droppedProductElement = targetProductContainer.querySelector(`.product-item[data-product-id="${productId}"]`);
    // if (droppedProductElement) {
    //     droppedProductElement.dataset.storeName = targetStoreName;
    // }
    
    renderEditScreenDOM(); // Перерисовываем UI, чтобы отразить изменения в данных
    
    saveData({
        actionType: 'MOVE_ITEM', // Используем общий тип действия для перемещения
        payload: {
            itemId: productId,
            productName: productToMove.name, // Для описания в истории
            sourceStoreName: sourceStoreName,
            targetStoreName: targetStoreName,
            originalIndexInSource: productIndexInSource,
            newIndexInTarget: targetIndexInData 
        },
        description: `Товар '${productToMove.name}' перемещен из '${sourceStoreName}' в '${targetStoreName}'`
    });
}

// public/js/editViewLogic.js
function handleDragOverEditScreen(e) {
    e.preventDefault(); // Разрешаем drop по умолчанию, если другие условия не запретят
    
    if (draggedItemData && draggedItemData.type === 'store') {
        // Если тащим магазин
        // Не подсвечивать и не разрешать drop, если мы над контейнером продуктов
        // или над другой секцией магазина, которая не является перетаскиваемой (т.е. не .dragging)
        const overProductContainer = e.target.closest('.product-items-container');
        const overOtherStoreSection = e.target.closest('.store-section:not(.dragging)');

        if (!overProductContainer && !overOtherStoreSection) {
            if (editScreen && !editScreen.classList.contains('drag-over-main')) {
                document.querySelectorAll('.drag-over-main').forEach(el => el.classList.remove('drag-over-main'));
                editScreen.classList.add('drag-over-main');
            }
            e.dataTransfer.dropEffect = 'move';
        } else {
            // Если мы над контейнером продуктов или другим магазином, когда тащим магазин,
            // то основной editScreen не должен обрабатывать этот dropEffect.
            // Пусть обработчики этих элементов решают (хотя для магазина на магазин drop не должен быть)
            // Важно не ставить 'none', если подсветка product-container должна работать.
            // Тут editScreen не является конечной точкой для drop магазина, если мы над другим элементом.
            if (editScreen) editScreen.classList.remove('drag-over-main'); // Убираем подсветку с editScreen
            // dropEffect для магазина на другой магазин или на контейнер товаров не должен быть 'move' на уровне editScreen
            // Если мы хотим запретить drop магазина на товарный контейнер, то здесь можно поставить 'none'
            // Но обычно это решается в dragover самого товарного контейнера (он не должен реагировать на type 'store')
             if (overProductContainer) e.dataTransfer.dropEffect = 'none'; // Запрещаем бросать магазин на контейнер товаров

        }
    } else if (draggedItemData && draggedItemData.type === 'product') {
        // Если тащим товар, но не над контейнером товаров (например, между магазинами по пустому месту)
        // то на editScreen drop не разрешен. Подсветку editScreen убираем.
        if (editScreen) editScreen.classList.remove('drag-over-main');
        e.dataTransfer.dropEffect = 'none';
    } else {
        // Если тащим что-то неизвестное
        if (editScreen) editScreen.classList.remove('drag-over-main');
        e.dataTransfer.dropEffect = 'none';
    }
}

function handleDragLeaveEditScreen(e) {
    if (editScreen && (e.target === editScreen || !editScreen.contains(e.relatedTarget))) {
        editScreen.classList.remove('drag-over-main');
    }
}

function handleDropOnEditScreen(e) {
    console.log("--- handleDropOnEditScreen ENTERED --- Target:", e.target); // Лог
    e.preventDefault();
    
    // Важно! Если drop произошел на элементе, который сам обрабатывает drop (product-items-container),
    // то этот обработчик не должен выполняться (так как там e.stopPropagation()).
    // Но если e.stopPropagation() не сработал, эта проверка нужна.
    if (e.target.closest('.product-items-container')) {
        console.log("Drop on editScreen ignored, was on product-items-container.");
        if(editScreen) editScreen.classList.remove('drag-over-main');
        return;
    }
    // Также, если бросили на другую секцию магазина, это не должно здесь обрабатываться
    // (хотя reordering магазинов как раз и происходит бросанием на "пустое" место или между ними)
    // Но если мы бросили ТОЧНО на другую секцию (не на пустое место для reorder), то тоже игнорируем.
    // Эта логика сложна, getDragAfterElement должна помочь с позиционированием.

    if(editScreen) editScreen.classList.remove('drag-over-main');
    
    const dataTransfer = e.dataTransfer.getData('text/json');
    if (!dataTransfer) { console.warn("Drop on editScreen: No dataTransfer."); return; }
    let draggedData;
    try {
      draggedData = JSON.parse(dataTransfer);
    } catch (error) {
      console.error("Drop on editScreen: Error parsing data:", error); return;
    }

    console.log("Drop on editScreen, dragged data:", draggedData);

    if (!draggedData || draggedData.type !== 'store' || !draggedData.id) {
        console.warn("Drop on editScreen: Invalid or non-store data.");
        return; // Только магазины можно бросать на editScreen для пересортировки
    }

    const storeName = draggedData.id;
    const storeIndex = shoppingListData.stores.findIndex(s => s.name === storeName);
    if (storeIndex === -1) {
        console.warn(`Drop on editScreen: Store "${storeName}" not found in data.`);
        return;
    }

    const [storeToMove] = shoppingListData.stores.splice(storeIndex, 1);
    console.log(`  Removed store "${storeName}" for reordering from index ${storeIndex}`);
    
    const afterElement = getDragAfterElement(editScreen, e.clientY, '.store-section:not(#addStoreButton):not(.dragging)');
    let targetIndexInData;

    if (afterElement == null || afterElement === addStoreButton) {
        shoppingListData.stores.push(storeToMove);
        targetIndexInData = shoppingListData.stores.length -1;
        console.log(`  Appended store "${storeName}" to the end.`);
    } else {
        const targetStoreDOMName = afterElement.dataset.storeName;
        targetIndexInData = shoppingListData.stores.findIndex(s => s.name === targetStoreDOMName);
        if (targetIndexInData === -1) {
            shoppingListData.stores.push(storeToMove); // Fallback
            targetIndexInData = shoppingListData.stores.length -1;
            console.warn(`  afterElement store "${targetStoreDOMName}" not found in data. Appended store "${storeName}".`);
        } else {
            shoppingListData.stores.splice(targetIndexInData, 0, storeToMove);
            console.log(`  Inserted store "${storeName}" at index ${targetIndexInData}.`);
        }
    }
    renderEditScreenDOM();
    saveData({
        actionType: 'REORDER_STORE',
        payload: { /* ... ваш payload ... */ },
        description: `Магазин '${storeName}' перемещен.`
    });
}

function getDragAfterElement(container, y, childSelector) {
    const draggableElements = [...container.querySelectorAll(`${childSelector}:not(.dragging)`)];
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// --- UI Рендеринг и логика элементов ---
function createProductItemDOM(product, storeName) {
    const itemDiv = document.createElement('div');
    itemDiv.className = 'product-item flex items-center gap-2 p-3 bg-[#2d372a] rounded-lg';
    itemDiv.dataset.productId = product.id;
    itemDiv.dataset.storeName = storeName; // Важно для D&D и поиска
    itemDiv.draggable = true;

    itemDiv.innerHTML = `
        <button class="drag-handle text-gray-400 hover:text-white transition-colors p-1">
            <svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="20"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle><circle cx="5" cy="5" r="1"></circle><circle cx="5" cy="12" r="1"></circle><circle cx="5" cy="19" r="1"></circle></svg>
        </button>
        <div class="flex flex-col flex-grow min-w-0"> <!-- Обертка для имени и заметки -->
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
    const notesInput = itemDiv.querySelector('.notes-input'); // <--- ДОБАВЛЕНО

    productNameInput.addEventListener('change', (e) => {
        const oldName = product.name;
        const newNameTrimmed = e.target.value.trim();
        if (oldName !== newNameTrimmed && newNameTrimmed) {
            product.name = newNameTrimmed;
            saveData({
                actionType: 'UPDATE_ITEM_PROPERTY',
                payload: { itemId: product.id, storeName: storeName, propertyName: 'name', previousValue: oldName, newValue: product.name },
                description: `Продукт '${oldName}' переименован в '${product.name}'`
            });
        } else if (!newNameTrimmed && oldName) {
            e.target.value = oldName; // Возвращаем старое имя, если новое пустое
        }
    });

    unitInput.addEventListener('change', (e) => {
        const oldUnit = product.unit;
        const newUnitTrimmed = e.target.value.trim();
        if (oldUnit !== newUnitTrimmed && newUnitTrimmed) {
            product.unit = newUnitTrimmed;
            saveData({
                actionType: 'UPDATE_ITEM_PROPERTY',
                payload: { itemId: product.id, storeName: storeName, propertyName: 'unit', previousValue: oldUnit, newValue: product.unit },
                description: `Ед.изм. для '${product.name}' изменена: ${oldUnit} -> ${product.unit}`
            });
        } else if (!newUnitTrimmed && oldUnit) {
            e.target.value = oldUnit;
        }
    });

    notesInput.addEventListener('change', (e) => { // <--- НАЧАЛО НОВОГО ОБРАБОТЧИКА
        const oldNotes = product.notes;
        const newNotesTrimmed = e.target.value.trim();
        // Сохраняем, даже если newNotesTrimmed пустая, чтобы можно было очистить заметку
        if (oldNotes !== newNotesTrimmed) {
            product.notes = newNotesTrimmed;
            saveData({
                actionType: 'UPDATE_ITEM_PROPERTY',
                payload: { itemId: product.id, storeName: storeName, propertyName: 'notes', previousValue: oldNotes, newValue: product.notes },
                description: `Заметка для '${product.name}' изменена.`
            });
        }
    }); // <--- КОНЕЦ НОВОГО ОБРАБОТЧИКА
    
    itemDiv.querySelector('.quantity-decrease').addEventListener('click', () => updateQuantity(product, -1, itemDiv.querySelector('.quantity-value'), storeName));
    itemDiv.querySelector('.quantity-increase').addEventListener('click', () => updateQuantity(product, 1, itemDiv.querySelector('.quantity-value'), storeName));
    itemDiv.querySelector('.delete-item-button').addEventListener('click', () => deleteProduct(product.id, storeName));
    
    itemDiv.addEventListener('dragstart', handleDragStart);
    itemDiv.addEventListener('dragend', handleDragEnd);

    console.log(`    createProductItemDOM: Finished creating item "${product.name}". OuterHTML snippet:`, itemDiv.outerHTML.substring(0, 150) + "..."); // <--- ДОБАВИТЬ ЛОГ
    return itemDiv;
}

function createStoreSectionDOM(store) {
    console.log(`Creating DOM for store: "${store.name}". All items in store:`, JSON.parse(JSON.stringify(store.items)));

    const section = document.createElement('section');
    section.className = 'store-section bg-[#1f251d] rounded-xl p-4';
    section.dataset.storeName = store.name;
    section.draggable = true;

    // --- ВОТ ЗДЕСЬ СОЗДАЕТСЯ headerDiv ---
    const headerDiv = document.createElement('div');
    headerDiv.className = 'flex items-center justify-between mb-4';
    
    const headerDraggablePart = document.createElement('div');
    headerDraggablePart.className = 'flex items-center gap-2 flex-grow drag-handle';
    headerDraggablePart.innerHTML = `
        <svg fill="none" height="24" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="24"><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="19" r="1"></circle><circle cx="5" cy="5" r="1"></circle><circle cx="5" cy="12" r="1"></circle><circle cx="5" cy="19" r="1"></circle></svg>
        <input class="store-name-input bg-transparent text-white text-lg font-semibold focus:ring-0 border-0 p-0 focus:border-[#53d22c] w-full" type="text" value="${store.name}">
    `;
    
    const deleteButton = document.createElement('button');
    deleteButton.className = 'delete-store-button text-red-500 hover:text-red-400 transition-colors p-1';
    deleteButton.innerHTML = `<svg fill="none" height="20" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" viewBox="0 0 24 24" width="20"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>`;

    headerDiv.appendChild(headerDraggablePart);
    headerDiv.appendChild(deleteButton);
    // --- КОНЕЦ СОЗДАНИЯ headerDiv ---
    
    const productItemsContainer = document.createElement('div');
    productItemsContainer.className = 'product-items-container space-y-3';
    productItemsContainer.dataset.storeName = store.name;

    const itemsToDisplay = store.items.filter(product => !product.purchased);
    console.log(`  Items to display for store "${store.name}" (after filtering purchased):`, JSON.parse(JSON.stringify(itemsToDisplay)));

    if (itemsToDisplay.length === 0 && store.items.length > 0) {
        productItemsContainer.innerHTML = `<p class="text-xs text-gray-500 p-2 text-center">Все товары в магазине "${store.name}" куплены или отсутствуют.</p>`;
        console.log(`  No items to display for store "${store.name}" because all are purchased or list is empty after filter.`);
    } else if (itemsToDisplay.length === 0 && store.items.length === 0) {
        productItemsContainer.innerHTML = `<p class="text-xs text-gray-500 p-2 text-center">В магазине "${store.name}" пока нет товаров.</p>`;
         console.log(`  No items to display for store "${store.name}" because the item list is empty.`);
    }
    else {
        itemsToDisplay.forEach(product => {
            productItemsContainer.appendChild(createProductItemDOM(product, store.name));
        });
    }

    section.appendChild(headerDiv); // <--- Убедитесь, что headerDiv здесь уже создан
    section.appendChild(productItemsContainer);

    // Слушатели для изменения имени магазина и удаления магазина
    headerDraggablePart.querySelector('.store-name-input').addEventListener('change', (e) => updateStoreName(store.name, e.target.value, section.querySelector('.store-name-input')));
    deleteButton.addEventListener('click', () => deleteStore(store.name));
    
    section.addEventListener('dragstart', handleDragStart); 
    section.addEventListener('dragend', handleDragEnd);
    
    productItemsContainer.addEventListener('dragover', handleDragOverProductContainer);
    productItemsContainer.addEventListener('dragleave', handleDragLeaveProductContainer);
    productItemsContainer.addEventListener('drop', handleDropOnProductContainer); // <--- ЭТОТ СЛУШАТЕЛЬ ВАЖЕН

    console.log(`createStoreSectionDOM: Finished creating section for "${store.name}". OuterHTML snippet:`, section.outerHTML.substring(0, 200) + "..."); // <--- ДОБАВИТЬ ЛОГ
    return section;
}

function renderEditScreenDOM() {
    console.log("renderEditScreenDOM called. shoppingListData:", JSON.parse(JSON.stringify(shoppingListData)));
    if (!editScreen) { // Добавил отдельную проверку для editScreen
        console.error("renderEditScreenDOM: CRITICAL - editScreen element not found in DOM!");
        return;
    }
    if (!addStoreButton) { // Добавил отдельную проверку для addStoreButton
        console.warn("renderEditScreenDOM: addStoreButton element not found in DOM! Store sections will be appended to editScreen directly.");
        // return; // Можно раскомментировать, если addStoreButton критичен для верстки
    }

    const existingSections = editScreen.querySelectorAll('.store-section');
    console.log(`renderEditScreenDOM: Found ${existingSections.length} existing store sections to remove.`);
    existingSections.forEach(sec => sec.remove());

    if (shoppingListData.stores && shoppingListData.stores.length > 0) {
        shoppingListData.stores.forEach(store => {
            console.log(`renderEditScreenDOM: Attempting to create and append section for store "${store.name}"`);
            const storeSectionDOM = createStoreSectionDOM(store); // Эта функция уже имеет свои логи
            if (storeSectionDOM) {
                if (addStoreButton && editScreen.contains(addStoreButton)) { // Проверяем, что addStoreButton все еще в DOM
                    editScreen.insertBefore(storeSectionDOM, addStoreButton);
                    console.log(`renderEditScreenDOM: Store section for "${store.name}" INSERTED BEFORE addStoreButton.`);
                } else {
                    editScreen.appendChild(storeSectionDOM); // Fallback, если addStoreButton нет
                    console.warn(`renderEditScreenDOM: Store section for "${store.name}" APPENDED (addStoreButton not found or not child of editScreen).`);
                }
            } else {
                console.error(`renderEditScreenDOM: storeSectionDOM for store "${store.name}" was null or undefined.`);
            }
        });
    } else {
        console.log("renderEditScreenDOM: No stores in shoppingListData to render.");
        // Можно добавить сообщение на экран, если магазинов нет
        // editScreen.insertBefore(document.createTextNode("Список магазинов пуст. Добавьте новый магазин."), addStoreButton);
    }
}

function updateQuantity(product, change, quantityValueElement, storeName) {
    const oldQuantity = product.quantity;
    let currentQuantity = parseFloat(product.quantity);
    const unit = product.unit.toLowerCase();
    let step = 1;

    if (unit === "гр" || unit === "г" || unit === "грамм") step = 50;
    else if (unit === "кг" || unit === "килограмм") step = 0.1;
    // Можно добавить другие единицы, например, "л" для объема

    currentQuantity += (change * step);

    // Округление
    if (unit === "кг" || unit === "л" || (step < 1 && step > 0) ) { // Если единицы могут быть дробными
        currentQuantity = parseFloat(currentQuantity.toFixed(Math.max(1, (step.toString().split('.')[1] || '').length) )); // Округляем до кол-ва знаков в шаге, но мин 1
    } else { // для штук и т.п.
         currentQuantity = Math.round(currentQuantity);
    }

    // Ограничение снизу
    if (currentQuantity < 0) {
        currentQuantity = 0; // Не может быть меньше нуля
    }

    // Если было 0 и нажали "-", должно остаться 0.
    // Если было 0 и нажали "+", для "шт" должно стать 1, для "кг" - step.
    if (oldQuantity === 0 && change < 0) { // Если было 0 и жмем минус
        currentQuantity = 0;
    }
    // Если было 0 и нажали плюс (а currentQuantity стало step)
    // и это не дробные единицы, то если step=1, то все ок.
    // Это поведение уже покрывается округлением и тем, что currentQuantity станет step.

    if (product.quantity !== currentQuantity) {
        product.quantity = currentQuantity;
        if(quantityValueElement) quantityValueElement.textContent = product.quantity;
        saveData({
            actionType: 'UPDATE_ITEM_PROPERTY',
            payload: {
                itemId: product.id,
                storeName: storeName,
                propertyName: 'quantity',
                previousValue: oldQuantity,
                newValue: product.quantity
            },
            description: `Изменено кол-во ${product.name}: ${oldQuantity} -> ${product.quantity}`
        });
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
        storeToUpdate.name = newName;
        if (shoppingListData.activeStoreFilter === oldName) {
            shoppingListData.activeStoreFilter = newName; // Обновляем активный фильтр, если он был этим магазином
        }
        renderEditScreenDOM();
        saveData({
            actionType: 'UPDATE_STORE_NAME',
            payload: { previousStoreName: oldName, newStoreName: newName },
            description: `Магазин переименован: ${oldName} -> ${newName}`
        });
    }
}

function deleteStore(storeName) {
    const storeIndex = shoppingListData.stores.findIndex(s => s.name === storeName);
    if (storeIndex === -1) return;

    if (confirm(`Вы уверены, что хотите удалить магазин "${storeName}" и все его товары?`)) {
        const deletedStore = JSON.parse(JSON.stringify(shoppingListData.stores[storeIndex]));

        shoppingListData.stores.splice(storeIndex, 1);
        if (shoppingListData.activeStoreFilter === storeName) {
            shoppingListData.activeStoreFilter = "Все";
        }
        
        renderEditScreenDOM();
        saveData({
            actionType: 'DELETE_STORE',
            payload: { deletedStoreData: deletedStore, originalIndex: storeIndex },
            description: `Удален магазин: ${storeName}`
        });
    }
}

function deleteProduct(productId, storeName) {
    const store = shoppingListData.stores.find(s => s.name === storeName);
    if (store) {
        const itemIndex = store.items.findIndex(item => item.id === productId);
        if (itemIndex === -1) return;

        const deletedItem = JSON.parse(JSON.stringify(store.items[itemIndex]));

        store.items.splice(itemIndex, 1); // <--- ТОВАР УДАЛЯЕТСЯ ИЗ shoppingListData.stores[...].items
        renderEditScreenDOM();
        saveData({ // <--- ИЗМЕНЕННЫЙ shoppingListData ОТПРАВЛЯЕТСЯ НА СЕРВЕР
            actionType: 'DELETE_ITEM',
            payload: { deletedItem: deletedItem, storeName: storeName, originalIndex: itemIndex },
            description: `Удален продукт: ${deletedItem.name} из ${storeName}`
        });
    }
}






export async function sendAudioToGeminiFromEditView(base64Audio, mimeType, geminiModelInstance, previousShoppingListDataForUndo) {
    if (!geminiModelInstance) {
        alert("Модель Gemini не инициализирована для голосового ввода.");
        updateGlobalMicStatus("Ошибка Gemini!", 3000); // <--- СТАТУС
        return;
    }
    updateGlobalMicStatus("Ответ от Gemini..."); // <--- СТАТУС
    console.log("editViewLogic: Sending audio to Gemini via global handler...");

    const currentStoresForPrompt = shoppingListData.stores
        .filter(store => store.items.some(item => !item.purchased)) // Отправляем только некупленные товары
        .map(store => ({
            name: store.name,
            items: store.items.filter(item => !item.purchased).map(item => ({ // И здесь только некупленные
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
// ... другие правила ...
1.  Обновляй или добавляй товары только в этот список НЕКУПЛЕННЫХ товаров.
2.  Если пользователь называет продукт, который уже есть в списке (сверяйся по названию и существующему \`id\`), ОБНОВИ его количество, единицу измерения, магазин или заметку. **Если количество для существующего товара не уточнено в команде, НЕ МЕНЯЙ его.** Для остальных свойств этого продукта, которые не были явно изменены командой, сохрани их текущие значения.
3.  Если пользователь называет новый продукт, ДОБАВЬ его в список. **Если количество для нового продукта не указано явно, установи "quantity": 0.** По умолчанию он не куплен.
// ... остальные правила ...
Каждый продукт должен содержать 'name', 'quantity' (число, **может быть 0, если не указано для нового товара**), 'unit' (строка), 'emoji', 'notes'. Если продукт существовал, ОБЯЗАТЕЛЬНО включи его 'id'.
Пример ответа:
[
  { "name": "Магазин А", "items": [ 
    { "id": "item_abc123", "name": "Молоко", "quantity": 2, "unit": "л", "emoji": "🥛", "notes": "Без лактозы" },
    { "name": "Мука", "quantity": 0, "unit": "кг", "emoji": "🌾", "notes": "Высший сорт" } // Пример с нулевым количеством
  ] }
]
Если команда не относится к списку или не понятна, верни ИСХОДНЫЙ НЕКУПЛЕННЫЙ список (\`currentListJSON\`) без изменений.
Голосовая команда: (аудио данные)
`;

    try {
        const result = await geminiModelInstance.generateContent([ // Используем переданную модель
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
        updateGlobalMicStatus("Обработка ответа..."); // <--- СТАТУС
        if (Array.isArray(updatedStoresArrayFromGemini)) {
            // Создаем карту старых НЕКУПЛЕННЫХ товаров для слияния
            const oldUnpurchasedItemsMap = new Map();
            previousShoppingListDataForUndo.stores.forEach(store => {
                store.items.forEach(item => {
                    if (!item.purchased) { // Только некупленные
                        oldUnpurchasedItemsMap.set(item.id, JSON.parse(JSON.stringify(item)));
                    }
                });
            });
            
            // Создаем копию всего списка для модификации, сохраняя купленные товары
            let newProcessedFullShoppingList = JSON.parse(JSON.stringify(previousShoppingListDataForUndo));

            // Очищаем некупленные товары из newProcessedFullShoppingList, чтобы заполнить их ответом Gemini
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
                        : (oldUnpurchasedItem ? oldUnpurchasedItem.quantity : 0), // Если новый товар и Gemini не дал кол-во, ставим 0
                        unit: itemDataFromGemini.unit || (oldUnpurchasedItem ? oldUnpurchasedItem.unit : "шт"),
                        emoji: itemDataFromGemini.emoji || (oldUnpurchasedItem ? oldUnpurchasedItem.emoji : "🛒"),
                        purchased: false, // Все товары из этого ответа считаются некупленными
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
                    
                    targetStore.items.push(newItem); // Добавляем в соответствующий магазин
                    if (oldUnpurchasedItem) {
                        oldUnpurchasedItemsMap.delete(itemDataFromGemini.id);
                    }
                }
            }

            // Добавляем обратно "забытые" Gemini НЕКУПЛЕННЫЕ товары
            oldUnpurchasedItemsMap.forEach(forgottenItem => {
                let originalStoreName = null;
                for (const store of previousShoppingListDataForUndo.stores) { // Ищем в оригинальном полном списке
                    if (store.items.some(i => i.id === forgottenItem.id)) {
                        originalStoreName = store.name;
                        break;
                    }
                }
                if (originalStoreName) {
                    let targetStore = newProcessedFullShoppingList.stores.find(s => s.name === originalStoreName);
                    if (!targetStore) { // Если Gemini забыл и магазин
                        targetStore = { name: originalStoreName, items: [] };
                        newProcessedFullShoppingList.stores.push(targetStore);
                    }
                    if (!targetStore.items.some(i => i.id === forgottenItem.id)) {
                         // Убедимся, что добавляем именно некупленный товар
                        if (!forgottenItem.purchased) targetStore.items.push(forgottenItem);
                    }
                }
            });
            
            const newShoppingListStateForCompare = { stores: newProcessedFullShoppingList.stores, activeStoreFilter: shoppingListData.activeStoreFilter };
            const newShoppingListString = JSON.stringify(newShoppingListStateForCompare);
            // Сравниваем с предыдущим состоянием всего списка
            const oldShoppingListString = JSON.stringify(previousShoppingListDataForUndo);


            // Обновляем глобальный shoppingListData
            shoppingListData.stores = newProcessedFullShoppingList.stores;
            // shoppingListData.activeStoreFilter остается прежним

            // renderEditScreenDOM(); // Рендеринг теперь будет через app.js после list-updated от сервера
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
// Экспортируем функцию, чтобы app.js мог ее найти
window.sendAudioToGeminiFromEditView = sendAudioToGeminiFromEditView;


// --- Инициализация и уничтожение View ---
export function initEditView(isReload = false) {
    console.log("Initializing Edit View", "Reload:", isReload);
    editScreen = document.getElementById('editScreen');
    addStoreButton = document.getElementById('addStoreButton');
    backButton = document.getElementById('backButton');
    // micButton, micIcon, stopIcon, micStatus - УДАЛЕНЫ ОТСЮДА
    editPageContainer = document.getElementById('editPageContainer'); // Убедитесь, что эта строка есть и корректна

    if (!editScreen || !addStoreButton || !backButton || !editPageContainer) { // Проверьте, что editPageContainer здесь есть
        console.error("Edit view critical elements not found in DOM! Aborting initEditView.");
        const appContainer = document.getElementById('app-container');
        if (appContainer) appContainer.innerHTML = "<p class='p-4 text-red-500'>Ошибка загрузки экрана редактирования.</p>";
        return;
    }
    
    renderEditScreenDOM();

    // Навешивание обработчиков событий
    backButton.removeEventListener('click', handleBackButtonClick); // Используем именованные
    backButton.addEventListener('click', handleBackButtonClick);

    addStoreButton.removeEventListener('click', handleAddStoreClick);
    addStoreButton.addEventListener('click', handleAddStoreClick);

    // micButton.removeEventListener('click', handleMicButtonClick); // Эта строка должна быть удалена
    // micButton.addEventListener('click', handleMicButtonClick);    // Эта строка должна быть удалена

        // D&D слушатели для editScreen (для перетаскивания магазинов)
        editScreen.removeEventListener('dragover', handleDragOverEditScreen); 
        editScreen.addEventListener('dragover', handleDragOverEditScreen);   
        editScreen.removeEventListener('dragleave', handleDragLeaveEditScreen); 
        editScreen.addEventListener('dragleave', handleDragLeaveEditScreen);  
        editScreen.removeEventListener('drop', handleDropOnEditScreen);       
        editScreen.addEventListener('drop', handleDropOnEditScreen);       
    
    if (editPageContainer) {
        removeSwipeListeners(editPageContainer);
        addSwipeListeners(editPageContainer, null, () => navigateTo('#main'));
    }
}

// Именованные обработчики для кнопок
function handleBackButtonClick() {
    navigateTo('#main');
}

function handleAddStoreClick() {
    let newStoreName = "Новый магазин";
    let counter = 1;
    while (shoppingListData.stores.find(s => s.name === newStoreName)) {
        newStoreName = `Новый магазин ${counter++}`;
    }
    const newStore = { name: newStoreName, items: [] };
    shoppingListData.stores.push(newStore);
    renderEditScreenDOM();
    saveData({
        actionType: 'ADD_STORE',
        payload: { storeName: newStoreName, addedStoreData: newStore }, // Сохраняем имя и сам магазин для отмены
        description: `Добавлен магазин: ${newStoreName}`
    });
}


export function destroyEditView() {
    console.log("Destroying Edit View");

    // Удаляем слушатели свайпов
    if (editPageContainer) {
        removeSwipeListeners(editPageContainer);
    }

    // Удаляем D&D слушатели с editScreen
    if (editScreen) {
        editScreen.removeEventListener('dragover', handleDragOverEditScreen);
        editScreen.removeEventListener('dragleave', handleDragLeaveEditScreen);
        editScreen.removeEventListener('drop', handleDropOnEditScreen);
    }
    // Удаляем слушатели с кнопок
    if (backButton) backButton.removeEventListener('click', handleBackButtonClick);
    if (addStoreButton) addStoreButton.removeEventListener('click', handleAddStoreClick);
    // if (micButton) micButton.removeEventListener('click', handleMicButtonClick); // ЭТО УЖЕ ДОЛЖНО БЫТЬ УДАЛЕНО

    // Сбрасываем ссылки на DOM-элементы
    editScreen = null;
    addStoreButton = null;
    backButton = null;
    // micButton = null;      // ЭТИ СТРОКИ УЖЕ ДОЛЖНЫ БЫТЬ УДАЛЕНЫ
    // micIcon = null;        // ЭТИ СТРОКИ УЖЕ ДОЛЖНЫ БЫТЬ УДАЛЕНЫ
    // stopIcon = null;       // ЭТИ СТРОКИ УЖЕ ДОЛЖНЫ БЫТЬ УДАЛЕНЫ
    // micStatus = null;      // ЭТИ СТРОКИ УЖЕ ДОЛЖНЫ БЫТЬ УДАЛЕНЫ
    editPageContainer = null;
}
