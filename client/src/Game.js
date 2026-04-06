import { Renderer, CELL } from './Renderer.js';
import { send } from './socket.js';
import { AudioManager } from './AudioManager.js';

const MOVE_INTERVAL = 280; // мс — порог для кнопок (синхронизирован с сервером)
const NOISE_COOLDOWN = 4000;
const LERP_K = 0.25; // коэффициент интерполяции за кадр (~60 fps)

export class Game {
  constructor(canvasEl, minimapEl) {
    this.renderer = new Renderer(canvasEl, minimapEl);
    this.audio    = new AudioManager();
    this.state = null;
    this.myId = null;
    this.noiseEffects = [];
    this.pathHint = null;
    this.pathHintInterval = null;
    this.maniacSpeech = null;

    this.heldDir = null;
    this.lastMoveSent = 0;
    this.lastNoiseSent = 0;
    this.tapEffects = [];

    this.rafId = null;
    this.lastTimestamp = 0;

    this._setupKeyboard();
    this._setupDpad();
    this._setupNoiseBtn();
    this._setupTapToMove();
  }

  // ─── Инициализация ────────────────────────────────────────────
  start(gameStartData, mySocketId) {
    this.myId = mySocketId;
    this.noiseEffects = [];
    this.lastMoveSent = 0;
    this.lastNoiseSent = 0;

    this.state = {
      maze:       gameStartData.maze,
      mazeWidth:  gameStartData.mazeWidth,
      mazeHeight: gameStartData.mazeHeight,
      exit:       gameStartData.exit,
      players:    {},
      maniac:     { ...gameStartData.maniac },
      noiseRadius: gameStartData.noiseRadius,
    };

    // Инициализируем визуальные позиции игроков
    for (const [id, p] of Object.entries(gameStartData.players)) {
      this.state.players[id] = {
        ...p,
        vx: p.x * CELL + CELL / 2,
        vy: p.y * CELL + CELL / 2,
        lastDir: 'down',
      };
    }

    // Визуальные позиции маньяка
    const m = this.state.maniac;
    m.vx = m.x * CELL + CELL / 2;
    m.vy = m.y * CELL + CELL / 2;
    m.lastDir = 'down';

    this.renderer.setTheme(gameStartData.difficulty || 'medium');
    this.pathHint = null;
    this.maniacSpeech = null;
    this._startPathHintTimer();
    this.audio.startAmbient();
    this.updateNoiseBtn();
    this.startLoop();
  }

  setDayMode(enabled) {
    this.renderer.setDayMode(enabled);
  }

  stop() {
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
    if (this.pathHintInterval) {
      clearInterval(this.pathHintInterval);
      this.pathHintInterval = null;
    }
    this.audio.stop();
  }

  toggleMute() {
    return this.audio.toggleMute();
  }

  playWin()  { this.audio.playWin(); }
  playLose() { this.audio.playLose(); }

  onManiacEnraged() {
    if (this.state?.maniac) this.state.maniac.enraged = true;
    this.audio.playEnraged();
    this.audio.speakManiac('Я вас найду!!!');
  }

  onManiacCalmDown() {
    if (this.state?.maniac) this.state.maniac.enraged = false;
  }

  applyWallBroken({ x, y, dir, nx, ny, oppDir }) {
    if (!this.state?.maze) return;
    if (this.state.maze[y]?.[x])   this.state.maze[y][x][dir]    = false;
    if (this.state.maze[ny]?.[nx]) this.state.maze[ny][nx][oppDir] = false;
  }

  _startPathHintTimer() {
    if (this.pathHintInterval) clearInterval(this.pathHintInterval);
    this.pathHintInterval = setInterval(() => this._showPathHint(), 5000);
  }

  _showPathHint() {
    if (!this.state) return;
    const me = this.state.players[this.myId];
    if (!me || me.escaped) return;

    const path = mazePathFind(this.state.maze, { x: me.x, y: me.y }, this.state.exit);
    if (path && path.length > 1) {
      this.pathHint = { cells: path, createdAt: Date.now(), duration: 3500 };
    }
  }

