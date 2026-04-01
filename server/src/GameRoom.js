import { generateMaze, findPath, distance } from './MazeGenerator.js';

const DIFFICULTY = {
  easy: {
    mazeW: 13, mazeH: 13,  // большой, но прямые коридоры — легко ориентироваться
    mazeStyle: 'easy',
    tickMs: 100,
    maniacMoveTicks: 4,    // 400ms — маньяк МЕДЛЕННЕЕ игрока
    playerMoveCooldown: 280,
    noiseRadius: 11,
    noiseCooldown: 2000,
    chaseDuration: 5000,
  },
  medium: {
    mazeW: 19, mazeH: 19,  // большой, стандартный DFS
    mazeStyle: 'normal',
    tickMs: 100,
    maniacMoveTicks: 2,    // 200ms — маньяк в 1.4× быстрее
    playerMoveCooldown: 280,
    noiseRadius: 10,
    noiseCooldown: 4000,
    chaseDuration: 9000,
  },
  hard: {
    mazeW: 27, mazeH: 27,  // огромный, запутанный + петли
    mazeStyle: 'hard',
    tickMs: 100,
    maniacMoveTicks: 1,    // 100ms — маньяк в 2.8× быстрее
    playerMoveCooldown: 280,
    noiseRadius: 8,
    noiseCooldown: 6000,
    chaseDuration: 14000,
  },
};

const RESTART_TIMEOUT = 10000;

export class GameRoom {
  constructor(roomCode, io, difficulty = 'medium') {
    this.roomCode = roomCode;
    this.io = io;
    this.difficulty = DIFFICULTY[difficulty] ? difficulty : 'medium';
    this.cfg = DIFFICULTY[this.difficulty];

    this.players = new Map();
    this.gameState = 'waiting';
    this.maze = null;
    this.exit = null;
    this.maniac = null;
    this.tickCount = 0;
    this.intervalId = null;
    this.restartVotes = new Set();
    this.restartTimeoutId = null;
  }

  addPlayer(socket, username) {
    const index = this.players.size;
    const { mazeW, mazeH } = this.cfg;
    // Оба игрока стартуют слева: один сверху, другой снизу — выход справа по центру
    const spawns = [
      { x: 1, y: 1 },
      { x: 1, y: mazeH - 2 },
    ];

    this.players.set(socket.id, {
      id: socket.id,
      username,
      index,
      x: spawns[index].x,
      y: spawns[index].y,
      lastMoveTime: 0,
      noiseCooldownEnd: 0,
      escaped: false,
    });

    if (this.players.size === 2) {
      this.startGame();
    } else {
      socket.emit('waiting', { playerIndex: index });
    }
  }

  removePlayer(socketId) {
    const wasPlaying = this.gameState === 'playing';
    this.players.delete(socketId);

    if (wasPlaying && this.players.size > 0) {
      this.io.to(this.roomCode).emit('partnerDisconnected');
      this.stopLoop();
      this.gameState = 'over';
    }
    if (this.players.size === 0) this.stopLoop();
  }

  isEmpty() { return this.players.size === 0; }
  isFull()  { return this.players.size >= 2; }

  destroy() {
    this.stopLoop();
    if (this.restartTimeoutId) clearTimeout(this.restartTimeoutId);
  }

  startGame() {
    const { mazeW, mazeH } = this.cfg;
    this.maze = generateMaze(mazeW, mazeH, this.cfg.mazeStyle || 'normal');

    this.exit = { x: mazeW - 1, y: Math.floor(mazeH / 2) };
    this.maze[this.exit.y][this.exit.x].e = false;

    const spawns = [{ x: 1, y: 1 }, { x: 1, y: mazeH - 2 }];
    let i = 0;
    for (const player of this.players.values()) {
      player.x = spawns[i].x;
      player.y = spawns[i].y;
      player.escaped = false;
      player.lastMoveTime = 0;
      player.noiseCooldownEnd = 0;
      i++;
    }

    this.maniac = {
      x: Math.floor(mazeW / 2),
      y: Math.floor(mazeH / 2),
      state: 'searching',
      targetX: null,
      targetY: null,
      chaseExpiry: null,
      confusedSteps: 0,       // сколько случайных шагов осталось
      lastConfusionCheck: 0,  // когда последний раз проверяли путаницу
    };

    this.gameState = 'playing';
    this.tickCount = 0;
    this.restartVotes.clear();

    this.io.to(this.roomCode).emit('gameStart', {
      maze: this.maze,
      mazeWidth: mazeW,
      mazeHeight: mazeH,
      exit: this.exit,
      players: this.serializePlayers(),
      maniac: this.serializeManiac(),
      noiseRadius: this.cfg.noiseRadius,
      noiseCooldown: this.cfg.noiseCooldown,
      difficulty: this.difficulty,
    });

    this.stopLoop();
    this.intervalId = setInterval(() => this.tick(), this.cfg.tickMs);
  }

