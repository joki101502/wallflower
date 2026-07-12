import { useEffect, useRef, useState } from 'react';
import { BODY_HITS_TO_KILL, SHOTS_PER_TURN } from '../../../shared/protocol';
import { Canvas } from '@react-three/fiber';
import type { GameState } from './useGame';
import { HiderScene } from './three/HiderScene';
import { ShooterScene } from './three/ShooterScene';
import type { Pose } from '../../../shared/protocol';

interface Props {
  state: GameState;
  fireShot: (x: number, y: number) => void;
  sendPose: (pose: Pose) => void;
  requestRematch: () => void;
  leaveRoom: () => void;
}

function useCountdown(endsAt: number): number {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 100);
    return () => clearInterval(t);
  }, []);
  return Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
}

const PHASE_LABEL: Record<string, { shooter: string; hider: string }> = {
  intro: { shooter: 'Get ready…', hider: 'Get ready…' },
  orient: { shooter: 'Opponent is repositioning', hider: 'ORIENT — get behind cover' },
  shoot: { shooter: 'FIRE — click the wall', hider: 'INCOMING — keep moving!' },
  result: { shooter: 'Turn over', hider: 'Turn over' },
};

export function GameView({ state, fireShot, sendPose, requestRematch, leaveRoom }: Props) {
  const seconds = useCountdown(state.endsAt);
  const graceSeconds = useCountdown(state.oppDisconnectedUntil ?? 0);

  // Session key: bump when a new session starts so HiderView resets its pose.
  const sessionKey = useRef(0);
  const prevSig = useRef('');
  const sig = `${state.heat}-${state.sd?.round ?? 0}-${state.sd?.half ?? 0}-${state.role}`;
  if (sig !== prevSig.current) {
    prevSig.current = sig;
    sessionKey.current += 1;
  }

  const isShooter = state.role === 'shooter';
  const canShoot = isShooter && state.phase === 'shoot' && state.shotsLeft > 0 && !state.paused && !state.matchEnd;

  const heatLabel = state.sd
    ? `SUDDEN DEATH — ROUND ${state.sd.round}`
    : `HEAT ${state.heat} OF 2`;

  return (
    <div className="game">
      <div className="hud">
        <div className="hud-left">
          <span className={`role-badge ${state.role ?? ''}`}>{isShooter ? '🔫 SHOOTER' : '🧍 HIDER'}</span>
          <span className="hud-dim">{heatLabel}</span>
          {!state.sd && <span className="hud-dim">Turn {Math.max(1, state.turn)}</span>}
        </div>
        <div className="hud-mid">
          <span className="phase-label">{state.role ? PHASE_LABEL[state.phase][state.role] : ''}</span>
          {(state.phase === 'orient' || state.phase === 'shoot') && (
            <span className={`timer ${seconds <= 3 ? 'urgent' : ''}`}>{seconds}</span>
          )}
        </div>
        <div className="hud-right">
          {isShooter && state.phase === 'shoot' && (
            <span className="shots">
              {Array.from({ length: SHOTS_PER_TURN }, (_, i) => (
                <span key={i} className={i < state.shotsLeft ? 'shot-full' : 'shot-used'}>▮</span>
              ))}
            </span>
          )}
          {!state.sd && (
            <span className="hits" title="Body hits on the hider">
              {Array.from({ length: BODY_HITS_TO_KILL }, (_, i) => (
                <span key={i} className={i < state.hitCount ? 'hit-full' : 'hit-empty'}>●</span>
              ))}
            </span>
          )}
        </div>
      </div>

      <div className="canvas-wrap">
        {/* ONE persistent Canvas for the whole match: swapping scenes inside it
            (instead of remounting the Canvas per role) keeps a single WebGL
            context alive — repeated context creation gets evicted by the
            browser and blacks out the view. */}
        <div className={`game-canvas ${canShoot ? 'aiming' : ''}`}>
          <Canvas camera={{ fov: 55, position: [0, 0, 5.4] }}>
            {isShooter ? (
              <ShooterScene holes={state.holes} oppPose={state.oppPose} canShoot={canShoot} fireShot={fireShot} />
            ) : (
              <HiderScene holes={state.holes} sendPose={sendPose} sessionKey={sessionKey.current} />
            )}
          </Canvas>
        </div>

        {/* Session intro */}
        {state.phase === 'intro' && !state.matchEnd && (
          <div className="overlay">
            <div className="overlay-card">
              <h2>{state.sd ? `SUDDEN DEATH — Round ${state.sd.round}` : `Heat ${state.heat}`}</h2>
              <p className="big-role">{isShooter ? 'You are the SHOOTER' : 'You are the HIDER'}</p>
              <p className="hud-dim">
                {state.sd
                  ? isShooter
                    ? state.sd.half === 2 && state.sd.firstHalfHit !== null
                      ? state.sd.firstHalfHit
                        ? 'Opponent HIT. You must land a hit to stay alive.'
                        : 'Opponent MISSED. Land any hit to win the match!'
                      : 'One turn. Any hit counts.'
                    : 'Survive one turn. Any hit counts against you.'
                  : isShooter
                    ? 'Kill in as few turns as you can. 3 body hits or a headshot.'
                    : 'Survive as long as you can. Protect your head.'}
              </p>
            </div>
          </div>
        )}

        {/* Session end (heat killed) */}
        {state.overlay?.kind === 'sessionEnd' && (
          <div className="overlay">
            <div className="overlay-card">
              <h2>{state.overlay.byHeadshot ? '💀 HEADSHOT' : '💀 KILL'}</h2>
              <p>
                {isShooter
                  ? `You got the kill in ${state.overlay.turnsUsed} turn${state.overlay.turnsUsed === 1 ? '' : 's'}.`
                  : `You survived ${state.overlay.turnsUsed} turn${state.overlay.turnsUsed === 1 ? '' : 's'}.`}
              </p>
              <p className="hud-dim">{state.heat === 1 ? 'Swapping roles…' : 'Comparing scores…'}</p>
            </div>
          </div>
        )}

        {/* Sudden-death half end */}
        {state.overlay?.kind === 'sdHalfEnd' && (
          <div className="overlay">
            <div className="overlay-card">
              <h2>{state.overlay.sdHit ? '🎯 HIT' : '❌ MISS'}</h2>
              <p className="hud-dim">Sudden death round {state.overlay.sdRound}…</p>
            </div>
          </div>
        )}

        {/* Opponent disconnected */}
        {state.oppDisconnectedUntil && !state.matchEnd && (
          <div className="overlay">
            <div className="overlay-card">
              <h2>Opponent disconnected</h2>
              <p>
                They have <strong>{graceSeconds}s</strong> to reconnect or they forfeit.
              </p>
            </div>
          </div>
        )}

        {/* Match end */}
        {state.matchEnd && (
          <div className="overlay">
            <div className="overlay-card">
              <h2>{state.matchEnd.youWin ? '🏆 YOU WIN' : '☠️ YOU LOSE'}</h2>
              {state.matchEnd.forfeit ? (
                <p className="hud-dim">{state.matchEnd.youWin ? 'Your opponent forfeited.' : 'You forfeited the match.'}</p>
              ) : (
                <>
                  <p>
                    Kills — you: {state.matchEnd.yourTurns ?? '—'} turn{state.matchEnd.yourTurns === 1 ? '' : 's'}, opponent:{' '}
                    {state.matchEnd.oppTurns ?? '—'} turn{state.matchEnd.oppTurns === 1 ? '' : 's'}.
                  </p>
                  {state.matchEnd.suddenDeath && <p className="hud-dim">Decided in sudden death.</p>}
                </>
              )}
              {!state.matchEnd.forfeit && (
                <button className="primary" onClick={requestRematch}>
                  Rematch {state.rematchVotes > 0 && `(${state.rematchVotes}/2)`}
                </button>
              )}
              <button onClick={leaveRoom}>Leave</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
