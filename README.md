# 🔦 Лабиринт: Побег — Telegram Mini App

Кооперативный хоррор-лабиринт для двоих. Два игрока должны выбраться из лабиринта, пока маньяк рыщет внутри. Используйте шум как приманку, чтобы отвлечь его от выхода!

## Механики

| Элемент | Описание |
|---------|----------|
| 🏃 Игроки | Двое. Оба должны добраться до выхода `⇒` |
| 😡 Маньяк | Стартует в центре, бродит и **быстрее** игроков |
| 📢 Шум | Привлекает маньяка, если он в радиусе 7 клеток. Перезарядка 4 сек |
| 🗺️ Туман | Ограниченная видимость — маньяк невидим, если далеко |
| 💀 Поражение | Маньяк догоняет любого игрока |
| 🎉 Победа | Оба игрока добрались до выхода |

## Стек

- **Сервер**: Node.js + Express + Socket.io
- **Клиент**: Vite + Canvas 2D (без фреймворков)
- **AI**: BFS-поиск пути для маньяка

## Быстрый запуск (локально)

### 1. Сервер

```bash
cd server
npm install
npm run dev
# Запустится на http://localhost:3001
```

### 2. Клиент

```bash
cd client
cp .env.example .env
# Отредактируйте .env если сервер на другом адресе
npm install
npm run dev
# Откроется на http://localhost:5173
```

### 3. Тест мультиплеера

Откройте два окна браузера на `http://localhost:5173`.  
Один создаёт комнату, второй вводит 6-значный код.

## Управление

| Устройство | Движение | Шум |
|------------|----------|-----|
| Клавиатура | WASD / стрелки | Пробел / E |
| Телефон | D-pad или свайп | Кнопка 📢 |

## Деплой для Telegram Mini App

### Требования
- Публичный HTTPS домен (сервер и клиент)
- Telegram Bot + Mini App, настроенный через [@BotFather](https://t.me/BotFather)

### Шаги

#### Сервер (например, Railway / Render / VPS)
```bash
cd server
npm install
PORT=3001 node src/index.js
```

#### Клиент (например, Vercel / Netlify)
```bash
cd client
# Укажите URL вашего сервера:
echo "VITE_SERVER_URL=https://your-server.example.com" > .env
npm run build
# Задеплойте папку dist/
```

#### Настройка бота
1. В [@BotFather](https://t.me/BotFather): `/newbot` → получите токен
2. `/mybots` → выберите бота → **Bot Settings** → **Menu Button** или **Mini App**
3. Введите URL задеплоенного клиента (HTTPS!)

### ngrok для разработки
```bash
# Терминал 1
ngrok http 5173

# Терминал 2  
ngrok http 3001
# Скопируйте HTTPS URL сервера в client/.env как VITE_SERVER_URL
```

## Структура проекта

```
labirint-2d/
├── server/
│   ├── package.json
│   └── src/
│       ├── index.js          # Express + Socket.io
│       ├── MazeGenerator.js  # Генерация лабиринта (DFS) + BFS
│       └── GameRoom.js       # Игровая логика, AI маньяка
└── client/
    ├── package.json
    ├── vite.config.js
    ├── index.html            # UI + CSS
    └── src/
        ├── main.js           # Управление экранами, socket-события
        ├── socket.js         # Socket.io клиент
        ├── Game.js           # Игровой цикл, ввод, интерполяция
        └── Renderer.js       # Canvas рендеринг, туман войны
```
