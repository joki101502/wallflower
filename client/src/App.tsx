import { useState } from 'react';
import { useGame } from './game/useGame';
import { GameView } from './game/GameView';

export function App() {
  const { state, createRoom, joinRoom, leaveRoom, fireShot, sendPose, requestRematch } = useGame();
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const inGame =
    state.matchEnd !== null ||
    (state.room?.status === 'playing' && state.role !== null);

  const create = () => {
    setError(null);
    setBusy(true);
    createRoom(() => setBusy(false));
  };

  const join = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) {
      setError('Room codes are 6 characters.');
      return;
    }
    setError(null);
    setBusy(true);
    joinRoom(
      code,
      (msg) => setError(msg),
      () => setBusy(false)
    );
  };

  if (inGame) {
    return (
      <div className="app app-game">
        <GameView
          state={state}
          fireShot={fireShot}
          sendPose={sendPose}
          requestRematch={requestRematch}
          leaveRoom={leaveRoom}
        />
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <h1>WALLFLOWER</h1>
        <div className={`conn ${state.connected ? 'ok' : 'bad'}`}>
          {state.connected ? '● connected' : '● disconnected'}
        </div>
      </header>

      {!state.room && (
        <main className="card">
          <p className="tagline">Hug the wall. Stay alive.</p>
          <button className="primary" onClick={create} disabled={!state.connected || busy}>
            Create Game
          </button>
          <div className="divider">or</div>
          <div className="join-row">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="ROOM CODE"
              maxLength={6}
              spellCheck={false}
              onKeyDown={(e) => e.key === 'Enter' && join()}
            />
            <button onClick={join} disabled={!state.connected || busy}>
              Join
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </main>
      )}

      {state.room && (
        <main className="card">
          <p>Room code — share it with your opponent:</p>
          <div className="room-code">{state.room.code}</div>
          <p className="players">
            {state.room.players.length}/2 players in room
            {state.room.players.length < 2 ? ' — waiting for opponent…' : ' — starting…'}
          </p>
          <button onClick={leaveRoom}>Leave room</button>
        </main>
      )}
    </div>
  );
}
