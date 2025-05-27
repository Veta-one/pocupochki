// js/app.js
import { initMainView, destroyMainView } from './mainViewLogic.js';
import { initEditView, destroyEditView } from './editViewLogic.js';

// --- Глобальное состояние приложения ---
export let shoppingListData = { stores: [], activeStoreFilter: "Все" };
export let actionHistory = [];
let currentPage = null;
let socket;

const appContainer = document.getElementById('app-container');
// Новые переменные для элементов меню
let navBottomNavigation, navMicButton, navMicIcon, navStopIcon, navUndoButton, navToggleButton, navMicStatus;
let currentUndoButton; // Будет ссылаться либо на navUndoButton, либо на старый, если он еще есть

// --- WebSocket Управление ---
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`; // Сервер на том же хосте

    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log('WebSocket connection established.');
        // Сервер должен прислать 'initial-data' при подключении
    };

    socket.onmessage = (event) => {
        try {
            const message = JSON.parse(event.data);
            console.log('WebSocket message received:', message.type, JSON.stringify(message.payload).substring(0,100) + "...", 'Current page:', currentPage);

            if (message.type === 'initial-data') {
                const oldListString = JSON.stringify(shoppingListData);
                const newListData = message.payload;
            
                if (oldListString !== JSON.stringify(newListData)) { // Для initial-data проверка нужна
                    console.log('Initial data received and is different, updating shoppingListData and rerendering.');
                    shoppingListData = newListData; 
            
                    if (currentPage === 'main' && typeof initMainView === 'function') {
                        console.log('Rerendering mainView for initial-data');
                        if (typeof destroyMainView === 'function') destroyMainView(); 
                        initMainView(true);
                    } else if (currentPage === 'edit' && typeof initEditView === 'function') {
                        console.log('Rerendering editView for initial-data');
                        if (typeof destroyEditView === 'function') destroyEditView(); 
                        initEditView(true);
                    }
                } else {
                    console.log('Initial data received is identical to current shoppingListData. No rerender.');
                }
            } else if (message.type === 'list-updated') {
                const newListData = message.payload;
                console.log('List-updated received. Forcing shoppingListData update and rerender.');
                
                // Здесь мы принудительно обновляем shoppingListData и перерисовываем,
                // так как даже если данные на клиенте-отправителе уже "актуальны" после локальной обработки,
                // это сообщение от сервера является подтверждением и источником правды.
                // Для других клиентов это будет обычное обновление.
                shoppingListData = newListData; 
            
                if (currentPage === 'main' && typeof initMainView === 'function') {
                    console.log('Rerendering mainView for list-updated');
                    if (typeof destroyMainView === 'function') destroyMainView(); 
                    initMainView(true);
                } else if (currentPage === 'edit' && typeof initEditView === 'function') {
                    console.log('Rerendering editView for list-updated');
                    if (typeof destroyEditView === 'function') destroyEditView(); 
                    initEditView(true);
                }
                 // После обновления списка, запросим обновленную историю
                 // Это гарантирует, что счетчик Undo кнопки будет актуален
                requestHistoryUpdate();

            } else if (message.type === 'history-updated') {
                console.log('History-updated received.');
                actionHistory = message.payload;
                updateUndoButtonState();
            } else if (message.type === 'get-history') { // Если сервер присылает это в ответ на запрос клиента
                console.log('Get-history response received (same as history-updated).');
                actionHistory = message.payload;
                updateUndoButtonState();
            } else if (message.type === 'error') {
                console.error('Server error via WebSocket:', message.payload);
                alert(`Ошибка сервера: ${message.payload.message || 'Неизвестная ошибка'}`);
            }

        } catch (error) {
            console.error('Error processing WebSocket message:', error, "Data:", event.data);
        }
    };

    socket.onclose = (event) => {
        console.log(`WebSocket connection closed (code: ${event.code}, reason: ${event.reason}). Attempting to reconnect...`);
        setTimeout(connectWebSocket, 5000); // Попытка переподключения через 5 секунд
    };

    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
        // onclose будет вызван после ошибки, инициируя переподключение
    };
}

export function updateGlobalMicStatus(message, исчезновениеЧерезMs = 0) {
    if (navMicStatus) {
        navMicStatus.textContent = message;
        if (исчезновениеЧерезMs > 0) {
            setTimeout(() => {
                if (navMicStatus && navMicStatus.textContent === message) { // Очищаем, только если сообщение не изменилось
                    navMicStatus.textContent = "";
                }
            }, исчезновениеЧерезMs);
        }
    }
}

function requestHistoryUpdate() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'get-history' }));
    }
}

// --- Управление данными и историей ---
export function generateId() {
    return 'item_' + Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

export function loadInitialData() {
    // Начальные данные списка придут по WebSocket (сообщение 'initial-data')
    // Загружаем историю через HTTP GET для кнопки "Отменить"
    fetch('/api/history')
        .then(response => {
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return response.json();
        })
        .then(data => {
            actionHistory = data;
            updateUndoButtonState();
        })
        .catch(error => {
            console.error('Failed to load initial history data via HTTP:', error);
            actionHistory = []; // Сброс в случае ошибки
            updateUndoButtonState();
        });
}

export function saveData(actionDetailsForHistory = null) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        // 1. Отправляем обновленный список на сервер
        socket.send(JSON.stringify({ type: 'update-list', payload: shoppingListData }));

        // 2. Если есть детали для истории, отправляем их тоже
        if (actionDetailsForHistory) {
            if (!actionDetailsForHistory.timestamp) {
                actionDetailsForHistory.timestamp = Date.now(); // Временная метка клиента
            }
            // Добавляем уникальный ID для записи истории, если его нет
            if (!actionDetailsForHistory.id) {
                actionDetailsForHistory.id = `hist_${generateId()}`;
            }

            socket.send(JSON.stringify({ type: 'add-history', payload: actionDetailsForHistory }));

            // Оптимистичное обновление локальной истории для UI
            actionHistory.unshift(actionDetailsForHistory);
            updateUndoButtonState();
        }
    } else {
        console.error('WebSocket not connected. Cannot save data.');
        alert('Нет соединения с сервером. Изменения не сохранены.');
        // TODO: Можно реализовать fallback в localStorage и попытку синхронизации позже.
    }
}

// --- Управление UI для "Отменить" ---
function updateUndoButtonState() {
    // currentUndoButton будет инициализирован в initAppUI
    if (currentUndoButton) {
        currentUndoButton.disabled = actionHistory.length === 0;
        currentUndoButton.textContent = `Отменить (${actionHistory.length})`;
    }
}

function handleUndoClick() {
    if (actionHistory.length > 0 && socket && socket.readyState === WebSocket.OPEN) {
        const actionToUndo = actionHistory[0];
        socket.send(JSON.stringify({ type: 'undo-last-action', payload: { actionId: actionToUndo.id } }));
    } else if (actionHistory.length === 0) {
        console.log("No actions in history to undo.");
    } else {
        console.error("Cannot undo: WebSocket not connected or no history.");
    }
}

// --- Управление кнопкой микрофона (общее для нового меню) ---// --- Управление кнопкой микрофона (общее для нового меню) ---
let mediaRecorderFromApp; // Используем одну переменную для mediaRecorder
let audioChunksFromApp = [];
let geminiModelFromApp;
let geminiSDKLoaded = false; // Флаг загрузки SDK
let geminiSDKPromise = null; // Промис для ожидания загрузки

// Функция для загрузки SDK, если еще не загружен
function loadGeminiSDKIfNotLoaded() {
    if (geminiSDKLoaded) return Promise.resolve(); // Уже загружен
    if (geminiSDKPromise) return geminiSDKPromise; // Уже загружается

    geminiSDKPromise = new Promise(async (resolve, reject) => {
        if (typeof window.GoogleGenerativeAI === 'undefined') {
            console.log("Attempting to load GoogleGenerativeAI SDK...");
            try {
                const genAIModule = await import('https://esm.run/@google/generative-ai');
                window.GoogleGenerativeAI = genAIModule.GoogleGenerativeAI;
                geminiSDKLoaded = true;
                console.log("GoogleGenerativeAI SDK loaded successfully.");
                resolve();
            } catch (e) {
                console.error("Failed to load GoogleGenerativeAI module:", e);
                reject(e);
            }
        } else {
            geminiSDKLoaded = true; // Уже был загружен (например, другим скриптом)
            console.log("GoogleGenerativeAI SDK was already available.");
            resolve();
        }
    });
    return geminiSDKPromise;
}


async function initializeGlobalGemini() {
    try {
        await loadGeminiSDKIfNotLoaded(); // Дожидаемся загрузки SDK
    } catch (e) {
        console.error("Failed to ensure Gemini SDK is loaded before initializing model:", e);
        if(navMicButton) navMicButton.disabled = true;
        return null;
    }
    
    // Теперь window.GoogleGenerativeAI должен быть доступен
    if (typeof window.GoogleGenerativeAI === 'undefined') {
        console.error("Critical: GoogleGenerativeAI is still undefined after load attempt.");
        if(navMicButton) navMicButton.disabled = true;
        return null;
    }

    const API_KEY = "YOUR_GEMINI_API_KEY"; // Получите ключ на https://makersuite.google.com/app/apikey
    if (!API_KEY || API_KEY === "YOUR_GEMINI_API_KEY") {
        console.error("API ключ Gemini не установлен.");
        if(navMicButton) navMicButton.disabled = true;
        return null;
    }
    try {
        const genAI = new window.GoogleGenerativeAI(API_KEY);
        if(navMicButton) navMicButton.disabled = false;
        return genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
    } catch (error) {
        console.error("Error initializing Global Gemini model:", error);
        if(navMicButton) navMicButton.disabled = true;
        return null;
    }
}


async function handleGlobalMicButtonClick() {
    if (!navMicButton || navMicButton.disabled) return;

    if (!geminiModelFromApp) {
        updateGlobalMicStatus("Инициализация Gemini..."); // <--- СТАТУС
        console.log("Initializing Global Gemini for nav mic button...");
        geminiModelFromApp = await initializeGlobalGemini();
        if (!geminiModelFromApp) {
            console.error("Global Gemini initialization failed for nav mic button.");
            updateGlobalMicStatus("Ошибка инициализации!", 3000); // <--- СТАТУС
            alert("Ошибка инициализации голосового ввода.");
            return;
        }
        updateGlobalMicStatus(""); // <--- Очистка статуса
        console.log("Global Gemini initialized for nav mic button.");
    }

    if (mediaRecorderFromApp && mediaRecorderFromApp.state === "recording") {
        mediaRecorderFromApp.stop();
        updateGlobalMicStatus("Обработка аудио...", 0); // <--- СТАТУС (0 - не исчезать само)
        navMicButton.classList.remove('recording', 'bg-red-500');
        navMicButton.classList.add('bg-[#53d22c]');
        if(navMicIcon) navMicIcon.classList.remove('hidden');
        if(navStopIcon) navStopIcon.classList.add('hidden');
    } else {
        try {
            updateGlobalMicStatus("Запрос микрофона..."); // <--- СТАТУС
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
                if(navMicIcon) navMicIcon.classList.remove('hidden');
                if(navStopIcon) navStopIcon.classList.add('hidden');
                // Можно добавить: console.log("Processing audio...");

                updateGlobalMicStatus("Обработка аудио...");

                if (audioChunksFromApp.length === 0) { /* ... */ updateGlobalMicStatus("Нет аудио.", 2000); return; }
                const audioBlob = new Blob(audioChunksFromApp, { type: mediaRecorderFromApp.mimeType || 'audio/webm' });
                if (audioBlob.size === 0) { /* ... */ updateGlobalMicStatus("Пустой аудиофайл.", 2000); return; }

                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = async () => {
                    const base64Audio = reader.result.split(',')[1];
                    const audioMimeType = audioBlob.type || 'audio/webm';
                    const fullCurrentListForProcessing = JSON.parse(JSON.stringify(shoppingListData));

                    if (window.sendAudioToGeminiFromEditView) {
                        updateGlobalMicStatus("Отправка в Gemini..."); // <--- СТАТУС
                        console.log(`Processing voice command. Current page: ${currentPage}.`);
                        window.sendAudioToGeminiFromEditView(base64Audio, audioMimeType, geminiModelFromApp, fullCurrentListForProcessing);
                    } else {
                        console.error("sendAudioToGeminiFromEditView is not available. Voice command cannot be processed.");
                        alert("Ошибка: функция обработки голосовой команды не найдена.");
                    }
                };
                reader.onerror = () => console.error("FileReader error for audio blob.");
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorderFromApp.onerror = (event) => {
                console.error("MediaRecorder error:", event.error);
                navMicButton.classList.remove('recording', 'bg-red-500');
                navMicButton.classList.add('bg-[#53d22c]');
                if(navMicIcon) navMicIcon.classList.remove('hidden');
                if(navStopIcon) navStopIcon.classList.add('hidden');
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorderFromApp.start();
            updateGlobalMicStatus("Говорите...");
            navMicButton.classList.add('recording', 'bg-red-500');
            navMicButton.classList.remove('bg-[#53d22c]');
            if(navMicIcon) navMicIcon.classList.add('hidden');
            if(navStopIcon) navStopIcon.classList.remove('hidden');
            // Можно добавить: console.log("Recording started...");

        } catch (err) {
            console.error("Error accessing microphone:", err);
            alert("Ошибка доступа к микрофону: " + err.message);
            navMicButton.classList.remove('recording', 'bg-red-500');
            navMicButton.classList.add('bg-[#53d22c]');
            if(navMicIcon) navMicIcon.classList.remove('hidden');
            if(navStopIcon) navStopIcon.classList.add('hidden');
            updateGlobalMicStatus("Ошибка микрофона!", 3000);
        }
    }
}

// --- SPA Роутинг и управление View ---
async function loadViewHTML(viewName) {
    try {
        const response = await fetch(`partials/${viewName}.html`);
        if (!response.ok) throw new Error(`Failed to load ${viewName}.html: ${response.statusText}`);
        return await response.text();
    } catch (error) {
        console.error("Error loading view HTML:", error);
        appContainer.innerHTML = `<p class="text-red-500 p-4">Ошибка загрузки контента: ${error.message}</p>`;
        return null;
    }
}

export async function navigateTo(path) {
    const previousPageType = currentPage; // Запоминаем предыдущую страницу

    // 1. Очистка предыдущего View (если нужно, зависит от стратегии)
    // Если вы полностью заменяете innerHTML, то destroy не так критичен для DOM, но для слушателей - да.
    if (previousPageType === 'main' && typeof destroyMainView === 'function') destroyMainView();
    if (previousPageType === 'edit' && typeof destroyEditView === 'function') destroyEditView();

    let newViewHTML = '';
    let newPageType = '';
    let initFunction = null;

    // Сначала убираем классы анимаций, если они были
    document.body.classList.remove('transition-to-main', 'transition-to-edit');

    if (path === '/' || path === 'index.html' || path === '#main') {
        newPageType = 'main';
        if (previousPageType === 'edit') { // Только если переходим с другой страницы
            document.body.classList.add('transition-to-main');
        }
        document.body.classList.remove('edit-view-active');
        document.body.classList.add('main-view-active');
        newViewHTML = await loadViewHTML('mainView');
        initFunction = initMainView;
        if(navToggleButton) navToggleButton.textContent = 'Редактировать';
    } else if (path === '#edit') {
        newPageType = 'edit';
        if (previousPageType === 'main') { // Только если переходим с другой страницы
            document.body.classList.add('transition-to-edit');
        }
        document.body.classList.remove('main-view-active');
        document.body.classList.add('edit-view-active');
        newViewHTML = await loadViewHTML('editView');
        initFunction = initEditView;
        if(navToggleButton) navToggleButton.textContent = 'Список';
    } else {
        console.warn("Unknown path, redirecting to main:", path);
        history.replaceState({ path: 'main' }, '', '#main');
        
        newPageType = 'main';
        // При редиректе на главную, если это не было явным переходом с edit, не добавляем анимацию
        if (previousPageType === 'edit') {
             document.body.classList.add('transition-to-main');
        }
        document.body.classList.remove('edit-view-active');
        document.body.classList.add('main-view-active');
        newViewHTML = await loadViewHTML('mainView');
        initFunction = initMainView;
        if(navToggleButton) navToggleButton.textContent = 'Редактировать';
    }

    if (!newViewHTML) return;

    appContainer.innerHTML = newViewHTML;

    if (window.location.hash !== path && (path === '#edit' || path === '#main')) {
        // Используем replaceState, если мы просто исправляем URL на дефолтный, чтобы не засорять историю
        if ((path === '#main' && (window.location.hash === '' || window.location.hash === '#')) ||
            (path === '#edit' && window.location.hash === '')) {
             history.replaceState({ path: newPageType }, '', path);
        } else {
            history.pushState({ path: newPageType }, '', path); // Упростим для примера
        }
    }
    currentPage = newPageType;

    requestAnimationFrame(() => {
        if (typeof initFunction === 'function') {
            initFunction();
        }
        updateUndoButtonState();
        // Убираем классы анимации после ее завершения (примерно через время transition)
        // Можно использовать событие 'transitionend', но setTimeout проще для начала
        setTimeout(() => {
            document.body.classList.remove('transition-to-main', 'transition-to-edit');
        }, 400); // 400ms - время вашей анимации
    });
}

window.onpopstate = (event) => {
    if (event.state && event.state.path) {
        navigateTo(event.state.path === 'main' ? '#main' : '#edit');
    } else {
        // Если нет state, пробуем взять из hash или дефолт
        navigateTo(window.location.hash || '#main');
    }
};

// --- Инициализация приложения ---
function initAppUI() {
    navBottomNavigation = document.getElementById('bottom-navigation');
    navMicButton = document.getElementById('navMicButton');
    navMicIcon = document.getElementById('navMicIcon');
    navStopIcon = document.getElementById('navStopIcon');
    navUndoButton = document.getElementById('navUndoButton');
    navToggleButton = document.getElementById('navToggleButton');
    navMicStatus = document.getElementById('navMicStatus'); // <--- Получаем элемент

    currentUndoButton = navUndoButton; // Теперь используем кнопку из нового меню

    if (navUndoButton) {
        navUndoButton.addEventListener('click', handleUndoClick);
    }
    if (navToggleButton) {
        navToggleButton.addEventListener('click', () => {
            if (currentPage === 'main') {
                navigateTo('#edit');
            } else {
                navigateTo('#main');
            }
        });
    }
    if (navMicButton) {
        navMicButton.addEventListener('click', handleGlobalMicButtonClick);
    }

    // Свайпы по самому меню для навигации
    if (navBottomNavigation) {
        addSwipeListeners(navBottomNavigation,
            () => { if (currentPage === 'main') navigateTo('#edit'); }, // Swipe Left
            () => { if (currentPage === 'edit') navigateTo('#main'); }  // Swipe Right
        );
    }
    updateUndoButtonState();
}

document.addEventListener('DOMContentLoaded', async () => { // Делаем обработчик async
    initAppUI();
    connectWebSocket();
    loadInitialData();

    try {
        // Инициализация Gemini после того, как SDK точно загружен
        geminiModelFromApp = await initializeGlobalGemini(); // Дожидаемся инициализации модели
        if (!geminiModelFromApp && navMicButton) {
             console.warn("Global Gemini model could not be initialized on app load.");
        } else if (geminiModelFromApp) {
            console.log("Global Gemini model initialized successfully on app load.");
        }
    } catch (error) {
        console.error("Error during initial Gemini model initialization:", error);
    }

    const initialPath = window.location.hash || '#main';
    if (!['#main', '#edit'].includes(initialPath)) {
        navigateTo('#main');
    } else {
        navigateTo(initialPath);
    }
});


// --- SWIPE GESTURES (вспомогательная функция) ---
export function addSwipeListeners(element, onSwipeLeft, onSwipeRight) {
    let touchstartX = 0;
    let touchendX = 0;
    const swipeThreshold = 70; // Минимальное смещение для свайпа

    // Хранилище для обработчиков, чтобы их можно было удалить
    if (!element._swipeHandlers) {
        element._swipeHandlers = {};
    }
    
    // Удаляем предыдущие обработчики, если они были
    if (element._swipeHandlers.touchstart) element.removeEventListener('touchstart', element._swipeHandlers.touchstart);
    if (element._swipeHandlers.touchend) element.removeEventListener('touchend', element._swipeHandlers.touchend);


    element._swipeHandlers.touchstart = e => {
        const targetTagName = e.target.tagName.toLowerCase();
        const closestButton = e.target.closest('button');
        const closestDraggable = e.target.closest('[draggable="true"]');
        const closestScrollable = e.target.closest('.custom-scrollbar');


        if (targetTagName === 'input' || 
            targetTagName === 'textarea' || 
            closestButton || 
            (closestDraggable && e.target.closest('.drag-handle')) || // Если это ручка для D&D
            closestScrollable) {
            touchstartX = 0; // Отключаем свайп для интерактивных элементов или скролла
            return;
        }
        touchstartX = e.changedTouches[0].screenX;
    };

    element._swipeHandlers.touchend = e => {
        if (touchstartX === 0) return; // Свайп был отменен или не начат
        touchendX = e.changedTouches[0].screenX;

        if (touchendX < touchstartX - swipeThreshold && typeof onSwipeLeft === 'function') {
            onSwipeLeft();
        } else if (touchendX > touchstartX + swipeThreshold && typeof onSwipeRight === 'function') {
            onSwipeRight();
        }
        touchstartX = 0; // Сброс для следующего касания
    };
    
    element.addEventListener('touchstart', element._swipeHandlers.touchstart, { passive: true });
    element.addEventListener('touchend', element._swipeHandlers.touchend, { passive: true });
}

export function removeSwipeListeners(element) {
    if (element && element._swipeHandlers) {
        if (element._swipeHandlers.touchstart) {
            element.removeEventListener('touchstart', element._swipeHandlers.touchstart);
        }
        if (element._swipeHandlers.touchend) {
            element.removeEventListener('touchend', element._swipeHandlers.touchend);
        }
        delete element._swipeHandlers;
    }
}