  stopLoop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  tick() {
    if (this.gameState !== 'playing') return;
    this.tickCount++;

    if (this.tickCount % this.cfg.maniacMoveTicks === 0) {
      this.moveManiac();
    }

    for (const player of this.players.values()) {
      if (!player.escaped && player.x === this.maniac.x && player.y === this.maniac.y) {
        this.endGame(false);
        return;
      }
    }

    if ([...this.players.values()].every((p) => p.escaped)) {
      this.endGame(true);
      return;
    }

    this.broadcastState();
  }

  moveManiac() {
    const now = Date.now();
    const { mazeW, mazeH } = this.cfg;

    if (this.maniac.state === 'chasing' && this.maniac.chaseExpiry && now > this.maniac.chaseExpiry) {
      this.maniac.state = 'searching';
      this.maniac.targetX = null;
      this.maniac.targetY = null;
      this.maniac.chaseExpiry = null;
    }

    if (this.maniac.state === 'chasing' && this.maniac.targetX !== null) {
      const path = findPath(
        this.maze,
        { x: this.maniac.x, y: this.maniac.y },
        { x: this.maniac.targetX, y: this.maniac.targetY }
      );
      if (path && path.length > 1) {
        this.maniac.x = path[1].x;
        this.maniac.y = path[1].y;
      } else {
        this.maniac.state = 'searching';
        this.maniac.targetX = null;
        this.maniac.targetY = null;
      }
    } else {
      this.wander();
    }
  }

  wander() {
    const targets = [...this.players.values()].filter((p) => !p.escaped);
    if (targets.length === 0) return;

    // Если уже сбился — делаем случайный шаг
    if (this.maniac.confusedSteps > 0) {
      this._randomStep();
      this.maniac.confusedSteps--;
      return;
    }

    // BFS к ближайшему игроку
    let bestPath = null;
    let nearestPlayer = null;
    for (const player of targets) {
      const path = findPath(
        this.maze,
        { x: this.maniac.x, y: this.maniac.y },
        { x: player.x, y: player.y }
      );
      if (path && (!bestPath || path.length < bestPath.length)) {
        bestPath = path;
        nearestPlayer = player;
      }
    }

    // Раз в 2.5 секунды проверяем — не потерял ли маньяк след
    // Срабатывает только если ближайший игрок долго стоит на месте
    const now = Date.now();
    if (nearestPlayer && now - this.maniac.lastConfusionCheck > 2500) {
      this.maniac.lastConfusionCheck = now;
      const stillMs = now - nearestPlayer.lastMoveTime;
      if (stillMs > 4000) {
        // Шанс замешательства растёт с 0% до 28% за 20 секунд неподвижности
        const chance = Math.min(0.28, (stillMs - 4000) / 20000);
        if (Math.random() < chance) {
          // Маньяк теряет след на 3–6 случайных шагов
          this.maniac.confusedSteps = 3 + Math.floor(Math.random() * 4);
          this._randomStep();
          this.maniac.confusedSteps--;
          return;
        }
      }
    }

    if (bestPath && bestPath.length > 1) {
      this.maniac.x = bestPath[1].x;
      this.maniac.y = bestPath[1].y;
    }
  }