  // ─── Обновление состояния от сервера ──────────────────────────
  applyStateUpdate({ players, maniac }) {
    if (!this.state) return;

    for (const [id, p] of Object.entries(players)) {
      if (this.state.players[id]) {
        Object.assign(this.state.players[id], p);
      }
    }
    // Определяем направление маньяка по изменению позиции
    const m = this.state.maniac;
    const dx = maniac.x - m.x;
    const dy = maniac.y - m.y;
    if (dx > 0) m.lastDir = 'right';
    else if (dx < 0) m.lastDir = 'left';
    else if (dy > 0) m.lastDir = 'down';
    else if (dy < 0) m.lastDir = 'up';
    Object.assign(m, maniac);
  }

  applyPlayerMoved({ playerId, x, y }) {
    if (!this.state?.players[playerId]) return;
    const p = this.state.players[playerId];
    // Определяем направление по изменению позиции
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx > 0) p.lastDir = 'right';
    else if (dx < 0) p.lastDir = 'left';
    else if (dy > 0) p.lastDir = 'down';
    else if (dy < 0) p.lastDir = 'up';
    p.x = x;
    p.y = y;
  }

  applyPlayerEscaped(playerId) {
    if (this.state?.players[playerId]) {
      this.state.players[playerId].escaped = true;
    }
  }

  addNoiseEffect({ x, y, radius, heard }) {
    this.noiseEffects.push({ x, y, radius, startTime: Date.now() });
    if (heard) {
      const phrases = [
        'Откуда звук?',
        'Кто здесь?!',
        'Слышу тебя!',
        'Я иду за тобой...',
        'Не убежишь!',
        'Попался!',
      ];
      const text = phrases[Math.floor(Math.random() * phrases.length)];
      this.maniacSpeech = { text, createdAt: Date.now(), duration: 3000 };
      this.audio.playManiacHear();
      // Небольшая задержка чтобы звук не перекрывал эффект шума
      setTimeout(() => this.audio.speakManiac(text), 400);
    }
  }

  // ─── Игровой цикл ─────────────────────────────────────────────
  startLoop() {
    const loop = (timestamp) => {
      const dt = Math.min(timestamp - this.lastTimestamp, 100);
      this.lastTimestamp = timestamp;

      this.update(dt);
      this.renderer.render(this.state, this.myId, this.noiseEffects, this.pathHint, this.maniacSpeech, this.tapEffects);

      this.rafId = requestAnimationFrame(loop);
    };
    this.lastTimestamp = performance.now();
    this.rafId = requestAnimationFrame(loop);
  }

  update(dt) {
    if (!this.state) return;

    // Очищаем устаревшие эффекты
    const now = Date.now();
    this.noiseEffects = this.noiseEffects.filter((e) => now - e.startTime < 2000);
    this.tapEffects   = this.tapEffects.filter((e)   => now - e.createdAt < 700);

    // Интерполяция игроков к целевым позициям
    for (const p of Object.values(this.state.players)) {
      const tx = p.x * CELL + CELL / 2;
      const ty = p.y * CELL + CELL / 2;
      p.vx = lerp(p.vx, tx, LERP_K);
      p.vy = lerp(p.vy, ty, LERP_K);
    }

    // Интерполяция маньяка
    const m = this.state.maniac;
    const mtx = m.x * CELL + CELL / 2;
    const mty = m.y * CELL + CELL / 2;
    m.vx = lerp(m.vx ?? mtx, mtx, LERP_K);
    m.vy = lerp(m.vy ?? mty, mty, LERP_K);

    // Отправка движения при зажатой кнопке
    if (this.heldDir && now - this.lastMoveSent >= MOVE_INTERVAL) {
      send('move', { direction: this.heldDir });
      this.lastMoveSent = now;
      if (this.myId && this.state?.players[this.myId])
        this.state.players[this.myId].lastDir = this.heldDir;
      this.audio.playStep();
    }

    // Сердцебиение когда маньяк близко
    if (this.state?.maniac && this.myId) {
      this.audio.tickHeartbeat(this.state.maniac, this.state.players[this.myId]);
    }

    // Обновить кнопку шума (cooldown)
    this.updateNoiseBtn();
  }

  // ─── Управление: клавиатура ────────────────────────────────────
  _setupKeyboard() {
    const MAP = {
      ArrowUp: 'up', w: 'up', W: 'up',
      ArrowDown: 'down', s: 'down', S: 'down',
      ArrowLeft: 'left', a: 'left', A: 'left',
      ArrowRight: 'right', d: 'right', D: 'right',
    };

    document.addEventListener('keydown', (e) => {
      if (MAP[e.key]) {
        e.preventDefault();
        this.heldDir = MAP[e.key];
        const now = Date.now();
        if (now - this.lastMoveSent >= MOVE_INTERVAL) {
          send('move', { direction: this.heldDir });
          this.lastMoveSent = now;
          if (this.myId && this.state?.players[this.myId])
            this.state.players[this.myId].lastDir = this.heldDir;
        }
      }
      if (e.key === ' ' || e.key === 'e' || e.key === 'E') {
        e.preventDefault();
        this.triggerNoise();
      }
    });

    document.addEventListener('keyup', (e) => {
      const MAP_UP = {
        ArrowUp:'up', w:'up', W:'up',
        ArrowDown:'down', s:'down', S:'down',
        ArrowLeft:'left', a:'left', A:'left',
        ArrowRight:'right', d:'right', D:'right',
      };
      if (MAP_UP[e.key] && this.heldDir === MAP_UP[e.key]) {
        this.heldDir = null;
      }
    });
  }

  // ─── Управление: D-pad ────────────────────────────────────────
  _setupDpad() {
    const dpad = document.getElementById('dpad');
    if (!dpad) return;

    const startDir = (dir) => {
      this.heldDir = dir;
      const now = Date.now();
      if (now - this.lastMoveSent >= MOVE_INTERVAL) {
        send('move', { direction: dir });
        this.lastMoveSent = now;
      }
      dpad.querySelectorAll('[data-dir]').forEach((b) =>
        b.classList.toggle('pressed', b.dataset.dir === dir)
      );
    };
    const stopDir = () => {
      this.heldDir = null;
      dpad.querySelectorAll('[data-dir]').forEach((b) => b.classList.remove('pressed'));
    };

    dpad.querySelectorAll('[data-dir]').forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); startDir(btn.dataset.dir); });
    });
    dpad.addEventListener('pointerup',    stopDir);
    dpad.addEventListener('pointerleave', stopDir);
    dpad.addEventListener('pointercancel', stopDir);
  }

  // ─── Управление: кнопка шума ──────────────────────────────────
  _setupNoiseBtn() {
    const btn = document.getElementById('noise-btn');
    if (!btn) return;
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.triggerNoise(); });
  }

  triggerNoise() {
    const now = Date.now();
    if (now - this.lastNoiseSent < NOISE_COOLDOWN) return;
    this.audio.resume();
    this.audio.playNoise();
    send('makeNoise');
    this.lastNoiseSent = now;
    this.updateNoiseBtn();
  }

  updateNoiseBtn() {
    const btn = document.getElementById('noise-btn');
    if (!btn) return;
    const elapsed = Date.now() - this.lastNoiseSent;
    const ready = elapsed >= NOISE_COOLDOWN;
    btn.classList.toggle('cooldown', !ready);
  }

  // ─── Управление: тап / свайп по экрану ───────────────────────
  _setupTapToMove() {
    const canvas = this.renderer.canvas;
    let sx = 0, sy = 0, scx = 0, scy = 0;

    // Запоминаем точку касания
    const onStart = (clientX, clientY, target) => {
      if (target.closest('#controls') || target.closest('#hud')) return;
      sx = clientX; sy = clientY;
      // Canvas-координаты (учитываем масштаб CSS)
      const r = canvas.getBoundingClientRect();
      scx = (clientX - r.left) * (canvas.width  / r.width);
      scy = (clientY - r.top)  * (canvas.height / r.height);
    };

    const onEnd = (clientX, clientY, target) => {
      if (target.closest('#controls') || target.closest('#hud')) return;
      const dx = clientX - sx;
      const dy = clientY - sy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      let dir;
      if (dist < 18) {
        // ── Тап: направление от центра экрана ──────────────────
        const r   = canvas.getBoundingClientRect();
        const cx  = (clientX - r.left) * (canvas.width  / r.width);
        const cy  = (clientY - r.top)  * (canvas.height / r.height);
        const ddx = cx - canvas.width  / 2;
        const ddy = cy - canvas.height / 2;
        if (Math.abs(ddx) < 10 && Math.abs(ddy) < 10) return; // слишком близко к центру
        dir = Math.abs(ddx) > Math.abs(ddy)
          ? (ddx > 0 ? 'right' : 'left')
          : (ddy > 0 ? 'down'  : 'up');

        // Ripple-эффект в точке касания
        this.tapEffects.push({ x: cx, y: cy, dir, createdAt: Date.now() });
      } else {
        // ── Свайп: направление по дельте ───────────────────────
        if (dist < 20) return;
        dir = Math.abs(dx) > Math.abs(dy)
          ? (dx > 0 ? 'right' : 'left')
          : (dy > 0 ? 'down'  : 'up');

        // Ripple в середине свайпа
        const r  = canvas.getBoundingClientRect();
        const mx = (((sx + clientX) / 2) - r.left) * (canvas.width  / r.width);
        const my = (((sy + clientY) / 2) - r.top)  * (canvas.height / r.height);
        this.tapEffects.push({ x: mx, y: my, dir, createdAt: Date.now() });
      }

      const now = Date.now();
      if (now - this.lastMoveSent >= MOVE_INTERVAL) {
        send('move', { direction: dir });
        this.lastMoveSent = now;
        if (this.myId && this.state?.players[this.myId])
          this.state.players[this.myId].lastDir = dir;
        this.audio.playStep();
      }
    };

    // Touch-события
    canvas.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      onStart(t.clientX, t.clientY, e.target);
    }, { passive: true });

    canvas.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      onEnd(t.clientX, t.clientY, e.target);
    }, { passive: true });

    // Mouse-события (для тестирования на ПК)
    canvas.addEventListener('mousedown', (e) => {
      onStart(e.clientX, e.clientY, e.target);
    });
    canvas.addEventListener('mouseup', (e) => {
      onEnd(e.clientX, e.clientY, e.target);
    });
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// BFS поиск пути на клиенте (аналог серверного)
function mazePathFind(cells, start, end) {
  if (!cells) return null;
  const h = cells.length, w = cells[0].length;
  const startKey = `${start.x},${start.y}`;
  const endKey   = `${end.x},${end.y}`;
  if (startKey === endKey) return [start];

  const queue = [startKey];
  const parent = new Map([[startKey, null]]);
  const deltas = [
    { dx: 0, dy: -1, wall: 'n' }, { dx: 1, dy: 0, wall: 'e' },
    { dx: 0, dy: 1,  wall: 's' }, { dx: -1, dy: 0, wall: 'w' },
  ];

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === endKey) {
      const path = [];
      let k = endKey;
      while (k !== null) {
        const [x, y] = k.split(',').map(Number);
        path.unshift({ x, y });
        k = parent.get(k);
      }
      return path;
    }
    const [cx, cy] = cur.split(',').map(Number);
    for (const { dx, dy, wall } of deltas) {
      if (cells[cy][cx][wall]) continue;
      const nx = cx + dx, ny = cy + dy;
      const nk = `${nx},${ny}`;
      if (!parent.has(nk) && nx >= 0 && nx < w && ny >= 0 && ny < h) {
        parent.set(nk, cur);
        queue.push(nk);
      }
    }
  }
  return null;
}
