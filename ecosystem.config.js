// ecosystem.config.js (находится в /home/Pocupochki/ecosystem.config.js)
module.exports = {
    apps : [{
      name   : "shopping-list-app",    // Имя приложения
      script : "./server/server.js",     // Путь к server.js ОТНОСИТЕЛЬНО ЭТОГО ФАЙЛА
                                         // т.е. /home/Pocupochki/server/server.js
     // cwd    : "./server/",              // Рабочая директория для server.js
                                         // Заставит server.js выполняться из /home/Pocupochki/server/
      watch  : false,
      ignore_watch : ["node_modules", "server/data"],
      env: {
        "NODE_ENV": "development",
        "PORT": 5050                 // Убедитесь, что этот порт используется и в server.js
      },
      env_production: {
         "NODE_ENV": "production",
      },
      output : './logs/pm2-out.log',    // Будет /home/Pocupochki/logs/pm2-out.log
      error  : './logs/pm2-error.log',  // Будет /home/Pocupochki/logs/pm2-error.log
      log_date_format : "YYYY-MM-DD HH:mm Z",
    }]
  }