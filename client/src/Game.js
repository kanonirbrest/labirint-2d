import { Renderer, CELL } from './Renderer.js';
import { send } from './socket.js';

const MOVE_INTERVAL = 280; // мс — порог для кнопок (синхронизирован с сервером)
const NOISE_COOLDOWN = 4000;
const LERP_K = 0.25; // коэффициент интерполяции за кадр (~60 fps)

export class Game {
  constructor(canvasEl, minimapEl) {
    this.renderer = new Renderer(canvasEl, minimapEl);
    this.state = null;
    this.myId = null;
    this.noiseEffects = [];

    this.heldDir = null;
    this.lastMoveSent = 0;
    this.lastNoiseSent = 0;

    this.rafId = null;
    this.lastTimestamp = 0;

    this._setupKeyboard();
    this._setupDpad();
    this._setupNoiseBtn();
    this._setupSwipe();
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
    this.updateNoiseBtn();
    this.startLoop();
  }

  stop() {
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
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

  addNoiseEffect({ x, y, radius }) {
    this.noiseEffects.push({ x, y, radius, startTime: Date.now() });
  }

  // ─── Игровой цикл ─────────────────────────────────────────────
  startLoop() {
    const loop = (timestamp) => {
      const dt = Math.min(timestamp - this.lastTimestamp, 100);
      this.lastTimestamp = timestamp;

      this.update(dt);
      this.renderer.render(this.state, this.myId, this.noiseEffects);

      this.rafId = requestAnimationFrame(loop);
    };
    this.lastTimestamp = performance.now();
    this.rafId = requestAnimationFrame(loop);
  }

  update(dt) {
    if (!this.state) return;

    // Очищаем устаревшие эффекты шума
    const now = Date.now();
    this.noiseEffects = this.noiseEffects.filter((e) => now - e.startTime < 2000);

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

  // ─── Управление: свайпы ───────────────────────────────────────
  _setupSwipe() {
    let sx = 0, sy = 0;

    document.addEventListener('touchstart', (e) => {
      // Игнорируем касания в зоне d-pad и кнопки шума
      if (e.target.closest('#controls')) return;
      const t = e.touches[0];
      sx = t.clientX;
      sy = t.clientY;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      if (e.target.closest('#controls')) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - sx;
      const dy = t.clientY - sy;
      const abs = Math.max(Math.abs(dx), Math.abs(dy));
      if (abs < 20) return;

      const dir = Math.abs(dx) > Math.abs(dy)
        ? (dx > 0 ? 'right' : 'left')
        : (dy > 0 ? 'down' : 'up');

      send('move', { direction: dir });
      this.lastMoveSent = Date.now();
    }, { passive: true });
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
