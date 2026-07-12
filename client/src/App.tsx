import { useEffect, useState } from 'react';
import type { RoomStatePayload } from '../../shared/protocol';
import { socket } from './socket';

type Screen =
  | { name: 'home' }
  | { name: 'waiting'; room: RoomStatePayload };

export function App() {
  const [connected, setConnected] = useState(socket.connected);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => {
      setConnected(false);
      setScreen({ name: 'home' });
    };
    const onRoomState = (room: RoomStatePayload) => {
      setScreen({ name: 'waiting', room });
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room_state', onRoomState);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room_state', onRoomState);
    };
  }, []);

  const createRoom = () => {
    setError(null);
    setBusy(true);
    socket.emit('create_room', () => setBusy(false));
  };

  const joinRoom = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) {
      setError('Room codes are 6 characters.');
      return;
    }
    setError(null);
    setBusy(true);
    socket.emit('join_room', { code }, (res) => {
      setBusy(false);
      if (!res.ok) setError(res.error.message);
    });
  };

  const leaveRoom = () => {
    socket.emit('leave_room');
    setScreen({ name: 'home' });
  };

  return (
    <div className="app">
      <header>
        <h1>WALLFLOWER</h1>
        <div className={`conn ${connected ? 'ok' : 'bad'}`}>
          {connected ? '● connected' : '● disconnected'}
        </div>
      </header>

      {screen.name === 'home' && (
        <main className="card">
          <p className="tagline">Hug the wall. Stay alive.</p>
          <button className="primary" onClick={createRoom} disabled={!connected || busy}>
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
              onKeyDown={(e) => e.key === 'Enter' && joinRoom()}
            />
            <button onClick={joinRoom} disabled={!connected || busy}>
              Join
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </main>
      )}

      {screen.name === 'waiting' && (
        <main className="card">
          <p>Room code — share it with your opponent:</p>
          <div className="room-code">{screen.room.code}</div>
          <p className="players">
            {screen.room.players.length}/2 players in room
            {screen.room.players.length < 2
              ? ' — waiting for opponent…'
              : ' — opponent connected!'}
          </p>
          <button onClick={leaveRoom}>Leave room</button>
        </main>
      )}
    </div>
  );
}
