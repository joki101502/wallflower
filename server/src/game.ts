// Wallflower — server-authoritative match engine (PRD §4, §5).
// One instance per room once two players are present. Owns all timers, phase
// transitions, hit adjudication, heat/sudden-death scoring, and forfeits.

import {
  BODY_HITS_TO_KILL,
  DISCONNECT_GRACE_MS,
  INTERSTITIAL_MS,
  ORIENT_PHASE_MS,
  RESULT_PHASE_MS,
  SESSION_INTRO_MS,
  SHOOT_PHASE_MS,
  SHOTS_PER_TURN,
  type Heat,
  type Hole,
  type MatchEndPayload,
  type Phase,
  type Pose,
  type SdInfo,
  type ServerToClientEvents,
} from '../../shared/protocol.js';
import { WALL_H, WALL_W, defaultPose, hitTest } from '../../shared/body.js';

export type EmitFn = <E extends keyof ServerToClientEvents>(
  target: string | 'all',
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
) => void;

export interface EngineDeps {
  players: [string, string];
  emit: EmitFn;
  touch: () => void;
  /** Called when the match is over and the engine should be torn down by the host. */
  onGameOver: (reason: 'complete' | 'forfeit') => void;
}

export class GameEngine {
  private shooter: string;
  private hider: string;
  private heat: Heat = 1;
  private turn = 0;
  private phase: Phase = 'intro';
  private shotsLeft = SHOTS_PER_TURN;
  private hitCount = 0;
  private holes: Hole[] = [];
  private latestPose: Pose = defaultPose();
  private turnsUsed = new Map<string, number>();
  private sd: SdInfo | null = null;
  private sdFirstShooter: string | null = null;
  private ended = false;
  private lastMatchEnd = new Map<string, MatchEndPayload>();
  private rematchVotes = new Set<string>();

