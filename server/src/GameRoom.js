import { generateMaze, findPath, distance } from './MazeGenerator.js';

const MAZE_W = 15;
const MAZE_H = 15;
const TICK_MS = 100;
const MANIAC_MOVE_TICKS = 2;       // маньяк двигается каждые 200мс
const PLAYER_MOVE_COOLDOWN = 280;  // мс между шагами игрока
const NOISE_RADIUS = 7;            // радиус слуха маньяка в клетках
const NOISE_COOLDOWN = 4000;       // мс перезарядка шума у игрока
const CHASE_DURATION = 9000;       // мс погони после услышанного шума
const RESTART_TIMEOUT = 10000;     // мс ожидания второго голоса за рестарт

export class GameRoom {
  constructor(roomCode, io) {
    this.roomCode = roomCode;
    this.io = io;
    this.players = new Map(); // socketId -> playerData
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
    const spawns = [
      { x: 1, y: 1 },
      { x: MAZE_W - 2, y: MAZE_H - 2 },
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

  isEmpty() {
    return this.players.size === 0;
  }

  isFull() {
    return this.players.size >= 2;
  }

  destroy() {
    this.stopLoop();
    if (this.restartTimeoutId) clearTimeout(this.restartTimeoutId);
  }

  startGame() {
    this.maze = generateMaze(MAZE_W, MAZE_H);

    // Выход — правая сторона, середина
    this.exit = { x: MAZE_W - 1, y: Math.floor(MAZE_H / 2) };
    // Убираем восточную стену у выходной клетки
    this.maze[this.exit.y][this.exit.x].e = false;

    // Сброс позиций игроков
    const spawns = [{ x: 1, y: 1 }, { x: MAZE_W - 2, y: MAZE_H - 2 }];
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
      x: Math.floor(MAZE_W / 2),
      y: Math.floor(MAZE_H / 2),
      state: 'searching', // searching | chasing
      targetX: null,
      targetY: null,
      chaseExpiry: null,
    };

    this.gameState = 'playing';
    this.tickCount = 0;
    this.restartVotes.clear();

    const initData = {
      maze: this.maze,
      mazeWidth: MAZE_W,
      mazeHeight: MAZE_H,
      exit: this.exit,
      players: this.serializePlayers(),
      maniac: this.serializeManiac(),
      noiseRadius: NOISE_RADIUS,
      noiseCooldown: NOISE_COOLDOWN,
    };

    this.io.to(this.roomCode).emit('gameStart', initData);
    this.stopLoop();
    this.intervalId = setInterval(() => this.tick(), TICK_MS);
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

    if (this.tickCount % MANIAC_MOVE_TICKS === 0) {
      this.moveManiac();
    }

    // Проверка поимки
    for (const player of this.players.values()) {
      if (!player.escaped && player.x === this.maniac.x && player.y === this.maniac.y) {
        this.endGame(false);
        return;
      }
    }

    // Проверка победы
    const allEscaped = [...this.players.values()].every((p) => p.escaped);
    if (allEscaped) {
      this.endGame(true);
      return;
    }

    this.broadcastState();
  }

  moveManiac() {
    const now = Date.now();

    // Снять состояние погони если время истекло
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
        // Достиг цели — переходит в блуждание
        this.maniac.state = 'searching';
        this.maniac.targetX = null;
        this.maniac.targetY = null;
      }
    } else {
      this.wander();
    }
  }

  wander() {
    const { x, y } = this.maniac;
    const cell = this.maze[y][x];
    const dirs = [
      { dx: 0, dy: -1, wall: 'n' },
      { dx: 1, dy: 0, wall: 'e' },
      { dx: 0, dy: 1, wall: 's' },
      { dx: -1, dy: 0, wall: 'w' },
    ].filter(({ wall, dx, dy }) => {
      if (cell[wall]) return false;
      const nx = x + dx;
      const ny = y + dy;
      return nx >= 0 && nx < MAZE_W && ny >= 0 && ny < MAZE_H;
    });

    if (dirs.length > 0) {
      const chosen = dirs[Math.floor(Math.random() * dirs.length)];
      this.maniac.x += chosen.dx;
      this.maniac.y += chosen.dy;
    }
  }

  handleMove(socketId, direction) {
    if (this.gameState !== 'playing') return;
    const player = this.players.get(socketId);
    if (!player || player.escaped) return;

    const now = Date.now();
    if (now - player.lastMoveTime < PLAYER_MOVE_COOLDOWN) return;

    const deltas = {
      up:    { dx: 0, dy: -1, wall: 'n' },
      right: { dx: 1, dy: 0,  wall: 'e' },
      down:  { dx: 0, dy: 1,  wall: 's' },
      left:  { dx: -1, dy: 0, wall: 'w' },
    };

    const delta = deltas[direction];
    if (!delta) return;

    const cell = this.maze[player.y][player.x];
    if (cell[delta.wall]) return; // стена

    const nx = player.x + delta.dx;
    const ny = player.y + delta.dy;

    // Выход через правую стену выходной клетки
    if (nx >= MAZE_W && player.x === this.exit.x && player.y === this.exit.y) {
      player.escaped = true;
      player.lastMoveTime = now;
      this.io.to(this.roomCode).emit('playerEscaped', { playerId: socketId });
      return;
    }

    if (nx < 0 || nx >= MAZE_W || ny < 0 || ny >= MAZE_H) return;

    player.x = nx;
    player.y = ny;
    player.lastMoveTime = now;

    // Телеграф: мгновенное обновление позиции этого игрока
    this.io.to(this.roomCode).emit('playerMoved', {
      playerId: socketId,
      x: player.x,
      y: player.y,
    });
  }

  handleNoise(socketId) {
    if (this.gameState !== 'playing') return;
    const player = this.players.get(socketId);
    if (!player || player.escaped) return;

    const now = Date.now();
    if (now < player.noiseCooldownEnd) return;

    player.noiseCooldownEnd = now + NOISE_COOLDOWN;

    const dist = distance(player, this.maniac);
    const heard = dist <= NOISE_RADIUS;

    this.io.to(this.roomCode).emit('noiseEvent', {
      playerId: socketId,
      x: player.x,
      y: player.y,
      radius: NOISE_RADIUS,
      heard,
    });

    if (heard) {
      this.maniac.state = 'chasing';
      this.maniac.targetX = player.x;
      this.maniac.targetY = player.y;
      this.maniac.chaseExpiry = now + CHASE_DURATION;
    }
  }

  handleRestartVote(socketId) {
    if (this.gameState !== 'over' && this.gameState !== 'won' && this.gameState !== 'lost') return;
    this.restartVotes.add(socketId);

    if (this.restartVotes.size === 1) {
      this.io.to(this.roomCode).emit('restartVote', { count: 1, needed: 2 });
      // Если второй не проголосовал — сообщить об истечении
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
    return {
      x: this.maniac.x,
      y: this.maniac.y,
      state: this.maniac.state,
    };
  }
}
