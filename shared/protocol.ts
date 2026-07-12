// Wallflower — shared client/server protocol (PRD §7.5)
// Single source of truth for Socket.IO event contracts.

// ---------- Core domain types ----------

export type Role = 'shooter' | 'hider';

export type PartName =
  | 'head'
  | 'torso'
  | 'upperArmL'
  | 'lowerArmL'
  | 'upperArmR'
  | 'lowerArmR'
  | 'upperLegL'
  | 'lowerLegL'
  | 'upperLegR'
  | 'lowerLegR';

export interface PartTransform {
  x: number;
  y: number;
  angle: number;
}

export type Pose = Record<PartName, PartTransform>;

export interface Hole {
  x: number;
  y: number;
  r: number;
}

export type Phase = 'orient' | 'shoot' | 'result';

export interface ShotResult {
  x: number;
  y: number;
  hit: boolean;
  part: PartName | null;
  isHeadshot: boolean;
  hitCount: number; // accumulated body hits this session
  killed: boolean;
  shotsRemaining: number;
}

// ---------- Error codes ----------

export type ErrorCode =
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'NOT_IN_ROOM'
  | 'INVALID_ACTION'
  | 'INTERNAL';

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
}

// ---------- Client → Server ----------

export interface ClientToServerEvents {
  create_room: (ack: (res: { code: string }) => void) => void;
  join_room: (
    payload: { code: string },
    ack: (res: { ok: true } | { ok: false; error: ErrorPayload }) => void
  ) => void;
  leave_room: () => void;
  pose_update: (payload: { pose: Pose }) => void;
  fire_shot: (payload: { x: number; y: number }) => void;
  rematch: () => void;
}

// ---------- Server → Client ----------

export interface ServerToClientEvents {
  room_state: (payload: RoomStatePayload) => void;
  match_start: (payload: { youAre: Role; firstShooter: Role }) => void;
  phase_change: (payload: { phase: Phase; turn: number; endsAt: number }) => void;
  pose_broadcast: (payload: { pose: Pose }) => void;
  shot_result: (payload: ShotResult) => void;
  session_end: (payload: { turnsUsed: number }) => void;
  role_swap: (payload: { youAre: Role; heat: 1 | 2 }) => void;
  sudden_death_start: (payload: { firstShooter: Role }) => void;
  match_end: (payload: {
    winnerId: string;
    turnsA: number;
    turnsB: number;
    suddenDeath: boolean;
  }) => void;
  opponent_disconnected: (payload: { graceEndsAt: number }) => void;
  opponent_reconnected: () => void;
  error: (payload: ErrorPayload) => void;
}

// ---------- Room state snapshot (lobby/waiting) ----------

export interface RoomStatePayload {
  code: string;
  players: { id: string; connected: boolean }[];
  status: 'waiting' | 'playing';
}

// ---------- Shared constants ----------

export const ROOM_CODE_LENGTH = 6;
// Unambiguous alphabet: no O/0, no I/1
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const ORIENT_PHASE_MS = 10_000;
export const SHOOT_PHASE_MS = 10_000;
export const SHOTS_PER_TURN = 3;
export const BODY_HITS_TO_KILL = 3;
export const DISCONNECT_GRACE_MS = 45_000;
export const POSE_RATE_HZ = 15;
