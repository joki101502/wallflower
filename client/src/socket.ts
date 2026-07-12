import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '../../shared/protocol';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// Same-origin in production; Vite dev server proxies /socket.io to the backend.
export const socket: GameSocket = io();
