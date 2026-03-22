const CELL = 48;
const WALL = 3;

// Темы по сложности
const THEMES = {
  easy: {
    bg:       '#04100a',
    floor:    '#071a0e',
    wall:     '#0f3320',
    wallEdge: '#1d6640',
    fog:      'rgba(4,10,6,0.91)',
    hudAccent:'#81c784',
  },
  medium: {
    bg:       '#080810',
    floor:    '#0d0d1f',
    wall:     '#1e1e3a',
    wallEdge: '#3a3a60',
    fog:      'rgba(4,4,12,0.92)',
    hudAccent:'#4fc3f7',
  },
  hard: {
    bg:       '#100404',
    floor:    '#1a0707',
    wall:     '#3a1010',
    wallEdge: '#6a2020',
    fog:      'rgba(12,4,4,0.93)',
    hudAccent:'#ef5350',
  },
};

// Константы, не зависящие от темы
const C = {
  exit:      '#ffd54f',
  exitGlow:  'rgba(255,213,79,0.3)',
  p1:        '#4fc3f7',
  p2:        '#81c784',
  maniac:    '#ef5350',
  noiseRing: 'rgba(255,200,0,0.7)',
};

const VISIBILITY = 5.5 * CELL; // радиус видимости в пикселях

export class Renderer {
  constructor(canvas, minimapCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.minimapCanvas = minimapCanvas;
    this.mmCtx = minimapCanvas.getContext('2d');

    this.fogCanvas = document.createElement('canvas');
    this.fogCtx = this.fogCanvas.getContext('2d');

    this.theme = THEMES.medium; // по умолчанию

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  setTheme(difficulty) {
    this.theme = THEMES[difficulty] || THEMES.medium;
  }

  resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this.fogCanvas.width  = this.canvas.width;
    this.fogCanvas.height = this.canvas.height;
  }

  render(state, myId, noiseEffects) {
    if (!state?.maze) return;

    const { ctx, canvas } = this;
    const W = canvas.width;
    const H = canvas.height;

    const me = state.players[myId];
    if (!me) return;

    // Камера: центрируем на моём игроке
    const camX = me.vx - W / 2;
    const camY = me.vy - H / 2;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = this.theme.bg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(-camX, -camY);

    this.drawFloor(ctx, state);
    this.drawExit(ctx, state);
    this.drawNoiseEffects(ctx, noiseEffects);
    this.drawWalls(ctx, state);
    this.drawPlayers(ctx, state, myId);
    this.drawManiac(ctx, state);

    ctx.restore();

    this.drawFogOfWar(state, myId, camX, camY);
    this.drawMinimap(state, myId);
  }

  drawFloor(ctx, state) {
    const { maze, mazeWidth, mazeHeight } = state;
    ctx.fillStyle = this.theme.floor;
    for (let y = 0; y < mazeHeight; y++) {
      for (let x = 0; x < mazeWidth; x++) {
        ctx.fillRect(x * CELL + WALL, y * CELL + WALL, CELL - WALL, CELL - WALL);
      }
    }
  }

  drawExit(ctx, state) {
    const { exit } = state;
    const ex = exit.x * CELL;
    const ey = exit.y * CELL;

    // Сияние выхода
    const grd = ctx.createRadialGradient(ex + CELL, ey + CELL / 2, 4, ex + CELL, ey + CELL / 2, CELL * 1.5);
    grd.addColorStop(0, C.exitGlow);
    grd.addColorStop(1, 'rgba(255,213,79,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(ex - CELL, ey - CELL, CELL * 4, CELL * 3);

    // Клетка выхода
    ctx.fillStyle = 'rgba(255,213,79,0.15)';
    ctx.fillRect(ex + WALL, ey + WALL, CELL - WALL, CELL - WALL);

    // Стрелка вправо
    ctx.fillStyle = C.exit;
    ctx.font = `bold ${CELL * 0.5}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⇒', ex + CELL / 2, ey + CELL / 2);
  }

  drawNoiseEffects(ctx, noiseEffects) {
    const now = Date.now();
    for (const effect of noiseEffects) {
      const age = now - effect.startTime;
      const duration = 2000;
      if (age > duration) continue;

      const progress = age / duration;
      const alpha = (1 - progress) * 0.6;
      const radius = effect.radius * CELL * progress;

      const cx = effect.x * CELL + CELL / 2;
      const cy = effect.y * CELL + CELL / 2;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,200,0,${alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Внутренний пульс
      ctx.beginPath();
      ctx.arc(cx, cy, CELL * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,200,0,${alpha * 0.5})`;
      ctx.fill();
    }
  }

