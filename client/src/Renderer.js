const CELL = 48;
const WALL = 5;

// Ночные темы по сложности
const THEMES = {
  easy: {
    bg:       '#04100a',
    floor:    '#071a0e',
    wall:     '#1a5c30',
    wallEdge: '#4caf70',
    fog:      'rgba(4,10,6,0.82)',
  },
  medium: {
    bg:       '#080810',
    floor:    '#0d0d1f',
    wall:     '#2a2a5a',
    wallEdge: '#5c5caa',
    fog:      'rgba(4,4,12,0.84)',
  },
  hard: {
    bg:       '#100404',
    floor:    '#1a0707',
    wall:     '#5a1a1a',
    wallEdge: '#aa3a3a',
    fog:      'rgba(12,4,4,0.86)',
  },
};

// Дневные темы — светлые и контрастные
const DAY_THEMES = {
  easy: {
    bg:       '#b8d4b0',
    floor:    '#c8e4c0',
    wall:     '#3a6040',
    wallEdge: '#5a9060',
    fog:      null,
  },
  medium: {
    bg:       '#b0b8d0',
    floor:    '#c0c8e0',
    wall:     '#3a3a6a',
    wallEdge: '#5a5a9a',
    fog:      null,
  },
  hard: {
    bg:       '#d0b0b0',
    floor:    '#e0c0c0',
    wall:     '#6a2a2a',
    wallEdge: '#9a4a4a',
    fog:      null,
  },
};

const C = {
  exit:     '#ffd54f',
  exitGlow: 'rgba(255,213,79,0.3)',
  p1:       '#4fc3f7',
  p2:       '#81c784',
  maniac:   '#ef5350',
};

