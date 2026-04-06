import { connect, send, on, offAll, getSocketId } from './socket.js';
import { Game } from './Game.js';

// ─── Telegram Web App ──────────────────────────────────────────
const tg = window.Telegram?.WebApp;
if (tg) { tg.ready(); tg.expand(); }

const tgUser = tg?.initDataUnsafe?.user;
const defaultName = tgUser
  ? (tgUser.first_name + (tgUser.last_name ? ' ' + tgUser.last_name : ''))
  : 'Игрок';

// ─── Экраны ────────────────────────────────────────────────────
const screens = {
  lobby:      document.getElementById('screen-lobby'),
  difficulty: document.getElementById('screen-difficulty'),
  waiting:    document.getElementById('screen-waiting'),
  game:       document.getElementById('screen-game'),
  gameover:   document.getElementById('screen-gameover'),
};

function showScreen(name) {
  Object.entries(screens).forEach(([k, el]) => {
    el.classList.toggle('hidden', k !== name);
  });
}

showScreen('lobby');

// ─── Состояние ─────────────────────────────────────────────────
let game = null;
let selectedDifficulty = 'medium';
let selectedDayMode = false; // false = ночь, true = день

const canvasEl  = document.getElementById('game-canvas');
const minimapEl = document.getElementById('minimap');

// ─── Лобби ─────────────────────────────────────────────────────
document.getElementById('btn-create').addEventListener('click', () => {
  showScreen('difficulty');
});

document.getElementById('btn-join').addEventListener('click', joinRoom);
document.getElementById('room-code-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});

function joinRoom() {
  const code = document.getElementById('room-code-input').value.trim().toUpperCase();
  if (code.length < 6) { showLobbyError('Введите 6-значный код комнаты'); return; }
  connectAndDo(() => send('joinRoom', { roomCode: code, username: defaultName }));
}

// ─── Выбор сложности ───────────────────────────────────────────
document.querySelectorAll('.diff-card').forEach((card) => {
  card.addEventListener('click', () => {
    selectedDifficulty = card.dataset.diff;
    connectAndDo(() => send('createRoom', { username: defaultName, difficulty: selectedDifficulty }));
  });
});

// ─── Выбор день/ночь (на экране сложности) ─────────────────────
document.querySelectorAll('.daynight-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.daynight-btn').forEach((b) => b.classList.remove('selected'));
    btn.classList.add('selected');
    selectedDayMode = btn.dataset.mode === 'day';
  });
});

// ─── Кнопка mute в HUD ─────────────────────────────────────────
document.getElementById('hud-mute').addEventListener('click', () => {
  const muted = game?.toggleMute();
  document.getElementById('hud-mute').textContent = muted ? '🔇' : '🔊';
});

// ─── Кнопка день/ночь в HUD ────────────────────────────────────
document.getElementById('hud-daynight').addEventListener('click', () => {
  selectedDayMode = !selectedDayMode;
  document.getElementById('hud-daynight').textContent = selectedDayMode ? '☀️' : '🌙';
  game?.setDayMode(selectedDayMode);
});

document.getElementById('btn-back-to-lobby').addEventListener('click', () => {
  showScreen('lobby');
});

// ─── Ожидание ──────────────────────────────────────────────────
document.getElementById('btn-cancel-wait').addEventListener('click', () => {
  offAll();
  showScreen('lobby');
});

// ─── Утилиты ───────────────────────────────────────────────────
function connectAndDo(action) {
  setupSocketHandlers();
  connect(() => action());
}

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

// ─── Финал ─────────────────────────────────────────────────────
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
    game.setDayMode(selectedDayMode);
    document.getElementById('hud-daynight').textContent = selectedDayMode ? '☀️' : '🌙';
    updateHUD(data.players);

    const diffLabels = { easy: '🌿 Простой', medium: '🏚️ Средний', hard: '🩸 Сложный' };
    setHudStatus(diffLabels[data.difficulty] || '🏃 Бегите!');
    setTimeout(() => setHudStatus('🏃 Бегите!'), 3000);

    showScreen('game');
  });

  on('stateUpdate',   (u)    => game?.applyStateUpdate(u));
  on('playerMoved',   (d)    => game?.applyPlayerMoved(d));

  on('noiseEvent', (data) => {
    game?.addNoiseEffect(data);
    if (data.heard) pulseHudAlert('😱 Маньяк услышал шум!', 2500);
  });

  on('maniacEnraged', () => {
    game?.onManiacEnraged();
    pulseHudAlert('🔥 МАНЬЯК В ЯРОСТИ — он ломает стены!', 4000, '#ff2200');
  });

  on('maniacCalmDown', () => {
    game?.onManiacCalmDown();
  });

  on('wallBroken', (data) => {
    game?.applyWallBroken(data);
  });

  on('playerEscaped', ({ playerId }) => {
    game?.applyPlayerEscaped(playerId);
    const isMe = playerId === getSocketId();
    setHudStatus(isMe ? '✅ Вы выбрались! Ждём напарника...' : '✅ Напарник выбрался!');
  });

  on('gameOver', ({ won }) => {
    if (won) game?.playWin(); else game?.playLose();
    setTimeout(() => { game?.stop(); showGameOver(won); }, 800);
  });

  on('partnerDisconnected', () => {
    game?.stop();
    showGameOver(false, 'Напарник отключился');
  });

  on('restartVote', ({ count }) => {
    const btn = document.getElementById('btn-restart');
    const status = document.getElementById('vote-status');
    if (count === 0) { btn.disabled = false; status.textContent = ''; }
    else status.textContent = `Голосов за рестарт: ${count}/2`;
  });
}

function showGameOver(won, customSub) {
  document.getElementById('gameover-icon').textContent  = won ? '🎉' : '💀';
  document.getElementById('gameover-title').textContent = won ? 'Вы сбежали!' : 'Пойманы!';
  document.getElementById('gameover-sub').textContent   = customSub || (won
    ? 'Оба игрока выбрались! Отличная командная работа!'
    : 'Маньяк вас настиг... В следующий раз повезёт.');
  document.getElementById('vote-status').textContent = '';
  document.getElementById('btn-restart').disabled = false;
  showScreen('gameover');
}

let hudAlertTimer = null;
function pulseHudAlert(text, duration, color) {
  clearTimeout(hudAlertTimer);
  const el = document.getElementById('hud-status');
  el.textContent = text;
  if (color) el.style.color = color;
  hudAlertTimer = setTimeout(() => {
    setHudStatus('🏃 Бегите!');
    el.style.color = '';
  }, duration);
}
