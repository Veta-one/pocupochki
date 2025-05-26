// public/js/mainViewLogic.js
import { shoppingListData, saveData, navigateTo, addSwipeListeners, removeSwipeListeners } from './app.js';

// --- Переменные на уровне модуля для хранения ссылок на DOM-элементы ---
let productListDiv,
    purchasedListDiv,
    purchasedSectionWrapper,
    purchasedListContainer,
    purchasedCountSpan,
    togglePurchasedListButton,
    purchasedChevron,
    storeFiltersContainer,
    editListButton,
    clearPurchasedButton,
    mainScreenContainer, // Главный контейнер для свайпов
    productNotesListDiv; // <--- ДОБАВЛЕНО
// --- Функции рендеринга UI ---

function createProductCard(product, storeName) {
    const card = document.createElement('div');
    const isPurchased = !!product.purchased;
    // Определяем, есть ли непустая заметка
    const hasNotes = product.notes && product.notes.trim() !== "";
    const quantityUnitClass = hasNotes ? "text-yellow-400" : "text-gray-400";
    const noteIndicator = hasNotes ? "• " : ""; // Добавляем индикатор, если есть заметка

    card.className = `product-card flex flex-col items-center gap-2 rounded-xl border border-[#42513e] bg-[#1f251d] p-3 aspect-square justify-center cursor-pointer hover:border-[#53d22c] transition-colors ${isPurchased ? 'strikethrough' : ''}`;
    card.dataset.productId = product.id;


    card.innerHTML = `
        <span class="emoji-icon text-4xl">${product.emoji}</span>
        <div class="text-center w-full">
            <h2 class="text-white text-sm font-semibold leading-tight">${product.name}</h2>
            <p class="text-xs ${quantityUnitClass}">${noteIndicator}${product.quantity > 0 || product.quantity < 0 ? product.quantity : ''} ${product.quantity > 0 || product.quantity < 0 || (product.unit && product.unit.trim() !== '') ? product.unit : ''}</p>
        </div>
    `;
    card.addEventListener('click', () => toggleProductPurchased(product.id));
    return card;
}

function renderStoreFilters() {
    if (!storeFiltersContainer) return;

    const storeNamesFromData = [...new Set(shoppingListData.stores.map(s => s.name))].sort();
    const uniqueStoreNames = ["Все", ...storeNamesFromData];

    storeFiltersContainer.innerHTML = ''; // Очищаем предыдущие фильтры

    uniqueStoreNames.forEach(name => {
        const button = document.createElement('button');
        button.className = `store-filter flex h-9 shrink-0 items-center justify-center gap-x-2 rounded-full bg-[#2d372a] px-4 text-sm font-medium text-white hover:bg-[#3a4a36] transition-colors ${shoppingListData.activeStoreFilter === name ? 'store-filter-active' : ''}`;
        button.textContent = name;
        button.dataset.storeName = name;
        button.addEventListener('click', () => {
            if (shoppingListData.activeStoreFilter !== name) {
                shoppingListData.activeStoreFilter = name;
                // Не нужно вызывать saveData() здесь, т.к. изменение фильтра - это UI состояние,
                // а не изменение данных списка. Если нужно сохранять фильтр между сессиями,
                // то shoppingListData должна иметь поле для этого, и saveData() тогда нужен.
                // Пока считаем, что activeStoreFilter - это временное состояние.
                // Если activeStoreFilter хранится в shoppingListData и должен персиститься:
                saveData({
                    actionType: 'FILTER_CHANGED', // Опционально для истории, если нужно отслеживать
                    payload: { newFilter: name },
                    description: `Фильтр изменен на: ${name}`
                }); // Раскомментировать, если фильтр - часть сохраняемых данных
            }
            renderApp(); // Перерисовываем с новым фильтром
        });
        storeFiltersContainer.appendChild(button);
    });
}