  private timer: ReturnType<typeof setTimeout> | null = null;
  private nextFn: (() => void) | null = null;
  private endsAt = 0;
  private pausedRemaining: number | null = null;
  private disconnected = new Set<string>();
  private graceTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private deps: EngineDeps) {
    // Coin toss: who shoots first (PRD §4.7).
    const first = Math.random() < 0.5 ? 0 : 1;
    this.shooter = deps.players[first];
    this.hider = deps.players[1 - first];
  }

  start(): void {
    this.startSession();
  }

  destroy(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.nextFn = null;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  // ---------- Timers (pause/resume-aware) ----------

  private schedule(ms: number, fn: () => void): void {
    if (this.timer) clearTimeout(this.timer);
    this.endsAt = Date.now() + ms;
    this.nextFn = fn;
    this.timer = setTimeout(() => {
      this.nextFn = null;
      fn();
    }, ms);
    this.deps.touch();
  }

  private pause(): void {
    if (this.pausedRemaining !== null || !this.nextFn) return;
    this.pausedRemaining = Math.max(0, this.endsAt - Date.now());
    if (this.timer) clearTimeout(this.timer);
  }

  private resume(): void {
    if (this.pausedRemaining === null || !this.nextFn) return;
    const fn = this.nextFn;
    const ms = this.pausedRemaining;
    this.pausedRemaining = null;
    this.schedule(ms, fn);
  }

  private get isPaused(): boolean {
    return this.pausedRemaining !== null;
  }

  // ---------- Session / turn flow ----------

  private startSession(): void {
    this.turn = 0;
    this.hitCount = 0;
    this.holes = [];
    this.latestPose = defaultPose();
    this.phase = 'intro';
    this.deps.emit(this.shooter, 'session_start', { youAre: 'shooter', heat: this.heat, sd: this.sd });
    this.deps.emit(this.hider, 'session_start', { youAre: 'hider', heat: this.heat, sd: this.sd });
    this.schedule(SESSION_INTRO_MS, () => this.startOrient());
  }

  private startOrient(): void {
    this.turn += 1;
    this.phase = 'orient';
    this.deps.emit('all', 'phase_change', { phase: 'orient', turn: this.turn, endsAt: Date.now() + ORIENT_PHASE_MS });
    this.schedule(ORIENT_PHASE_MS, () => this.startShoot());
  }

  private startShoot(): void {
    this.phase = 'shoot';
    this.shotsLeft = SHOTS_PER_TURN;
    this.deps.emit('all', 'phase_change', { phase: 'shoot', turn: this.turn, endsAt: Date.now() + SHOOT_PHASE_MS });
    this.schedule(SHOOT_PHASE_MS, () => this.endShoot());
  }

  /** Shoot phase over without a kill (time up or shots spent). */
  private endShoot(): void {
    if (this.sd) {
      this.endSdHalf(false);
      return;
    }
    this.phase = 'result';
    this.deps.emit('all', 'phase_change', { phase: 'result', turn: this.turn, endsAt: Date.now() + RESULT_PHASE_MS });
    this.schedule(RESULT_PHASE_MS, () => this.startOrient());
  }

  // ---------- Player input ----------

  poseUpdate(pid: string, pose: Pose): void {
    if (this.ended || pid !== this.hider) return;
    this.latestPose = pose;
    if (!this.disconnected.has(this.shooter)) {
      this.deps.emit(this.shooter, 'pose_broadcast', { pose });
    }
  }

  fireShot(pid: string, x: number, y: number): void {
    if (this.ended || this.isPaused) return;
    if (pid !== this.shooter || this.phase !== 'shoot' || this.shotsLeft <= 0) return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > WALL_W || y < 0 || y > WALL_H) return;

    this.shotsLeft -= 1;
    const part = hitTest(this.latestPose, x, y);
    const hit = part !== null;
    const isHeadshot = part === 'head';
    if (hit && !this.sd) this.hitCount += 1;
    const killed = !this.sd && (isHeadshot || this.hitCount >= BODY_HITS_TO_KILL);

    this.holes.push({ x, y, hit });
    this.deps.emit('all', 'shot_result', {
      x,
      y,
      hit,
      part,
      isHeadshot,
      hitCount: this.hitCount,
      shotsLeft: this.shotsLeft,
      killed,
    });
    this.deps.touch();

    if (this.sd) {
      // Sudden death: any hit decides the half immediately.
      if (hit) this.endSdHalf(true);
      else if (this.shotsLeft === 0) this.endSdHalf(false);
    } else if (killed) {
      this.endSession(isHeadshot);
    } else if (this.shotsLeft === 0) {
      this.endShoot();
    }
  }

  rematch(pid: string): void {
    if (!this.ended || !this.deps.players.includes(pid)) return;
    this.rematchVotes.add(pid);
    this.deps.emit('all', 'rematch_state', { votes: this.rematchVotes.size });
    if (this.rematchVotes.size === 2) {
      this.resetMatch();
    }
  }

  // ---------- Heat / match resolution ----------

  private endSession(byHeadshot: boolean): void {
    this.turnsUsed.set(this.shooter, this.turn);
    this.phase = 'result';
    this.deps.emit('all', 'session_end', { turnsUsed: this.turn, byHeadshot });
    this.schedule(INTERSTITIAL_MS, () => {
      if (this.heat === 1) {
        this.heat = 2;
        this.swapRoles();
        this.startSession();
      } else {
        this.resolveMatch();
      }
    });
  }

  private resolveMatch(): void {
    const [a, b] = this.deps.players;
    const ta = this.turnsUsed.get(a)!;
    const tb = this.turnsUsed.get(b)!;
    if (ta === tb) {
      this.startSuddenDeath();
    } else {
      this.endMatch(ta < tb ? a : b, { suddenDeath: false, forfeit: false });
    }
  }

  private startSuddenDeath(): void {
    // Fresh coin toss for sudden-death order (PRD §4.7).
    const first = Math.random() < 0.5 ? 0 : 1;
    this.sdFirstShooter = this.deps.players[first];
    this.shooter = this.sdFirstShooter;
    this.hider = this.deps.players[1 - first];
    this.sd = { round: 1, half: 1, firstHalfHit: null };
    this.startSession();
  }

  private endSdHalf(hit: boolean): void {
    const sd = this.sd!;
    this.phase = 'result';
    this.deps.emit('all', 'sd_half_end', { round: sd.round, half: sd.half, hit });
    this.schedule(INTERSTITIAL_MS, () => {
      if (sd.half === 1) {
        this.sd = { round: sd.round, half: 2, firstHalfHit: hit };
        this.swapRoles();
        this.startSession();
      } else {
        const firstHit = sd.firstHalfHit!;
        if (firstHit !== hit) {
          // Exactly one player hit this round — decisive.
          const winner = firstHit ? this.sdFirstShooter! : this.otherOf(this.sdFirstShooter!);
          this.endMatch(winner, { suddenDeath: true, forfeit: false });
        } else {
          // Both hit or both missed — next round, same order.
          this.sd = { round: sd.round + 1, half: 1, firstHalfHit: null };
          this.shooter = this.sdFirstShooter!;
          this.hider = this.otherOf(this.sdFirstShooter!);
          this.startSession();
        }
      }
    });
  }

  private endMatch(winner: string, opts: { suddenDeath: boolean; forfeit: boolean }): void {
    this.ended = true;
    if (this.timer) clearTimeout(this.timer);
    this.nextFn = null;
    this.pausedRemaining = null;
    for (const pid of this.deps.players) {
      const opp = this.otherOf(pid);
      const payload: MatchEndPayload = {
        youWin: pid === winner,
        yourTurns: this.turnsUsed.get(pid) ?? null,
        oppTurns: this.turnsUsed.get(opp) ?? null,
        suddenDeath: opts.suddenDeath,
        forfeit: opts.forfeit,
      };
      this.lastMatchEnd.set(pid, payload);
      this.deps.emit(pid, 'match_end', payload);
    }
    this.deps.onGameOver(opts.forfeit ? 'forfeit' : 'complete');
  }

  private resetMatch(): void {
    this.ended = false;
    this.rematchVotes.clear();
    this.lastMatchEnd.clear();
    this.turnsUsed.clear();
    this.sd = null;
    this.sdFirstShooter = null;
    this.heat = 1;
    const first = Math.random() < 0.5 ? 0 : 1;
    this.shooter = this.deps.players[first];
    this.hider = this.deps.players[1 - first];
    this.startSession();
  }

  // ---------- Disconnect / reconnect (PRD §8: 45s grace, then forfeit) ----------

  playerDisconnected(pid: string): void {
    if (!this.deps.players.includes(pid)) return;
    this.disconnected.add(pid);
    if (this.ended) return;
    this.pause();
    const graceEndsAt = Date.now() + DISCONNECT_GRACE_MS;
    this.deps.emit(this.otherOf(pid), 'opponent_disconnected', { graceEndsAt });
    this.graceTimers.set(
      pid,
      setTimeout(() => this.forfeit(pid), DISCONNECT_GRACE_MS)
    );
  }

  playerReconnected(pid: string): void {
    if (!this.disconnected.has(pid)) return;
    this.disconnected.delete(pid);
    const grace = this.graceTimers.get(pid);
    if (grace) clearTimeout(grace);
    this.graceTimers.delete(pid);
    this.deps.emit(this.otherOf(pid), 'opponent_reconnected');
    if (this.ended) {
      const last = this.lastMatchEnd.get(pid);
      if (last) this.deps.emit(pid, 'match_end', last);
      this.deps.emit(pid, 'rematch_state', { votes: this.rematchVotes.size });
      return;
    }
    if (this.disconnected.size === 0) this.resume();
    // Resync both players (endsAt changed on resume).
    for (const p of this.deps.players) this.sendSnapshot(p);
  }

  /** Immediate forfeit (player left the room on purpose, or grace expired). */
  forfeit(loser: string): void {
    if (this.ended) return;
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
    this.endMatch(this.otherOf(loser), { suddenDeath: false, forfeit: true });
  }

  private sendSnapshot(pid: string): void {
    // The pose stream only flows on hider movement; a freshly reconnected
    // shooter needs the current pose pushed or the peepholes stay empty.
    if (pid === this.shooter) {
      this.deps.emit(pid, 'pose_broadcast', { pose: this.latestPose });
    }
    this.deps.emit(pid, 'game_snapshot', {
      youAre: pid === this.shooter ? 'shooter' : 'hider',
      heat: this.heat,
      turn: this.turn,
      phase: this.phase,
      endsAt: this.isPaused ? Date.now() + (this.pausedRemaining ?? 0) : this.endsAt,
      holes: this.holes,
      hitCount: this.hitCount,
      shotsLeft: this.shotsLeft,
      sd: this.sd,
      paused: this.isPaused,
    });
  }

  // ---------- Helpers ----------

  private swapRoles(): void {
    [this.shooter, this.hider] = [this.hider, this.shooter];
  }

  private otherOf(pid: string): string {
    const [a, b] = this.deps.players;
    return pid === a ? b : a;
  }
}
