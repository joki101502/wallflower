import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../../shared/protocol';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Per-tab identity: survives a refresh (reconnect into the same match) but two
// tabs in the same browser stay distinct players (unlike localStorage).
function playerId(): string {
  const KEY = 'wf-player-id';
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `p-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

// Same-origin in production; Vite dev server proxies /socket.io to the backend.
export const socket: GameSocket = io({ auth: { playerId: playerId() } });
