import { connect, send, on, offAll, getSocketId } from './socket.js';
import { Game } from './Game.js';

// ─── Telegram Web App ──────────────────────────────────────────
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

const tgUser = tg?.initDataUnsafe?.user;
const defaultName = tgUser
  ? (tgUser.first_name + (tgUser.last_name ? ' ' + tgUser.last_name : ''))
  : 'Игрок';

// ─── Экраны ────────────────────────────────────────────────────
const screens = {
  lobby:    document.getElementById('screen-lobby'),
  waiting:  document.getElementById('screen-waiting'),
  game:     document.getElementById('screen-game'),
  gameover: document.getElementById('screen-gameover'),
};

function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle('hidden', k !== name);
  });
}

showScreen('lobby');

// ─── Глобальное состояние ──────────────────────────────────────
let game = null;

const canvasEl  = document.getElementById('game-canvas');
const minimapEl = document.getElementById('minimap');

// ─── Лобби ─────────────────────────────────────────────────────
document.getElementById('btn-create').addEventListener('click', () => {
  connectAndDo(() => send('createRoom', { username: defaultName }));
});

document.getElementById('btn-join').addEventListener('click', joinRoom);
document.getElementById('room-code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});

function joinRoom() {
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (code.length < 6) {
    showLobbyError('Введите 6-значный код комнаты');
    return;
  }
  connectAndDo(() => send('joinRoom', { roomCode: code, username: defaultName }));
}

function connectAndDo(action) {
  setupSocketHandlers();
  connect((id) => {
    action();
  });
  // Если сокет уже подключён — action вызовется через connect()
}

document.getElementById('btn-cancel-wait').addEventListener('click', () => {
  offAll();
  showScreen('lobby');
});

function showLobbyError(msg) {
  const el = document.getElementById('lobby-error');
  el.textContent = msg;
  setTimeout(() => { el.textContent = ''; }, 3000);
}

// ─── HUD ───────────────────────────────────────────────────────
function updateHUD(playersData) {
  const p1 = Object.values(playersData).find((p) => p.index === 0);
  const p2 = Object.values(playersData).find((p) => p.index === 1);
  if (p1) document.getElementById('hud-p1-name').textContent = p1.username || 'Игрок 1';
  if (p2) document.getElementById('hud-p2-name').textContent = p2.username || 'Игрок 2';
}

function setHudStatus(text) {
  document.getElementById('hud-status').textContent = text;
}

// ─── Финальный экран ───────────────────────────────────────────
document.getElementById('btn-restart').addEventListener('click', () => {
  send('restartRequest');
  document.getElementById('btn-restart').disabled = true;
  document.getElementById('vote-status').textContent = 'Ваш голос — ждём второго...';
});

document.getElementById('btn-lobby').addEventListener('click', () => {
  offAll();
  game?.stop();
  game = null;
  showScreen('lobby');
});

// ─── Socket обработчики ────────────────────────────────────────
function setupSocketHandlers() {
  offAll();

  on('_disconnect', () => {
    if (!screens.game.classList.contains('hidden')) {
      game?.stop();
      showGameOver(false, 'Соединение потеряно');
    } else {
      showLobbyError('Соединение потеряно');
      showScreen('lobby');
    }
  });

  on('_error', () => {
    showLobbyError('Не удалось подключиться к серверу');
    showScreen('lobby');
  });

  on('roomCreated', ({ roomCode }) => {
    document.getElementById('display-room-code').textContent = roomCode;
    showScreen('waiting');
  });

  on('joinError', ({ message }) => {
    showLobbyError(message);
    showScreen('lobby');
  });

  on('gameStart', (data) => {
    const myId = getSocketId();

    if (!game) game = new Game(canvasEl, minimapEl);
    game.start(data, myId);
    updateHUD(data.players);
    setHudStatus('🏃 Бегите!');
    showScreen('game');
  });

  on('stateUpdate', (update) => {
    game?.applyStateUpdate(update);
  });

  on('playerMoved', (data) => {
    game?.applyPlayerMoved(data);
  });

  on('noiseEvent', (data) => {
    game?.addNoiseEffect(data);
    if (data.heard) {
      pulseHudAlert('😱 Маньяк услышал шум!', 2500);
    }
  });

  on('playerEscaped', ({ playerId }) => {
    game?.applyPlayerEscaped(playerId);
    const isMe = playerId === getSocketId();
    setHudStatus(isMe ? '✅ Вы выбрались! Ждём напарника...' : '✅ Напарник выбрался!');
  });

  on('gameOver', ({ won }) => {
    game?.stop();
    showGameOver(won);
  });

  on('partnerDisconnected', () => {
    game?.stop();
    showGameOver(false, 'Напарник отключился');
  });

  on('restartVote', ({ count }) => {
    const btn = document.getElementById('btn-restart');
    const status = document.getElementById('vote-status');
    if (count === 0) {
      btn.disabled = false;
      status.textContent = '';
    } else {
      status.textContent = `Голосов за рестарт: ${count}/2`;
    }
  });
}

function showGameOver(won, customSub) {
  document.getElementById('gameover-icon').textContent  = won ? '🎉' : '💀';
  document.getElementById('gameover-title').textContent = won ? 'Вы сбежали!' : 'Пойманы!';
  document.getElementById('gameover-sub').textContent   = customSub || (won
    ? 'Оба игрока выбрались из лабиринта. Отличная командная работа!'
    : 'Маньяк вас настиг... В следующий раз повезёт.');
  document.getElementById('vote-status').textContent = '';
  document.getElementById('btn-restart').disabled = false;
  showScreen('gameover');
}

let hudAlertTimer = null;
function pulseHudAlert(text, duration) {
  clearTimeout(hudAlertTimer);
  setHudStatus(text);
  hudAlertTimer = setTimeout(() => setHudStatus('🏃 Бегите!'), duration);
}
