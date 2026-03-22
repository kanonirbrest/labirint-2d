import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

let socket = null;
const listeners = {};

export function connect(onConnected) {
  if (socket?.connected) {
    onConnected?.(socket.id);
    return;
  }

  socket = io(SERVER_URL, {
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
  });

  socket.on('connect', () => {
    onConnected?.(socket.id);
    emit('_connect', socket.id);
  });
  socket.on('disconnect', (reason) => emit('_disconnect', reason));
  socket.on('connect_error', (err) => emit('_error', err));

  const events = [
    'roomCreated', 'joinError', 'waiting', 'playerJoined',
    'gameStart', 'stateUpdate', 'playerMoved', 'noiseEvent',
    'playerEscaped', 'gameOver', 'partnerDisconnected',
    'restartVote',
  ];
  events.forEach((ev) => socket.on(ev, (data) => emit(ev, data)));
}

export function disconnect() {
  socket?.disconnect();
  socket = null;
}

export function getSocketId() {
  return socket?.id ?? null;
}

export function send(event, data) {
  socket?.emit(event, data);
}

export function on(event, fn) {
  if (!listeners[event]) listeners[event] = [];
  listeners[event].push(fn);
}

export function off(event, fn) {
  if (!listeners[event]) return;
  listeners[event] = listeners[event].filter((f) => f !== fn);
}

export function offAll() {
  Object.keys(listeners).forEach((k) => { listeners[k] = []; });
}

function emit(event, data) {
  (listeners[event] || []).forEach((fn) => fn(data));
}
