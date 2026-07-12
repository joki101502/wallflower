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
  hit: boolean;
}

export type Phase = 'intro' | 'orient' | 'shoot' | 'result';

export type Heat = 1 | 2;

/** Sudden-death context for a session (null during normal heats). */
export interface SdInfo {
  round: number;
  half: 1 | 2;
  /** Second half only: did the first shooter hit this round? */
  firstHalfHit: boolean | null;
}

export interface ShotResult {
  x: number;
  y: number;
  hit: boolean;
  part: PartName | null;
  isHeadshot: boolean;
  hitCount: number; // accumulated body hits this session
  shotsLeft: number;
  killed: boolean;
}

export interface MatchEndPayload {
  youWin: boolean;
  yourTurns: number | null;
  oppTurns: number | null;
  suddenDeath: boolean;
  forfeit: boolean;
}

export interface SnapshotPayload {
  youAre: Role;
  heat: Heat;
  turn: number;
  phase: Phase;
  endsAt: number;
  holes: Hole[];
  hitCount: number;
  shotsLeft: number;
  sd: SdInfo | null;
  paused: boolean;
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
  /** A new shooter session begins (heat 1, heat 2, or a sudden-death half). */
  session_start: (payload: { youAre: Role; heat: Heat; sd: SdInfo | null }) => void;
  phase_change: (payload: { phase: Phase; turn: number; endsAt: number }) => void;
  pose_broadcast: (payload: { pose: Pose }) => void;
  shot_result: (payload: ShotResult) => void;
  /** A heat session ended (the hider was killed). */
  session_end: (payload: { turnsUsed: number; byHeadshot: boolean }) => void;
  /** A sudden-death half concluded. */
  sd_half_end: (payload: { round: number; half: 1 | 2; hit: boolean }) => void;
  match_end: (payload: MatchEndPayload) => void;
  opponent_disconnected: (payload: { graceEndsAt: number }) => void;
  opponent_reconnected: () => void;
  /** Full state resync after a reconnect. */
  game_snapshot: (payload: SnapshotPayload) => void;
  rematch_state: (payload: { votes: number }) => void;
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
export const SHOOT_PHASE_MS = 20_000;
export const SHOTS_PER_TURN = 3;
export const BODY_HITS_TO_KILL = 3;
export const DISCONNECT_GRACE_MS = 45_000;
export const POSE_RATE_HZ = 15;

export const SESSION_INTRO_MS = 2_500;
export const RESULT_PHASE_MS = 2_000;
export const INTERSTITIAL_MS = 3_000;