function renderProducts() {
    // Убедимся, что все DOM-элементы, нужные для рендера, существуют
    if (!productListDiv || !purchasedListDiv || !purchasedCountSpan || !purchasedSectionWrapper || !purchasedListContainer) {
        console.warn("renderProducts: Not all required DOM elements are available.");
        return;
    }

    productListDiv.innerHTML = '';
    purchasedListDiv.innerHTML = '';
    let totalPurchasedCountGlobal = 0; // Общее количество купленных по всем магазинам
    let itemsInActiveFilterToBuy = 0;
    let itemsInActiveFilterPurchased = 0;

    shoppingListData.stores.forEach(store => {
        store.items.forEach(product => {
            if (product.purchased) {
                totalPurchasedCountGlobal++;
            }
            // Логика отображения на основе активного фильтра
            if (shoppingListData.activeStoreFilter === "Все" || shoppingListData.activeStoreFilter === store.name) {
                const card = createProductCard(product, store.name);
                if (product.purchased) {
                    purchasedListDiv.appendChild(card);
                    itemsInActiveFilterPurchased++;
                } else {
                    productListDiv.appendChild(card);
                    itemsInActiveFilterToBuy++;
                }
            }
        });
    });

    purchasedCountSpan.textContent = totalPurchasedCountGlobal;

    // Видимость секции "Куплено" и ее списка
    // Секция видна, если есть купленные товары В ТЕКУЩЕМ ФИЛЬТРЕ
    // или если фильтр "Все" и есть хоть один купленный товар глобально.
    const shouldShowPurchasedSection = itemsInActiveFilterPurchased > 0 || (shoppingListData.activeStoreFilter === "Все" && totalPurchasedCountGlobal > 0);
    purchasedSectionWrapper.classList.toggle('hidden', !shouldShowPurchasedSection);

    if (shouldShowPurchasedSection) {
        renderPurchasedListCollapseState(); // Управляет стрелкой и видимостью purchasedListContainer
    } else {
        // Если секция "Куплено" не должна отображаться, скрываем ее контейнер и ставим стрелку вниз
        purchasedListContainer.classList.add('hidden');
        if (purchasedChevron) purchasedChevron.classList.remove('rotate-180');
    }

    // Сообщения, если списки пусты
    if (itemsInActiveFilterToBuy === 0 && productListDiv.innerHTML === '') {
        productListDiv.innerHTML = `<p class="col-span-3 text-center text-gray-500 mt-4">Нет товаров для покупки${shoppingListData.activeStoreFilter !== "Все" ? ` в магазине "${shoppingListData.activeStoreFilter}"` : ''}.</p>`;
    }
    if (itemsInActiveFilterPurchased === 0 && purchasedListDiv.innerHTML === '' && shouldShowPurchasedSection) {
        // Это сообщение показывается, только если сама секция "Куплено" видима, но в ней нет товаров для текущего фильтра
        purchasedListDiv.innerHTML = `<p class="col-span-3 text-center text-gray-500 mt-2">Нет купленных товаров${shoppingListData.activeStoreFilter !== "Все" ? ` в магазине "${shoppingListData.activeStoreFilter}"` : ''}.</p>`;
    }
}

function renderPurchasedListCollapseState() {
    if (!purchasedListContainer || !purchasedChevron) return;

    // Если контейнер скрыт (список свернут), стрелка должна указывать вниз (без rotate-180)
    // Если контейнер видим (список развернут), стрелка должна указывать вверх (с rotate-180)
    if (purchasedListContainer.classList.contains('hidden')) {
        purchasedChevron.classList.remove('rotate-180');
    } else {
        purchasedChevron.classList.add('rotate-180');
    }
}

function renderProductNotesList() {
    if (!productNotesListDiv) return;

    productNotesListDiv.innerHTML = ''; // Очищаем предыдущий список
    let notesFound = false;

    shoppingListData.stores.forEach(store => {
        // Отображаем заметки только для товаров, которые не куплены и соответствуют фильтру
        if (shoppingListData.activeStoreFilter === "Все" || shoppingListData.activeStoreFilter === store.name) {
            store.items.forEach(product => {
                if (product.notes && !product.purchased) {
                    notesFound = true;
                    const noteItem = document.createElement('div');
                    noteItem.className = 'flex items-start text-sm text-gray-300 py-1';
                    // Используем text-base для эмодзи, чтобы он был чуть крупнее текста заметки
                    const quantityDisplay = product.quantity > 0 || product.quantity < 0 ? `${product.quantity} ${product.unit}` : (product.unit && product.unit.trim() !== '' ? product.unit : 'детали в заметке');
                    noteItem.innerHTML = `
                        <span class="emoji-char-note mr-2 text-base">${product.emoji}</span>
                        <span class="note-text">${product.name} (${quantityDisplay}): ${product.notes}</span>
                    `;
                    productNotesListDiv.appendChild(noteItem);
                }
            });
        }
    });

    // Скрываем весь блок заметок, если нет активных заметок для текущего фильтра
    const notesSectionWrapper = document.getElementById('productNotesSectionWrapper');
    if (notesSectionWrapper) {
        notesSectionWrapper.classList.toggle('hidden', !notesFound);
    }
}

