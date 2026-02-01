require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const path = require('path');

const { connectDatabase } = require('./config/database');
const { initWebSocket } = require('./services/websocket');
const { initBot, processUpdate } = require('./services/telegramBot');

// Routes
const authRoutes = require('./routes/auth');
const listsRoutes = require('./routes/lists');
const voiceRoutes = require('./routes/voice');
const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: process.env.NODE_ENV === 'development'
    ? '*'
    : [process.env.WEBAPP_URL, 'https://web.telegram.org', 'https://telegram.org'],
  credentials: true
}));

app.use(express.json({ limit: '10mb' })); // Увеличен лимит для аудио
app.use(express.urlencoded({ extended: true }));

// Статические файлы
app.use(express.static(path.join(__dirname, '..', 'public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/lists', listsRoutes);
app.use('/api/voice', voiceRoutes);
app.use('/api/admin', adminRoutes);

// Telegram Webhook
app.post('/api/telegram/webhook', (req, res) => {
  try {
    processUpdate(req.body);
    res.sendStatus(200);
  } catch (error) {
    console.error('Telegram webhook error:', error);
    res.sendStatus(500);
  }
});

// SPA fallback - все остальные запросы отдают index.html
app.get('*', (req, res) => {
  // Не отдаём index.html для API запросов
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Запуск сервера
async function start() {
  try {
    // Подключаемся к MongoDB
    await connectDatabase();

    // Инициализируем WebSocket
    initWebSocket(server);
    console.log('WebSocket server initialized');

    // Инициализируем Telegram бота
    const webhookUrl = process.env.NODE_ENV === 'production'
      ? `${process.env.WEBAPP_URL}/api/telegram/webhook`
      : null;

    initBot(webhookUrl);
    console.log('Telegram bot initialized');

    // Запускаем HTTP сервер
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

      if (process.env.NODE_ENV !== 'production') {
        console.log(`Open http://localhost:${PORT} in your browser`);
      }
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

start();