// Угол поворота по направлению (right = 0, вращение по часовой)
function dirAngle(dir) {
  return { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[dir] ?? 0;
}

const VISIBILITY_AMBIENT = CELL * 2.8;  // круг вокруг себя
const VISIBILITY_CONE    = CELL * 7.5;  // луч фонарика
const CONE_ANGLE         = Math.PI / 1.6; // ~112° — широкий конус

export class Renderer {
  constructor(canvas, minimapCanvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.minimapCanvas = minimapCanvas;
    this.mmCtx  = minimapCanvas.getContext('2d');
    this.fogCanvas = document.createElement('canvas');
    this.fogCtx    = this.fogCanvas.getContext('2d');
    this.theme   = THEMES.medium;
    this.dayMode = false;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setTheme(difficulty) {
    this._difficulty = difficulty || 'medium';
    this.theme = this.dayMode
      ? (DAY_THEMES[this._difficulty] || DAY_THEMES.medium)
      : (THEMES[this._difficulty]     || THEMES.medium);
  }

  setDayMode(enabled) {
    this.dayMode = enabled;
    this.theme = enabled
      ? (DAY_THEMES[this._difficulty || 'medium'] || DAY_THEMES.medium)
      : (THEMES[this._difficulty || 'medium']     || THEMES.medium);
  }

  resize() {
    this.canvas.width        = window.innerWidth;
    this.canvas.height       = window.innerHeight;
    this.fogCanvas.width     = this.canvas.width;
    this.fogCanvas.height    = this.canvas.height;
  }

  render(state, myId, noiseEffects, pathHint, maniacSpeech, tapEffects) {
    if (!state?.maze) return;
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    const me = state.players[myId];
    if (!me) return;

    const camX = me.vx - W / 2;
    const camY = me.vy - H / 2;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(-camX, -camY);

    this.drawFloor(ctx, state);
    this.drawExit(ctx, state);
    this.drawPathHint(ctx, pathHint);
    this.drawNoiseEffects(ctx, noiseEffects);
    // Конус фонарика только в ночном режиме
    if (!this.dayMode) this.drawFlashlightBeams(ctx, state);
    this.drawWalls(ctx, state);
    this.drawPlayers(ctx, state, myId);
    this.drawManiac(ctx, state);
    this.drawManiacSpeech(ctx, state.maniac, maniacSpeech);

    ctx.restore();

    if (!this.dayMode) this.drawFogOfWar(state, myId, camX, camY);
    this.drawMinimap(state, myId);
    if (tapEffects?.length) this.drawTapEffects(ctx, tapEffects);
  }

  // ─── Ripple-эффект тапа (screen-space) ──────────────────────
  drawTapEffects(ctx, effects) {
    const now = Date.now();
    const DUR = 680; // мс полной анимации

    for (const fx of effects) {
      const t = Math.min(1, (now - fx.createdAt) / DUR); // 0→1
      const alpha = 1 - t;

      ctx.save();
      ctx.globalAlpha = alpha * 0.75;

      // Три кольца с разной фазой расширения
      for (let i = 0; i < 3; i++) {
        const phase = t - i * 0.18;
        if (phase <= 0) continue;
        const r = phase * 52;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = Math.max(0.5, 2.5 * (1 - phase));
        ctx.stroke();
      }

      // Маленький заполненный круг в центре (быстро исчезает)
      if (t < 0.3) {
        const cr = (1 - t / 0.3) * 7;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, cr, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fill();
      }

      // Стрелка-указатель направления (слегка прозрачная)
      ctx.globalAlpha = alpha * 0.55;
      ctx.save();
      ctx.translate(fx.x, fx.y);
      ctx.rotate(dirAngle(fx.dir));

      const dist = 28 + t * 18; // стрелка улетает вперёд
      const aw = 7, ah = 12;
      ctx.beginPath();
      ctx.moveTo(dist,          0);
      ctx.lineTo(dist - ah, -aw);
      ctx.lineTo(dist - ah,  aw);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fill();

      ctx.restore();
      ctx.restore();
    }
  }

  // ─── Пол ────────────────────────────────────────────────────
  drawFloor(ctx, { maze, mazeWidth, mazeHeight }) {
    ctx.fillStyle = this.theme.floor;
    for (let y = 0; y < mazeHeight; y++)
      for (let x = 0; x < mazeWidth; x++)
        ctx.fillRect(x * CELL + WALL, y * CELL + WALL, CELL - WALL, CELL - WALL);
  }

  // ─── Выход ──────────────────────────────────────────────────
  drawExit(ctx, { exit }) {
    const ex = exit.x * CELL, ey = exit.y * CELL;
    const grd = ctx.createRadialGradient(ex + CELL, ey + CELL / 2, 4, ex + CELL, ey + CELL / 2, CELL * 1.8);
    grd.addColorStop(0, C.exitGlow);
    grd.addColorStop(1, 'rgba(255,213,79,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(ex - CELL, ey - CELL, CELL * 4, CELL * 3);

    ctx.fillStyle = 'rgba(255,213,79,0.12)';
    ctx.fillRect(ex + WALL, ey + WALL, CELL - WALL, CELL - WALL);

    ctx.fillStyle = C.exit;
    ctx.font = `bold ${CELL * 0.5}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⇒', ex + CELL / 2, ey + CELL / 2);
  }

  // ─── Путь к выходу ──────────────────────────────────────────
  drawPathHint(ctx, hint) {
    if (!hint) return;
    const now = Date.now();
    const age = now - hint.createdAt;
    if (age > hint.duration) return;

    const FADE_IN = 400, FADE_OUT = 800;
    let alpha;
    if (age < FADE_IN) {
      alpha = age / FADE_IN;
    } else if (age > hint.duration - FADE_OUT) {
      alpha = (hint.duration - age) / FADE_OUT;
    } else {
      alpha = 1;
    }

    const cells = hint.cells;
    const t = now / 1000;

    // Линия вдоль пути (под точками)
    if (cells.length > 1) {
      ctx.beginPath();
      ctx.moveTo(cells[0].x * CELL + CELL / 2, cells[0].y * CELL + CELL / 2);
      for (let i = 1; i < cells.length; i++) {
        ctx.lineTo(cells[i].x * CELL + CELL / 2, cells[i].y * CELL + CELL / 2);
      }
      ctx.strokeStyle = `rgba(255,213,79,${alpha * 0.18})`;
      ctx.lineWidth = CELL * 0.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.lineWidth = 1;
    }

    // Точки вдоль пути (пропускаем первую — это игрок, и последнюю — выход)
    for (let i = 1; i < cells.length - 1; i++) {
      const cx = cells[i].x * CELL + CELL / 2;
      const cy = cells[i].y * CELL + CELL / 2;

      // Волна движется от игрока к выходу
      const wave = Math.sin(t * 4 - i * 0.6);
      const pulse = 0.65 + 0.35 * wave;
      const r = (3 + wave * 1.5) * pulse;
      const a = alpha * (0.55 + 0.35 * wave);

      ctx.shadowColor = '#ffd54f';
      ctx.shadowBlur  = 10;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(1, r), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,213,79,${a})`;
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Стрелка на предпоследней клетке к выходу
    const last = cells[cells.length - 1];
    const prev = cells[cells.length - 2] || last;
    const ax = last.x * CELL + CELL / 2;
    const ay = last.y * CELL + CELL / 2;
    const angle = Math.atan2(last.y - prev.y, last.x - prev.x);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(angle);
    ctx.fillStyle = `rgba(255,213,79,${alpha * 0.9})`;
    ctx.shadowColor = '#ffd54f';
    ctx.shadowBlur  = 12;
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.lineTo(-6, -6);
    ctx.lineTo(-6, 6);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }

  // ─── Конус фонариков (рисуется ДО стен — будет «перекрыт» туманом) ─
  drawFlashlightBeams(ctx, state) {
    for (const player of Object.values(state.players)) {
      if (player.escaped) continue;
      const cx = player.vx, cy = player.vy;
      const angle = dirAngle(player.lastDir || 'down');

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);

      const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, CELL * 4);
      grd.addColorStop(0,   'rgba(255,245,200,0.18)');
      grd.addColorStop(0.6, 'rgba(255,245,200,0.07)');
      grd.addColorStop(1,   'rgba(255,245,200,0)');

      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, CELL * 4, -CONE_ANGLE / 2, CONE_ANGLE / 2);
      ctx.closePath();
      ctx.fillStyle = grd;
      ctx.fill();
      ctx.restore();
    }
  }

  // ─── Стены ──────────────────────────────────────────────────
  drawWalls(ctx, { maze, mazeWidth, mazeHeight }) {
    for (let y = 0; y < mazeHeight; y++) {
      for (let x = 0; x < mazeWidth; x++) {
        const cell = maze[y][x];
        const px = x * CELL, py = y * CELL;

        // Угловой блок
        ctx.fillStyle = this.theme.wall;
        ctx.fillRect(px, py, WALL, WALL);

        if (cell.n) {
          // Тело стены
          ctx.fillStyle = this.theme.wall;
          ctx.fillRect(px, py, CELL, WALL);
          // Яркий верхний край (имитация объёма)
          ctx.fillStyle = this.theme.wallEdge;
          ctx.fillRect(px + WALL, py, CELL - WALL * 2, 2);
        }
        if (cell.w) {
          ctx.fillStyle = this.theme.wall;
          ctx.fillRect(px, py, WALL, CELL);
          ctx.fillStyle = this.theme.wallEdge;
          ctx.fillRect(px, py + WALL, 2, CELL - WALL * 2);
        }
        if (y === mazeHeight - 1 && cell.s) {
          ctx.fillStyle = this.theme.wall;
          ctx.fillRect(px, py + CELL - WALL, CELL, WALL);
          ctx.fillStyle = this.theme.wallEdge;
          ctx.fillRect(px + WALL, py + CELL - WALL, CELL - WALL * 2, 2);
        }
        if (x === mazeWidth - 1 && cell.e) {
          ctx.fillStyle = this.theme.wall;
          ctx.fillRect(px + CELL - WALL, py, WALL, CELL);
          ctx.fillStyle = this.theme.wallEdge;
          ctx.fillRect(px + CELL - WALL, py + WALL, 2, CELL - WALL * 2);
        }
      }
    }

    // Внешняя рамка лабиринта — жирная яркая обводка
    const totalW = mazeWidth  * CELL;
    const totalH = mazeHeight * CELL;
    ctx.strokeStyle = this.theme.wallEdge;
    ctx.lineWidth   = 3;
    ctx.shadowColor = this.theme.wallEdge;
    ctx.shadowBlur  = 8;
    ctx.strokeRect(1, 1, totalW - 2, totalH - 2);
    ctx.shadowBlur  = 0;
    ctx.lineWidth   = 1;
  }

  // ─── Шум ────────────────────────────────────────────────────
  drawNoiseEffects(ctx, noiseEffects) {
    const now = Date.now();
    for (const e of noiseEffects) {
      const age = now - e.startTime;
      if (age > 2000) continue;
      const p = age / 2000;
      const alpha = (1 - p) * 0.55;
      const r = e.radius * CELL * p;
      const cx = e.x * CELL + CELL / 2, cy = e.y * CELL + CELL / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,200,0,${alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, CELL * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,200,0,${alpha * 0.4})`;
      ctx.fill();
    }
  }

  // ─── Игроки — пиксельные человечки с фонариком ──────────────
  drawPlayers(ctx, state, myId) {
    const colors = [C.p1, C.p2];
    for (const [id, player] of Object.entries(state.players)) {
      if (player.escaped) continue;
      const color = colors[player.index] || C.p1;
      const isMe = id === myId;
      this._drawPixelPlayer(ctx, player.vx, player.vy, color, player.index + 1,
                            player.lastDir || 'down', isMe);
    }
  }

  _drawPixelPlayer(ctx, cx, cy, color, num, dir, isMe) {
    // Отступ — центр клетки, рисуем немного выше
    const oy = -4;

    ctx.save();

    // Свечение вокруг «своего» игрока
    if (isMe) {
      ctx.shadowColor = color;
      ctx.shadowBlur  = 12;
    }

    // ── Ноги ──
    const legColor = shadeColor(color, -60);
    ctx.fillStyle = legColor;
    ctx.fillRect(cx - 8,  cy + oy + 10, 6, 12); // левая
    ctx.fillRect(cx + 2,  cy + oy + 10, 6, 12); // правая

    // Ботинки
    ctx.fillStyle = '#111';
    ctx.fillRect(cx - 9,  cy + oy + 20, 8, 4);
    ctx.fillRect(cx + 1,  cy + oy + 20, 8, 4);

    // ── Тело (куртка) ──
    ctx.fillStyle = color;
    ctx.fillRect(cx - 11, cy + oy - 10, 22, 22);

    // Молния/деталь на груди
    ctx.fillStyle = shadeColor(color, +30);
    ctx.fillRect(cx - 1,  cy + oy - 8,  2, 14);

    ctx.shadowBlur = 0;

    // ── Рука с фонариком ──
    this._drawFlashlightArm(ctx, cx, cy + oy, dir, color);

    // ── Голова ──
    ctx.fillStyle = '#d4a574';
    ctx.beginPath();
    ctx.arc(cx, cy + oy - 19, 11, 0, Math.PI * 2);
    ctx.fill();

    // Волосы (цвет под тему персонажа)
    ctx.fillStyle = shadeColor(color, -80);
    ctx.fillRect(cx - 11, cy + oy - 30, 22, 8);
    ctx.beginPath();
    ctx.arc(cx, cy + oy - 19, 11, Math.PI, Math.PI * 2);
    ctx.fill();

    // ── Глаза (смотрят в направлении движения) ──
    const eyeShift = { right:[4,0], left:[-4,0], up:[0,-4], down:[2,2] }[dir] || [4,0];
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx + eyeShift[0], cy + oy - 19 + eyeShift[1], 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a1a1a';
    ctx.beginPath();
    ctx.arc(cx + eyeShift[0] + Math.sign(eyeShift[0]) * 0.5,
            cy + oy - 19 + eyeShift[1], 2, 0, Math.PI * 2);
    ctx.fill();

    // ── Номер игрока ──
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(num, cx, cy + oy + 1);

    ctx.restore();
  }

  _drawFlashlightArm(ctx, cx, cy, dir, bodyColor) {
    // Рука + корпус фонаря + свечение объектива
    const cfg = {
      right: { arm: [cx + 10, cy - 3,  14, 5],  lens: [cx + 24, cy] },
      left:  { arm: [cx - 24, cy - 3,  14, 5],  lens: [cx - 25, cy] },
      up:    { arm: [cx + 7,  cy - 24, 5,  14], lens: [cx + 9,  cy - 25] },
      down:  { arm: [cx + 7,  cy + 10, 5,  14], lens: [cx + 9,  cy + 25] },
    };
    const c = cfg[dir] || cfg.right;

    // Рука
    ctx.fillStyle = '#8d6e63';
    ctx.fillRect(...c.arm);

    // Корпус фонарика
    ctx.fillStyle = '#424242';
    ctx.fillRect(c.lens[0] - 3, c.lens[1] - 3, 9, 7);

    // Линза — жёлтое свечение
    ctx.shadowColor = '#ffd54f';
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = '#ffd54f';
    ctx.beginPath();
    ctx.arc(c.lens[0] + 1, c.lens[1], 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // ─── Маньяк — маска + топор ──────────────────────────────────
  drawManiac(ctx, state) {
    const { maniac } = state;
    const cx = maniac.vx, cy = maniac.vy;
    const isChasing = maniac.state === 'chasing';
    const isEnraged = maniac.enraged === true;
    const t = Date.now() / 1000;

    ctx.save();

    // Огненное свечение в режиме ярости
    if (isEnraged) this._drawRageFire(ctx, cx, cy, t);

    // Частицы ярости при погоне (или ярости)
    if (isChasing || isEnraged) this._drawRageParticles(ctx, cx, cy, t, isEnraged);

    // ── Ноги ──
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(cx - 10, cy + 8,  9, 14);
    ctx.fillRect(cx + 1,  cy + 8,  9, 14);

    // Сапоги
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(cx - 11, cy + 20, 11, 5);
    ctx.fillRect(cx,      cy + 20, 11, 5);

    // ── Широкие плечи / пальто ──
    const bodyColor = isEnraged ? '#8b0000' : isChasing ? '#3a0505' : '#141414';
    ctx.fillStyle = bodyColor;
    ctx.fillRect(cx - 15, cy - 14, 30, 24); // широкое тело
    ctx.fillRect(cx - 18, cy - 14, 36, 8);  // плечи

    // ── Топор ──
    const axeSway = isEnraged
      ? Math.sin(t * 14) * 10
      : isChasing
        ? Math.sin(t * 9) * 6
        : Math.sin(t * 1.5) * 3;

    // Рукоять
    ctx.fillStyle = '#5d4037';
    ctx.fillRect(cx + 15, cy - 24 + axeSway, 5, 28);

    // Лезвие
    ctx.fillStyle = isEnraged ? '#ff1100' : isChasing ? '#b71c1c' : '#9e9e9e';
    ctx.fillRect(cx + 13, cy - 36 + axeSway, 16, 16);

    // Блеск лезвия
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx + 25, cy - 35 + axeSway, 3, 13);

    // Кровь на топоре при погоне
    if (isChasing) {
      ctx.fillStyle = 'rgba(180,0,0,0.8)';
      ctx.fillRect(cx + 15, cy - 26 + axeSway, 10, 5);
    }

    // ── Голова ──
    ctx.fillStyle = '#c0a080';
    ctx.fillRect(cx - 13, cy - 36, 26, 24);

    // ── МАСКА (белая, хоккейная) ──
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(cx - 12, cy - 35, 24, 22);

    // Дырки под глаза (тёмные прямоугольники)
    ctx.fillStyle = '#111';
    ctx.fillRect(cx - 9,  cy - 30, 7, 6);
    ctx.fillRect(cx + 2,  cy - 30, 7, 6);

    // Горизонтальные полосы маски
    ctx.fillStyle = '#bbb';
    ctx.fillRect(cx - 12, cy - 22, 24, 2);
    ctx.fillRect(cx - 12, cy - 16, 24, 2);

    // Прорезь рта (зловещая)
    ctx.fillStyle = isChasing ? '#6a0000' : '#555';
    ctx.fillRect(cx - 6,  cy - 15, 12, 3);

    // Красные глаза внутри дырок при погоне
    if (isChasing) {
      ctx.fillStyle = '#ff1744';
      ctx.shadowColor = '#ff1744';
      ctx.shadowBlur  = 8;
      ctx.fillRect(cx - 8,  cy - 29, 5, 4);
      ctx.fillRect(cx + 3,  cy - 29, 5, 4);
      ctx.shadowBlur = 0;
    }

    // Свечение маньяка
    ctx.shadowColor = isChasing ? '#ef5350' : 'rgba(100,0,0,0.5)';
    ctx.shadowBlur  = isChasing ? 24 : 8;
    ctx.strokeStyle = isChasing ? '#ef5350' : '#330000';
    ctx.lineWidth   = 1.5;
    ctx.strokeRect(cx - 15, cy - 36, 30, 60);
    ctx.shadowBlur  = 0;

    ctx.restore();
  }

  _drawRageParticles(ctx, cx, cy, t, intense = false) {
    const count = intense ? 18 : 10;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + t * (intense ? 4 : 2.5);
      const dist  = (intense ? 34 : 26) + Math.sin(t * 4 + i * 0.9) * 10;
      const px    = cx + Math.cos(angle) * dist;
      const py    = cy + Math.sin(angle) * dist;
      const size  = (intense ? 4 : 2.5) + Math.sin(t * 6 + i * 0.6) * 1.5;
      const alpha = 0.6 + Math.sin(t * 5 + i) * 0.3;
      ctx.fillStyle = intense ? `rgba(255,60,0,${alpha})` : `rgba(239,83,80,${alpha})`;
      ctx.fillRect(px - size / 2, py - size / 2, size, size);
    }
  }

  // Огненное свечение вокруг маньяка в ярости
  _drawRageFire(ctx, cx, cy, t) {
    // Пульсирующий красный ореол
    const pulse = 0.55 + Math.sin(t * 8) * 0.2;
    const r1 = 42 + Math.sin(t * 6) * 6;
    const grd = ctx.createRadialGradient(cx, cy, 4, cx, cy, r1);
    grd.addColorStop(0,   `rgba(255,40,0,${pulse})`);
    grd.addColorStop(0.5, `rgba(200,0,0,${pulse * 0.5})`);
    grd.addColorStop(1,   'rgba(120,0,0,0)');
    ctx.beginPath();
    ctx.arc(cx, cy, r1, 0, Math.PI * 2);
    ctx.fillStyle = grd;
    ctx.fill();

    // Языки пламени (вверх)
    for (let i = 0; i < 6; i++) {
      const ox  = cx + (i - 2.5) * 8;
      const ht  = 18 + Math.sin(t * 9 + i * 1.3) * 8;
      const pha = 0.4 + Math.sin(t * 7 + i) * 0.3;
      ctx.beginPath();
      ctx.moveTo(ox - 5, cy - 18);
      ctx.quadraticCurveTo(ox + Math.sin(t * 5 + i) * 6, cy - 18 - ht / 2, ox, cy - 18 - ht);
      ctx.quadraticCurveTo(ox + 4, cy - 18 - ht / 2, ox + 5, cy - 18);
      ctx.closePath();
      ctx.fillStyle = i % 2 === 0 ? `rgba(255,120,0,${pha})` : `rgba(255,40,0,${pha})`;
      ctx.fill();
    }
  }

  // ─── Речевое облачко маньяка ─────────────────────────────────
  drawManiacSpeech(ctx, maniac, speech) {
    if (!speech) return;
    const now = Date.now();
    const age = now - speech.createdAt;
    if (age > speech.duration) return;

    const FADE_IN = 200, FADE_OUT = 600;
    let alpha;
    if (age < FADE_IN) alpha = age / FADE_IN;
    else if (age > speech.duration - FADE_OUT) alpha = (speech.duration - age) / FADE_OUT;
    else alpha = 1;

    const cx = maniac.vx;
    const cy = maniac.vy;

    ctx.save();
    ctx.globalAlpha = alpha;

    const text     = speech.text;
    const fontSize = 13;
    const pad      = { x: 12, y: 8 };
    const r        = 10; // радиус скругления

    ctx.font = `bold ${fontSize}px sans-serif`;
    const tw = ctx.measureText(text).width;
    const bw = tw + pad.x * 2;
    const bh = fontSize + pad.y * 2;

    // Позиция облачка — над головой маньяка
    const bx = cx - bw / 2;
    const by = cy - 68 - bh;
    const tailX = cx;
    const tailY = cy - 62;

    // Тень
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur  = 8;
    ctx.shadowOffsetY = 2;

    // Фон облачка
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    this._roundRect(ctx, bx, by, bw, bh, r);
    ctx.fill();

    // Хвостик (треугольник вниз)
    ctx.beginPath();
    ctx.moveTo(tailX - 7, by + bh - 1);
    ctx.lineTo(tailX,     tailY);
    ctx.lineTo(tailX + 7, by + bh - 1);
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.shadowOffsetY = 0;

    // Обводка
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.lineWidth   = 1;
    this._roundRect(ctx, bx, by, bw, bh, r);
    ctx.stroke();

    // Текст
    ctx.fillStyle    = '#1a1a2e';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, cx, by + bh / 2);

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // ─── Туман войны (конус фонарика + ambient) ─────────────────
  drawFogOfWar(state, myId, camX, camY) {
    const { fogCanvas, fogCtx } = this;
    const W = fogCanvas.width, H = fogCanvas.height;

    fogCtx.clearRect(0, 0, W, H);
    fogCtx.fillStyle = this.theme.fog;
    fogCtx.fillRect(0, 0, W, H);

    fogCtx.globalCompositeOperation = 'destination-out';

    for (const [, player] of Object.entries(state.players)) {
      if (player.escaped) continue;
      const sx = player.vx - camX;
      const sy = player.vy - camY;

      // Маленький ambient-круг вокруг себя
      const ag = fogCtx.createRadialGradient(sx, sy, 0, sx, sy, VISIBILITY_AMBIENT);
      ag.addColorStop(0, 'rgba(0,0,0,1)');
      ag.addColorStop(1, 'rgba(0,0,0,0)');
      fogCtx.fillStyle = ag;
      fogCtx.fillRect(0, 0, W, H);

      // Конус фонарика вперёд
      const angle = dirAngle(player.lastDir || 'down');
      fogCtx.save();
      fogCtx.translate(sx, sy);
      fogCtx.rotate(angle);

      fogCtx.beginPath();
      fogCtx.moveTo(0, 0);
      fogCtx.arc(0, 0, VISIBILITY_CONE, -CONE_ANGLE / 2, CONE_ANGLE / 2);
      fogCtx.closePath();

      const cg = fogCtx.createRadialGradient(0, 0, 0, 0, 0, VISIBILITY_CONE);
      cg.addColorStop(0,   'rgba(0,0,0,1)');
      cg.addColorStop(0.6, 'rgba(0,0,0,0.95)');
      cg.addColorStop(0.85,'rgba(0,0,0,0.6)');
      cg.addColorStop(1,   'rgba(0,0,0,0)');
      fogCtx.fillStyle = cg;
      fogCtx.fill();
      fogCtx.restore();
    }

    fogCtx.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(fogCanvas, 0, 0);
  }

  // ─── Мини-карта ─────────────────────────────────────────────
  drawMinimap(state, myId) {
    const { mmCtx, minimapCanvas } = this;
    const { mazeWidth: mw, mazeHeight: mh, maze, exit, players, maniac } = state;
    const MW = minimapCanvas.width, MH = minimapCanvas.height;
    const cw = MW / mw, ch = MH / mh;

    mmCtx.clearRect(0, 0, MW, MH);
    mmCtx.fillStyle = 'rgba(10,10,20,0.9)';
    mmCtx.fillRect(0, 0, MW, MH);

    mmCtx.fillStyle = '#2a2a4a';
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const cell = maze[y][x];
        if (cell.n) mmCtx.fillRect(x * cw, y * ch, cw, 1);
        if (cell.w) mmCtx.fillRect(x * cw, y * ch, 1, ch);
        if (y === mh - 1 && cell.s) mmCtx.fillRect(x * cw, (y + 1) * ch - 1, cw, 1);
        if (x === mw - 1 && cell.e) mmCtx.fillRect((x + 1) * cw - 1, y * ch, 1, ch);
      }
    }

    // Выход
    mmCtx.fillStyle = C.exit;
    mmCtx.fillRect(exit.x * cw + 1, exit.y * ch + 1, cw - 2, ch - 2);

    // Игроки
    const colors = [C.p1, C.p2];
    for (const [, p] of Object.entries(players)) {
      if (p.escaped) continue;
      mmCtx.beginPath();
      mmCtx.arc(p.x * cw + cw / 2, p.y * ch + ch / 2, Math.max(2, cw * 0.45), 0, Math.PI * 2);
      mmCtx.fillStyle = colors[p.index];
      mmCtx.fill();
    }

    // Маньяк
    mmCtx.beginPath();
    mmCtx.arc(maniac.x * cw + cw / 2, maniac.y * ch + ch / 2, Math.max(2, cw * 0.45), 0, Math.PI * 2);
    mmCtx.fillStyle = C.maniac;
    mmCtx.fill();
  }
}

// ─── Вспомогательные функции ────────────────────────────────────
function shadeColor(hex, amount) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount));
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount));
  return `rgb(${r},${g},${b})`;
}

export { CELL };
