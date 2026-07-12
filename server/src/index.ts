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
import { GameEngine, type EmitFn } from './game.js';

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);

const registry = new RoomRegistry();
const games = new Map<string, GameEngine>(); // room code → engine
const socketOf = new Map<string, string>(); // playerId → socket.id

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

function playerIdOf(socket: GameSocket): string {
  const raw = socket.handshake.auth?.playerId;
  if (typeof raw === 'string' && raw.length > 0 && raw.length <= 64) return raw;
  return socket.id;
}

function broadcastRoomState(room: Room): void {
  io.to(room.code).emit('room_state', registry.statePayload(room));
}

function makeEmit(room: Room): EmitFn {
  return (target, event, ...args) => {
    if (target === 'all') {
      io.to(room.code).emit(event, ...args);
    } else {
      const sid = socketOf.get(target);
      if (sid) io.to(sid).emit(event, ...args);
    }
  };
}

function startGame(room: Room): void {
  room.status = 'playing';
  broadcastRoomState(room);
  const players = [room.players[0].id, room.players[1].id] as [string, string];
  const engine = new GameEngine({
    players,
    emit: makeEmit(room),
    touch: () => registry.touch(room),
    onGameOver: () => {
      // Engine stays alive for rematch votes; forfeit cleanup happens in
      // removeFromRoom when the loser's membership is dropped.
    },
  });
  games.set(room.code, engine);
  engine.start();
}

function destroyGame(code: string): void {
  const game = games.get(code);
  if (game) {
    game.destroy();
    games.delete(code);
  }
}

/** Player intentionally leaves (or is dropped after grace/forfeit). */
function removeFromRoom(pid: string): void {
  const room = registry.roomOfPlayer(pid);
  if (!room) return;
  const game = games.get(room.code);
  if (game && !game.isEnded) {
    game.forfeit(pid); // emits match_end to both
  }
  destroyGame(room.code);
  registry.removePlayer(room, pid);
  const sid = socketOf.get(pid);
  if (sid) io.sockets.sockets.get(sid)?.leave(room.code);
  if (room.players.length > 0) broadcastRoomState(room);
}

io.on('connection', (socket: GameSocket) => {
  const pid = playerIdOf(socket);

  // Same player opening a second connection replaces the first.
  const prevSid = socketOf.get(pid);
  if (prevSid && prevSid !== socket.id) {
    io.sockets.sockets.get(prevSid)?.disconnect(true);
  }
  socketOf.set(pid, socket.id);

  // Reconnect: if this player already belongs to a room, rejoin it.
  const existing = registry.roomOfPlayer(pid);
  if (existing) {
    socket.join(existing.code);
    registry.setConnected(existing, pid, true);
    broadcastRoomState(existing);
    games.get(existing.code)?.playerReconnected(pid);
  }

  socket.on('create_room', (ack) => {
    if (typeof ack !== 'function') return;
    removeFromRoom(pid);
    const room = registry.createRoom();
    registry.addPlayer(room, pid);
    socket.join(room.code);
    ack({ code: room.code });
    broadcastRoomState(room);
  });

  socket.on('join_room', ({ code }, ack) => {
    if (typeof ack !== 'function') return;
    const room = registry.get(code ?? '');
    if (!room) {
      ack({ ok: false, error: { code: 'ROOM_NOT_FOUND', message: 'No room with that code.' } });
      return;
    }
    if (room.players.length >= 2) {
      ack({ ok: false, error: { code: 'ROOM_FULL', message: 'That room already has two players.' } });
      return;
    }
    removeFromRoom(pid);
    registry.addPlayer(room, pid);
    socket.join(room.code);
    ack({ ok: true });
    broadcastRoomState(room);
    if (room.players.length === 2) startGame(room);
  });

  socket.on('leave_room', () => removeFromRoom(pid));

  socket.on('pose_update', (payload) => {
    const room = registry.roomOfPlayer(pid);
    if (!room || !payload?.pose) return;
    games.get(room.code)?.poseUpdate(pid, payload.pose);
  });

  socket.on('fire_shot', (payload) => {
    const room = registry.roomOfPlayer(pid);
    if (!room || !payload) return;
    games.get(room.code)?.fireShot(pid, payload.x, payload.y);
  });

  socket.on('rematch', () => {
    const room = registry.roomOfPlayer(pid);
    if (!room) return;
    games.get(room.code)?.rematch(pid);
  });

  socket.on('disconnect', () => {
    if (socketOf.get(pid) !== socket.id) return; // replaced by a newer connection
    socketOf.delete(pid);
    const room = registry.roomOfPlayer(pid);
    if (!room) return;
    const game = games.get(room.code);
    if (game) {
      // Mid-match (or post-match awaiting rematch): keep membership so the
      // player can reconnect; the engine's 45s grace timer handles forfeit.
      registry.setConnected(room, pid, false);
      broadcastRoomState(room);
      if (!game.isEnded) {
        game.playerDisconnected(pid);
        // Grace expiry → engine forfeits → drop membership.
        setTimeout(() => {
          if (!socketOf.has(pid) && registry.roomOfPlayer(pid) === room && game.isEnded) {
            removeFromRoom(pid);
          }
        }, 46_000);
      } else {
        removeFromRoom(pid);
      }
    } else {
      removeFromRoom(pid);
    }
  });
});

// Sweep idle rooms every minute (PRD §8 teardown)
setInterval(() => {
  const removed = registry.sweep();
  for (const room of removed) destroyGame(room.code);
  if (removed.length > 0) {
    console.log(`[rooms] swept ${removed.length} idle room(s): ${removed.map((r) => r.code).join(', ')}`);
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
