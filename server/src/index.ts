import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server, type Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../../shared/protocol.js';
import { RoomRegistry, type Room } from './rooms.js';

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);

const registry = new RoomRegistry();
// socket.id → room code, for disconnect handling
const socketRoom = new Map<string, string>();

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

function broadcastRoomState(room: Room): void {
  io.to(room.code).emit('room_state', registry.statePayload(room));
}

function leaveRoom(socket: GameSocket): void {
  const code = socketRoom.get(socket.id);
  if (!code) return;
  socketRoom.delete(socket.id);
  const room = registry.get(code);
  if (!room) return;
  registry.removePlayer(room, socket.id);
  socket.leave(code);
  broadcastRoomState(room);
}

io.on('connection', (socket: GameSocket) => {
  socket.on('create_room', (ack) => {
    leaveRoom(socket); // a socket can only be in one room
    const room = registry.createRoom();
    registry.addPlayer(room, socket.id);
    socketRoom.set(socket.id, room.code);
    socket.join(room.code);
    ack({ code: room.code });
    broadcastRoomState(room);
  });

  socket.on('join_room', ({ code }, ack) => {
    const room = registry.get(code ?? '');
    if (!room) {
      ack({ ok: false, error: { code: 'ROOM_NOT_FOUND', message: 'No room with that code.' } });
      return;
    }
    if (room.players.length >= 2) {
      ack({ ok: false, error: { code: 'ROOM_FULL', message: 'That room already has two players.' } });
      return;
    }
    leaveRoom(socket);
    registry.addPlayer(room, socket.id);
    socketRoom.set(socket.id, room.code);
    socket.join(room.code);
    ack({ ok: true });
    broadcastRoomState(room);
  });

  socket.on('leave_room', () => leaveRoom(socket));

  socket.on('disconnect', () => leaveRoom(socket));
});

// Sweep idle rooms every minute (PRD §8 teardown)
setInterval(() => {
  const removed = registry.sweep();
  if (removed.length > 0) {
    console.log(`[rooms] swept ${removed.length} idle room(s): ${removed.join(', ')}`);
  }
}, 60_000);

// ---------- HTTP ----------

app.get('/healthz', (_req, res) => {
  res.json({ ok: true, rooms: registry.size });
});

// Serve the built client (production). In dev, Vite serves the client instead.
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(here, '../client');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const port = Number(process.env.PORT) || 3001;
httpServer.listen(port, () => {
  console.log(`[wallflower] listening on :${port}`);
});
