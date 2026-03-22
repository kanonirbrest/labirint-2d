import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { GameRoom } from './GameRoom.js';

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

// roomCode -> GameRoom
const rooms = new Map();
// socketId -> roomCode
const socketRooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function cleanupRoom(roomCode) {
  const room = rooms.get(roomCode);
  if (room && room.isEmpty()) {
    room.destroy();
    rooms.delete(roomCode);
  }
}

io.on('connection', (socket) => {
  console.log(`[+] connected: ${socket.id}`);

  socket.on('createRoom', ({ username, difficulty }) => {
    let roomCode;
    do { roomCode = generateRoomCode(); } while (rooms.has(roomCode));

    const room = new GameRoom(roomCode, io, difficulty || 'medium');
    rooms.set(roomCode, room);

    socket.join(roomCode);
    socketRooms.set(socket.id, roomCode);
    room.addPlayer(socket, username || 'Игрок 1');

    socket.emit('roomCreated', { roomCode });
  });

  socket.on('joinRoom', ({ roomCode, username }) => {
    const code = roomCode.toUpperCase().trim();
    const room = rooms.get(code);

    if (!room) {
      socket.emit('joinError', { message: 'Комната не найдена' });
      return;
    }
    if (room.isFull()) {
      socket.emit('joinError', { message: 'Комната заполнена' });
      return;
    }

    socket.join(code);
    socketRooms.set(socket.id, code);
    room.addPlayer(socket, username || 'Игрок 2');
  });

  socket.on('move', ({ direction }) => {
    const roomCode = socketRooms.get(socket.id);
    const room = rooms.get(roomCode);
    if (room) room.handleMove(socket.id, direction);
  });

  socket.on('makeNoise', () => {
    const roomCode = socketRooms.get(socket.id);
    const room = rooms.get(roomCode);
    if (room) room.handleNoise(socket.id);
  });

  socket.on('restartRequest', () => {
    const roomCode = socketRooms.get(socket.id);
    const room = rooms.get(roomCode);
    if (room) room.handleRestartVote(socket.id);
  });

  socket.on('disconnect', () => {
    console.log(`[-] disconnected: ${socket.id}`);
    const roomCode = socketRooms.get(socket.id);
    if (roomCode) {
      const room = rooms.get(roomCode);
      if (room) {
        room.removePlayer(socket.id);
        cleanupRoom(roomCode);
      }
      socketRooms.delete(socket.id);
    }
  });
});

app.get('/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
});