  drawWalls(ctx, state) {
    const { maze, mazeWidth, mazeHeight } = state;
    ctx.fillStyle = C.wall;

    for (let y = 0; y < mazeHeight; y++) {
      for (let x = 0; x < mazeWidth; x++) {
        const cell = maze[y][x];
        const px = x * CELL;
        const py = y * CELL;

        // Угловые блоки (всегда рисуем)
        ctx.fillStyle = this.theme.wall;
        ctx.fillRect(px, py, WALL, WALL);

        // Северная стена
        if (cell.n) {
          ctx.fillStyle = this.theme.wall;
          ctx.fillRect(px, py, CELL, WALL);
          ctx.fillStyle = this.theme.wallEdge;
          ctx.fillRect(px + WALL, py, CELL - WALL * 2, 1);
        }

        // Западная стена
        if (cell.w) {
          ctx.fillStyle = this.theme.wall;
          ctx.fillRect(px, py, WALL, CELL);
          ctx.fillStyle = this.theme.wallEdge;
          ctx.fillRect(px, py + WALL, 1, CELL - WALL * 2);
        }

        // Южная и восточная стены для последней строки/столбца
        if (y === mazeHeight - 1 && cell.s) {
          ctx.fillStyle = this.theme.wall;
          ctx.fillRect(px, py + CELL - WALL, CELL, WALL);
        }
        if (x === mazeWidth - 1 && cell.e) {
          ctx.fillStyle = this.theme.wall;
          ctx.fillRect(px + CELL - WALL, py, WALL, CELL);
        }
      }
    }
  }

  drawPlayers(ctx, state, myId) {
    const colors = [C.p1, C.p2];

    for (const [id, player] of Object.entries(state.players)) {
      if (player.escaped) continue;

      const cx = player.vx;
      const cy = player.vy;
      const r  = CELL * 0.36;
      const color = colors[player.index] || C.p1;
      const isMe = id === myId;

      // Тень/свечение
      ctx.shadowColor = color;
      ctx.shadowBlur = isMe ? 14 : 8;

      // Тело
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Обводка для «моего» игрока
      if (isMe) {
        ctx.beginPath();
        ctx.arc(cx, cy, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Индикатор игрока
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${CELL * 0.28}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(player.index === 0 ? '1' : '2', cx, cy);
    }
  }

  drawManiac(ctx, state) {
    const { maniac } = state;
    const cx = maniac.vx;
    const cy = maniac.vy;
    const r  = CELL * 0.4;

    const isChasing = maniac.state === 'chasing';

    // Пульсирующее свечение
    ctx.shadowColor = C.maniac;
    ctx.shadowBlur  = isChasing ? 24 : 12;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = C.maniac;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Иконка-знак
    ctx.fillStyle = '#fff';
    ctx.font = `${CELL * 0.4}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isChasing ? '😡' : '👁️', cx, cy);
  }

  drawFogOfWar(state, myId, camX, camY) {
    const { fogCanvas, fogCtx } = this;
    const W = fogCanvas.width;
    const H = fogCanvas.height;

    fogCtx.clearRect(0, 0, W, H);
    fogCtx.fillStyle = this.theme.fog;
    fogCtx.fillRect(0, 0, W, H);

    // Вырезаем зоны видимости обоих игроков
    fogCtx.globalCompositeOperation = 'destination-out';

    for (const [, player] of Object.entries(state.players)) {
      if (player.escaped) continue;
      const sx = player.vx - camX;
      const sy = player.vy - camY;

      const grd = fogCtx.createRadialGradient(sx, sy, 0, sx, sy, VISIBILITY);
      grd.addColorStop(0,   'rgba(0,0,0,1)');
      grd.addColorStop(0.75,'rgba(0,0,0,0.9)');
      grd.addColorStop(1,   'rgba(0,0,0,0)');
      fogCtx.fillStyle = grd;
      fogCtx.fillRect(0, 0, W, H);
    }

    fogCtx.globalCompositeOperation = 'source-over';
    this.ctx.drawImage(fogCanvas, 0, 0);
  }

  drawMinimap(state, myId) {
    const { mmCtx, minimapCanvas } = this;
    const { mazeWidth: mw, mazeHeight: mh, maze, exit, players, maniac } = state;
    const MW = minimapCanvas.width;
    const MH = minimapCanvas.height;
    const cw = MW / mw;
    const ch = MH / mh;

    mmCtx.clearRect(0, 0, MW, MH);
    mmCtx.fillStyle = 'rgba(10,10,20,0.9)';
    mmCtx.fillRect(0, 0, MW, MH);

    // Стены
    mmCtx.fillStyle = '#2a2a4a';
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const cell = maze[y][x];
        if (cell.n) mmCtx.fillRect(x * cw, y * ch, cw, 1);
        if (cell.w) mmCtx.fillRect(x * cw, y * ch, 1, ch);
        if (y === mh-1 && cell.s) mmCtx.fillRect(x * cw, (y+1)*ch-1, cw, 1);
        if (x === mw-1 && cell.e) mmCtx.fillRect((x+1)*cw-1, y*ch, 1, ch);
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
      mmCtx.arc(p.x * cw + cw/2, p.y * ch + ch/2, Math.max(2, cw * 0.45), 0, Math.PI * 2);
      mmCtx.fillStyle = colors[p.index];
      mmCtx.fill();
    }

    // Маньяк
    mmCtx.beginPath();
    mmCtx.arc(maniac.x * cw + cw/2, maniac.y * ch + ch/2, Math.max(2, cw * 0.45), 0, Math.PI * 2);
    mmCtx.fillStyle = C.maniac;
    mmCtx.fill();
  }
}

export { CELL };
