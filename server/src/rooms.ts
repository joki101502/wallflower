import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type RoomStatePayload,
} from '../../shared/protocol.js';

export interface RoomPlayer {
  id: string; // stable player id (socket id for now)
  connected: boolean;
}

export interface Room {
  code: string;
  players: RoomPlayer[];
  status: 'waiting' | 'playing';
  createdAt: number;
  lastActivityAt: number;
}

const ROOM_IDLE_TTL_MS = 10 * 60 * 1000; // teardown after 10 min idle (PRD §8)

export class RoomRegistry {
  private rooms = new Map<string, Room>();

  createRoom(): Room {
    let code: string;
    do {
      code = generateCode();
    } while (this.rooms.has(code));

    const room: Room = {
      code,
      players: [],
      status: 'waiting',
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  addPlayer(room: Room, playerId: string): 'ok' | 'full' {
    if (room.players.length >= 2) return 'full';
    room.players.push({ id: playerId, connected: true });
    room.lastActivityAt = Date.now();
    return 'ok';
  }

  removePlayer(room: Room, playerId: string): void {
    room.players = room.players.filter((p) => p.id !== playerId);
    room.lastActivityAt = Date.now();
    if (room.players.length === 0) {
      this.rooms.delete(room.code);
    }
  }

  touch(room: Room): void {
    room.lastActivityAt = Date.now();
  }

  statePayload(room: Room): RoomStatePayload {
    return {
      code: room.code,
      players: room.players.map((p) => ({ id: p.id, connected: p.connected })),
      status: room.status,
    };
  }

  /** Remove rooms idle past TTL. Returns removed codes. */
  sweep(now = Date.now()): string[] {
    const removed: string[] = [];
    for (const [code, room] of this.rooms) {
      if (now - room.lastActivityAt > ROOM_IDLE_TTL_MS) {
        this.rooms.delete(code);
        removed.push(code);
      }
    }
    return removed;
  }

  get size(): number {
    return this.rooms.size;
  }
}

function generateCode(): string {
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
  }
  return code;
}