// Главная функция рендеринга для этого view
function renderApp() {
    console.log("mainViewLogic: renderApp called");
    renderStoreFilters();
    renderProducts();
    renderProductNotesList(); // <--- ДОБАВЛЕНО
    // saveData() здесь обычно не нужен, он вызывается после конкретных действий пользователя, изменяющих данные
}

// --- Логика обработки данных ---

function findProductById(productId) {
    for (const store of shoppingListData.stores) {
        const product = store.items.find(item => item.id === productId);
        if (product) return { product, storeName: store.name };
    }
    return null;
}

function toggleProductPurchased(productId) {
    const result = findProductById(productId);
    if (result && result.product) {
        const previousPurchasedState = result.product.purchased;
        result.product.purchased = !result.product.purchased; // <--- СТАТУС В shoppingListData МЕНЯЕТСЯ

        renderApp(); // Перерисовываем UI немедленно
        saveData({
            actionType: 'TOGGLE_PURCHASED',
            payload: {
                itemId: productId,
                storeName: result.storeName,
                wasPurchased: previousPurchasedState, // Предыдущее состояние
                // isPurchased: result.product.purchased // Новое состояние (сервер может его не использовать, но полезно для логов)
            },
            description: `Товар '${result.product.name}' отмечен как ${result.product.purchased ? 'купленный' : 'не купленный'}`
        });
    } else {
        console.warn(`Product with ID ${productId} not found for toggle.`);
    }
}

// --- Инициализация и уничтожение View ---

export function initMainView(isReload = false) {
    console.log("Initializing Main View", "Reload:", isReload);

    // 1. Получаем ссылки на DOM-элементы
    productListDiv = document.getElementById('productList');
    purchasedListDiv = document.getElementById('purchasedList');
    purchasedSectionWrapper = document.getElementById('purchasedSectionWrapper');
    purchasedListContainer = document.getElementById('purchasedListContainer');
    purchasedCountSpan = document.getElementById('purchasedCount');
    togglePurchasedListButton = document.getElementById('togglePurchasedList');
    purchasedChevron = document.getElementById('purchasedChevron');
    storeFiltersContainer = document.getElementById('storeFiltersContainer');
    editListButton = document.getElementById('editListButton');
    clearPurchasedButton = document.getElementById('clearPurchasedButton');
    mainScreenContainer = document.getElementById('mainScreenContainer');
    productNotesListDiv = document.getElementById('productNotesList');

    // 2. Проверка наличия критически важных элементов
    if (!productListDiv || !mainScreenContainer || !storeFiltersContainer /* || !productNotesListDiv */ ) { // productNotesListDiv пока опционален для критичности
        console.error("Main view critical elements not found in DOM! Aborting initMainView.");
        // Можно показать сообщение пользователю или обработать ошибку иначе
        const appContainer = document.getElementById('app-container');
        if (appContainer) appContainer.innerHTML = "<p class='p-4 text-red-500'>Ошибка загрузки основного экрана. Пожалуйста, обновите страницу.</p>";
        return;
    }

    // 3. Установка начального состояния (например, свернутого списка купленных)
    // Этот блок выполняется только при первой загрузке view, не при обновлении данных (isReload = true)
    if (!isReload && purchasedListContainer) { // Убедимся, что purchasedListContainer найден
        const anyPurchasedInActiveFilter = shoppingListData.stores.some(store =>
            (shoppingListData.activeStoreFilter === "Все" || shoppingListData.activeStoreFilter === store.name) &&
            store.items.some(item => item.purchased)
        );

        if (anyPurchasedInActiveFilter) {
            purchasedListContainer.classList.add('hidden'); // Начинаем со свернутым, если есть что сворачивать
        } else {
            purchasedListContainer.classList.remove('hidden');
        }
        // Состояние стрелки обновится в renderApp -> renderProducts -> renderPurchasedListCollapseState
    }

    // 4. Первичный рендеринг UI
    renderApp();

    // 5. Навешивание обработчиков событий
    // (Удаляем старые перед добавлением новых, если initMainView может вызываться многократно без destroy)
    // Но т.к. у нас есть destroyMainView, который должен вызываться перед повторным init,
    // здесь достаточно просто добавить слушатели.

    if (editListButton) {
        editListButton.removeEventListener('click', goToEditView); // Предотвращаем дублирование
        editListButton.addEventListener('click', goToEditView);
    } else console.warn("editListButton not found in DOM for Main View.");

    if (togglePurchasedListButton) {
        togglePurchasedListButton.removeEventListener('click', handleTogglePurchased);
        togglePurchasedListButton.addEventListener('click', handleTogglePurchased);
    } else console.warn("togglePurchasedListButton not found in DOM for Main View.");

    if (clearPurchasedButton) {
        clearPurchasedButton.removeEventListener('click', handleClearPurchased);
        clearPurchasedButton.addEventListener('click', handleClearPurchased);
    } else console.warn("clearPurchasedButton not found in DOM for Main View.");

    // Свайп-навигация
    if (mainScreenContainer) {
        addSwipeListeners(mainScreenContainer, () => navigateTo('#edit'), null); // Swipe Left -> Edit
    }
}

