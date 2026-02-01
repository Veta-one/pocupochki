# Pocupochki Dockerfile
FROM node:20-alpine

# Создаём рабочую директорию
WORKDIR /app

# Копируем package files
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production

# Копируем исходный код
COPY . .

# Удаляем старые файлы которые больше не нужны
RUN rm -rf server/utils/fileUtils.js server/data ecosystem.config.js server/*.pem 2>/dev/null || true

# Порт приложения
EXPOSE 3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Запуск
CMD ["node", "server/server.js"]