  _randomStep() {
    const { x, y } = this.maniac;
    const { mazeW, mazeH } = this.cfg;
    const cell = this.maze[y][x];
    const dirs = [
      { dx: 0, dy: -1, wall: 'n' },
      { dx: 1, dy:  0, wall: 'e' },
      { dx: 0, dy:  1, wall: 's' },
      { dx: -1, dy: 0, wall: 'w' },
    ].filter(({ wall, dx, dy }) => {
      if (cell[wall]) return false;
      const nx = x + dx, ny = y + dy;
      return nx >= 0 && nx < mazeW && ny >= 0 && ny < mazeH;
    });
    if (dirs.length > 0) {
      const d = dirs[Math.floor(Math.random() * dirs.length)];
      this.maniac.x += d.dx;
      this.maniac.y += d.dy;
    }
  }

  handleMove(socketId, direction) {
    if (this.gameState !== 'playing') return;
    const player = this.players.get(socketId);
    if (!player || player.escaped) return;

    const now = Date.now();
    if (now - player.lastMoveTime < this.cfg.playerMoveCooldown) return;

    const { mazeW, mazeH } = this.cfg;
    const deltas = {
      up:    { dx: 0,  dy: -1, wall: 'n' },
      right: { dx: 1,  dy: 0,  wall: 'e' },
      down:  { dx: 0,  dy: 1,  wall: 's' },
      left:  { dx: -1, dy: 0,  wall: 'w' },
    };

    const delta = deltas[direction];
    if (!delta) return;

    const cell = this.maze[player.y][player.x];
    if (cell[delta.wall]) return;

    const nx = player.x + delta.dx;
    const ny = player.y + delta.dy;

    if (nx >= mazeW && player.x === this.exit.x && player.y === this.exit.y) {
      player.escaped = true;
      player.lastMoveTime = now;
      this.io.to(this.roomCode).emit('playerEscaped', { playerId: socketId });
      return;
    }

    if (nx < 0 || nx >= mazeW || ny < 0 || ny >= mazeH) return;

    player.x = nx;
    player.y = ny;
    player.lastMoveTime = now;

    this.io.to(this.roomCode).emit('playerMoved', { playerId: socketId, x: player.x, y: player.y });
  }

  handleNoise(socketId) {
    if (this.gameState !== 'playing') return;
    const player = this.players.get(socketId);
    if (!player || player.escaped) return;

    const now = Date.now();
    if (now < player.noiseCooldownEnd) return;

    player.noiseCooldownEnd = now + this.cfg.noiseCooldown;

    const dist = distance(player, this.maniac);
    const heard = dist <= this.cfg.noiseRadius;

    this.io.to(this.roomCode).emit('noiseEvent', {
      playerId: socketId,
      x: player.x,
      y: player.y,
      radius: this.cfg.noiseRadius,
      heard,
    });

    if (heard) {
      this.maniac.state = 'chasing';
      this.maniac.targetX = player.x;
      this.maniac.targetY = player.y;
      this.maniac.chaseExpiry = now + this.cfg.chaseDuration;
    }
  }

  handleRestartVote(socketId) {
    if (!['over','won','lost'].includes(this.gameState)) return;
    this.restartVotes.add(socketId);

    if (this.restartVotes.size === 1) {
      this.io.to(this.roomCode).emit('restartVote', { count: 1, needed: 2 });
      this.restartTimeoutId = setTimeout(() => {
        this.restartVotes.clear();
        this.io.to(this.roomCode).emit('restartVote', { count: 0, needed: 2 });
      }, RESTART_TIMEOUT);
    }

    if (this.restartVotes.size >= 2) {
      if (this.restartTimeoutId) clearTimeout(this.restartTimeoutId);
      this.startGame();
    }
  }

  broadcastState() {
    this.io.to(this.roomCode).emit('stateUpdate', {
      players: this.serializePlayers(),
      maniac: this.serializeManiac(),
    });
  }

  endGame(won) {
    this.gameState = won ? 'won' : 'lost';
    this.stopLoop();
    this.io.to(this.roomCode).emit('gameOver', { won });
  }

  serializePlayers() {
    const obj = {};
    for (const [id, p] of this.players) {
      obj[id] = { x: p.x, y: p.y, username: p.username, index: p.index, escaped: p.escaped };
    }
    return obj;
  }

  serializeManiac() {
    return { x: this.maniac.x, y: this.maniac.y, state: this.maniac.state };
  }
}