// Функции-обработчики для слушателей (чтобы их можно было удалить)
function goToEditView() {
    navigateTo('#edit');
}

function handleTogglePurchased() {
    if (purchasedListContainer) purchasedListContainer.classList.toggle('hidden');
    renderPurchasedListCollapseState(); // Обновляем только стрелку и состояние
}

function handleClearPurchased() {
    const purchasedItemsInFilter = [];
    shoppingListData.stores.forEach(store => {
        if (shoppingListData.activeStoreFilter === "Все" || shoppingListData.activeStoreFilter === store.name) {
            store.items.forEach(item => {
                if (item.purchased) {
                    purchasedItemsInFilter.push({ storeName: store.name, itemId: item.id, itemName: item.name });
                }
            });
        }
    });

    if (purchasedItemsInFilter.length === 0) {
        console.log("No purchased items to clear for the current filter.");
        return;
    }

    // Запрос подтверждения
    if (confirm(`Вы уверены, что хотите удалить ${purchasedItemsInFilter.length} купленны${purchasedItemsInFilter.length === 1 ? "й товар" : (purchasedItemsInFilter.length < 5 ? "х товара" : "х товаров")} из списка навсегда? Это действие нельзя будет отменить.`)) {
        const previousShoppingListDataForUndo = JSON.parse(JSON.stringify(shoppingListData));
        let itemsWereActuallyDeleted = false;

        shoppingListData.stores.forEach(store => {
            const originalLength = store.items.length;
            store.items = store.items.filter(item => { // <--- ФИЗИЧЕСКОЕ УДАЛЕНИЕ
                const shouldBeDeleted = item.purchased &&
                                     (shoppingListData.activeStoreFilter === "Все" || shoppingListData.activeStoreFilter === store.name);
                if (shouldBeDeleted) {
                    itemsWereActuallyDeleted = true;
                }
                return !shouldBeDeleted;
            });
        });

        if (itemsWereActuallyDeleted) {
            renderApp();
            saveData({ // <--- ОТПРАВКА ИЗМЕНЕННОГО СПИСКА НА СЕРВЕР
                actionType: 'PERMANENTLY_DELETE_PURCHASED', 
                payload: {
                    filterApplied: shoppingListData.activeStoreFilter,
                    previousShoppingListData: previousShoppingListDataForUndo,
                },
                description: `Удалены купленные товары (фильтр: ${shoppingListData.activeStoreFilter})`
            });
        } else {
            console.log("No items were actually deleted, though some were marked as purchased.");
        }
    } else {
        console.log("User cancelled clearing purchased items.");
    }
}


export function destroyMainView() {
    console.log("Destroying Main View");

    // Удаляем слушатели событий с элементов, которые не удаляются вместе с partial
    // (если бы такие были, например, на document или window)

    // Удаляем слушатели свайпов
    if (mainScreenContainer) {
        removeSwipeListeners(mainScreenContainer);
    }

    // Удаляем слушатели с кнопок, чтобы избежать утечек памяти и двойных срабатываний
    // если DOM не полностью пересоздается при каждой навигации (хотя с innerHTML он должен)
    if (editListButton) editListButton.removeEventListener('click', goToEditView);
    if (togglePurchasedListButton) togglePurchasedListButton.removeEventListener('click', handleTogglePurchased);
    if (clearPurchasedButton) clearPurchasedButton.removeEventListener('click', handleClearPurchased);


    // Сбрасываем ссылки на DOM-элементы, чтобы помочь сборщику мусора
    // и чтобы при следующей инициализации не было путаницы со старыми ссылками
    productListDiv = null;
    purchasedListDiv = null;
    purchasedSectionWrapper = null;
    purchasedListContainer = null;
    purchasedCountSpan = null;
    togglePurchasedListButton = null;
    purchasedChevron = null;
    storeFiltersContainer = null;
    editListButton = null;
    clearPurchasedButton = null;
    mainScreenContainer = null;
    productNotesListDiv = null;
}