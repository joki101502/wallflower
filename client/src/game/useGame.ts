import { useCallback, useEffect, useState } from 'react';
import type {
  Heat,
  Hole,
  MatchEndPayload,
  Phase,
  Pose,
  Role,
  RoomStatePayload,
  SdInfo,
  ShotResult,
} from '../../../shared/protocol';
import { SHOTS_PER_TURN } from '../../../shared/protocol';
import { socket } from '../socket';

export interface OverlayState {
  kind: 'sessionEnd' | 'sdHalfEnd';
  turnsUsed?: number;
  byHeadshot?: boolean;
  sdRound?: number;
  sdHalf?: 1 | 2;
  sdHit?: boolean;
}

export interface GameState {
  connected: boolean;
  room: RoomStatePayload | null;
  // Session
  role: Role | null;
  heat: Heat;
  sd: SdInfo | null;
  phase: Phase;
  turn: number;
  endsAt: number;
  shotsLeft: number;
  hitCount: number;
  holes: Hole[];
  oppPose: Pose | null;
  lastShot: ShotResult | null;
  overlay: OverlayState | null;
  oppDisconnectedUntil: number | null;
  matchEnd: MatchEndPayload | null;
  rematchVotes: number;
  paused: boolean;
}

const initialGame = {
  role: null as Role | null,
  heat: 1 as Heat,
  sd: null as SdInfo | null,
  phase: 'intro' as Phase,
  turn: 0,
  endsAt: 0,
  shotsLeft: SHOTS_PER_TURN,
  hitCount: 0,
  holes: [] as Hole[],
  oppPose: null as Pose | null,
  lastShot: null as ShotResult | null,
  overlay: null as OverlayState | null,
  matchEnd: null as MatchEndPayload | null,
  rematchVotes: 0,
  paused: false,
};

export function useGame() {
  const [connected, setConnected] = useState(socket.connected);
  const [room, setRoom] = useState<RoomStatePayload | null>(null);
  const [game, setGame] = useState(initialGame);
  const [oppDisconnectedUntil, setOppDisconnectedUntil] = useState<number | null>(null);

  useEffect(() => {
    let roomConfirmTimer: ReturnType<typeof setTimeout> | null = null;
    const onConnect = () => {
      setConnected(true);
      // After a reconnect the server re-sends room_state if it still knows us.
      // If it doesn't (server restarted, room swept), fall back to home.
      let confirmed = false;
      const confirm = () => {
        confirmed = true;
      };
      socket.once('room_state', confirm);
      roomConfirmTimer = setTimeout(() => {
        socket.off('room_state', confirm);
        if (!confirmed) {
          setRoom(null);
          setGame(initialGame);
          setOppDisconnectedUntil(null);
        }
      }, 2_500);
    };
    const onDisconnect = () => setConnected(false);
    const onRoomState = (r: RoomStatePayload) => {
      setRoom(r);
      if (r.status === 'waiting') {
        // Keep the match-end overlay up if the room emptied because the
        // opponent left/forfeited — the player dismisses it via Leave.
        setGame((g) => (g.matchEnd ? g : initialGame));
        setOppDisconnectedUntil(null);
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room_state', onRoomState);

    socket.on('session_start', ({ youAre, heat, sd }) => {
      setGame((g) => ({
        ...initialGame,
        matchEnd: null,
        role: youAre,
        heat,
        sd,
        // keep nothing else across sessions: fresh wall, fresh counters
        rematchVotes: 0,
        oppPose: g.oppPose,
      }));
    });

    socket.on('phase_change', ({ phase, turn, endsAt }) => {
      setGame((g) => ({ ...g, phase, turn, endsAt, overlay: null, paused: false, ...(phase === 'shoot' ? { shotsLeft: SHOTS_PER_TURN } : {}) }));
    });

    socket.on('pose_broadcast', ({ pose }) => {
      setGame((g) => ({ ...g, oppPose: pose }));
    });

    socket.on('shot_result', (res) => {
      setGame((g) => ({
        ...g,
        holes: [...g.holes, { x: res.x, y: res.y, hit: res.hit }],
        hitCount: res.hitCount,
        shotsLeft: res.shotsLeft,
        lastShot: res,
      }));
    });

    socket.on('session_end', ({ turnsUsed, byHeadshot }) => {
      setGame((g) => ({ ...g, overlay: { kind: 'sessionEnd', turnsUsed, byHeadshot } }));
    });

    socket.on('sd_half_end', ({ round, half, hit }) => {
      setGame((g) => ({ ...g, overlay: { kind: 'sdHalfEnd', sdRound: round, sdHalf: half, sdHit: hit } }));
    });

    socket.on('match_end', (payload) => {
      setGame((g) => ({ ...g, matchEnd: payload, overlay: null }));
      setOppDisconnectedUntil(null);
    });

    socket.on('opponent_disconnected', ({ graceEndsAt }) => {
      setOppDisconnectedUntil(graceEndsAt);
    });

    socket.on('opponent_reconnected', () => setOppDisconnectedUntil(null));

    socket.on('game_snapshot', (s) => {
      setGame((g) => ({
        ...g,
        role: s.youAre,
        heat: s.heat,
        turn: s.turn,
        phase: s.phase,
        endsAt: s.endsAt,
        holes: s.holes,
        hitCount: s.hitCount,
        shotsLeft: s.shotsLeft,
        sd: s.sd,
        paused: s.paused,
        matchEnd: null,
      }));
    });

    socket.on('rematch_state', ({ votes }) => {
      setGame((g) => ({ ...g, rematchVotes: votes }));
    });

    return () => {
      if (roomConfirmTimer) clearTimeout(roomConfirmTimer);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room_state', onRoomState);
      socket.removeAllListeners('session_start');
      socket.removeAllListeners('phase_change');
      socket.removeAllListeners('pose_broadcast');
      socket.removeAllListeners('shot_result');
      socket.removeAllListeners('session_end');
      socket.removeAllListeners('sd_half_end');
      socket.removeAllListeners('match_end');
      socket.removeAllListeners('opponent_disconnected');
      socket.removeAllListeners('opponent_reconnected');
      socket.removeAllListeners('game_snapshot');
      socket.removeAllListeners('rematch_state');
    };
  }, []);

  const createRoom = useCallback((ack?: () => void) => {
    socket.emit('create_room', () => ack?.());
  }, []);

  const joinRoom = useCallback(
    (code: string, onError: (msg: string) => void, ack?: () => void) => {
      socket.emit('join_room', { code }, (res) => {
        ack?.();
        if (!res.ok) onError(res.error.message);
      });
    },
    []
  );

  const leaveRoom = useCallback(() => {
    socket.emit('leave_room');
    setRoom(null);
    setGame(initialGame);
    setOppDisconnectedUntil(null);
  }, []);

  const fireShot = useCallback((x: number, y: number) => {
    socket.emit('fire_shot', { x, y });
  }, []);

  const sendPose = useCallback((pose: Pose) => {
    socket.emit('pose_update', { pose });
  }, []);

  const requestRematch = useCallback(() => {
    socket.emit('rematch');
  }, []);

  const state: GameState = { connected, room, oppDisconnectedUntil, ...game };
  return { state, createRoom, joinRoom, leaveRoom, fireShot, sendPose, requestRematch };
}
