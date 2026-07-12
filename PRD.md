# Wallflower — Product Requirements & Planning Document

> **Status:** v1.1 — design decisions confirmed; ready for Phase 0.
> **Owner:** Joseph Kim
> **Last updated:** 2026-07-12

---

## 1. Overview

**Wallflower** is a 2-player, turn-based, browser game of nerve and deduction. One
player is the **Shooter**, standing in front of a solid wall with a gun and three
bullets per turn. The other is the **Hider**, pressed flat against the far side of
that wall, contorting their body to keep their vital areas away from where they
think the next bullet will punch through.

The name comes from the Hider's only survival strategy: hug the wall, read the
holes, and stay small.

The core fantasy is **asymmetric information under a clock**. Neither player sees
the whole picture, and the picture only sharpens as bullets fly.

### Non-negotiable pillars

1. **Turn-based with real-time movement inside each turn.** The Hider is always
   moving; the Shooter fires into that motion.
2. **Information is earned through holes.** Every shot is both an attack and a
   window. Early turns are nearly blind for the Shooter; late turns are a shooting
   gallery.
3. **It's a race, not a duel.** Both players eventually play both roles; the winner
   is whoever needed fewer turns to get the kill.

---

## 2. The Central Tension (read this first — everything derives from it)

The wall is **opaque**, but **every hole a Shooter has already made is a permanent
peephole**. Through each hole the Shooter can see whatever slice of the Hider's body
happens to be behind that spot *right now, in real time*.

- **Shooter's arc:** Turn 1 they're shooting almost blind at a blank wall. Each shot
  that lands (or even misses) opens a new sightline. By turn 3–4 they have a
  scattering of peepholes and a real read on where the head keeps hiding.
- **Hider's arc:** The Hider sees exactly where the holes are on their side, so they
  know precisely which parts of their body are currently *exposed* through a hole and
  which are still safe behind solid wall. They get **no warning** of the next shot —
  they can only infer from the pattern of existing holes where the Shooter is
  hunting, and keep their vitals out of the open.

This single mechanic is what makes the game work. Protect it in every design
decision.

---

## 3. Players & Roles

| | **Shooter** | **Hider** |
|---|---|---|
| **Goal** | Kill the Hider in as few turns as possible | Survive as many turns as possible |
| **Sees** | Blank wall + all existing holes; the Hider is visible only through those holes (real-time) | Their own body + the holes (as light coming through); knows which body parts are currently exposed |
| **Acts** | Fires up to 3 shots during the 20s shoot phase | Continuously repositions limbs (IK ragdoll) during both phases |
| **Skill** | Timing, memory of the Hider's habits, using peepholes to hunt the head | Reading the hole pattern, keeping vitals covered, unpredictability |

Both players play **both roles** over the course of a match (see §6).

---

## 4. Game Mechanics

### 4.1 Turn structure & timing

Each **turn** has two sequential phases:

1. **Orient phase — 10 seconds.** Only the Hider acts, repositioning their limbs.
   The Shooter waits and plans (they see the wall + existing holes but cannot fire).
2. **Shoot phase — 20 seconds.** The Shooter fires **up to 3 shots**, at moments of
   their choosing within the window. **The Hider keeps moving the entire time** and
   reacts to nothing but the holes already on the wall.

- Unused shots are **forfeited** at the end of the shoot phase (do not bank to next
  turn). *(Working assumption — §12.)*
- The Hider's **pose persists** across phases and across turns. It does not reset
  between turns; the Hider continues from wherever they left off. At the very start
  of a session the Hider begins in a neutral default pose. *(Working assumption — §12.)*
- The server owns the clock and phase transitions (clients cannot be trusted to time
  themselves — see §7.4).

### 4.2 Shooting

- Aiming is a point on the 2D wall plane `(x, y)`. A shot is a straight bullet
  traveling along the depth axis (through the wall) at that point.
- The bullet hits whatever body part occupies `(x, y)` at the instant it is fired.
- Every shot — hit or miss — **creates a permanent hole** at `(x, y)`, which becomes
  a new peephole for the rest of the session.

### 4.3 The wall, holes & visibility

- **Holes are permanent for the duration of a shooter session** and accumulate.
- On the **Shooter's screen**: the wall is a solid occluder; the Hider is rendered
  fully behind it but is only *seen* through hole openings (standard 3D occlusion).
- On the **Hider's screen**: holes appear as marks/light on their side of the wall so
  they know their currently-exposed regions.
- Holes have a small radius (tunable); overlapping shots merge into larger openings.

### 4.4 Hider movement (IK ragdoll)

- The game world is **3D**, but the Hider's limbs move only on a **2D plane parallel
  to the wall** (the Hider is hugging it). Depth is effectively fixed.
- Control scheme: **drag-a-limb inverse kinematics.** The player grabs an
  end-effector (a hand, a foot, or the head) with the mouse and drags it; a 2-bone IK
  solver bends the intermediate joint (elbow / knee) to follow.
- Draggable targets (v1): head, left hand, right hand, left foot, right foot. The
  torso is the root anchor (with optional limited lean). *(Detail — §12, evaluate in
  Phase 2.)*
- No gravity/physics ragdoll needed — posing is **kinematic** (limbs stay where put).
- Desktop only: mouse drag, no touch. (See §4.8.)

### 4.5 Hit detection & kill rules

- **A hit is binary** — a body part is either under the shot point or not. No damage
  falloff, no partial hits.
- The Hider tolerates **3 body hits total**; the **3rd hit is a kill**. Hits
  accumulate across all of the Shooter's turns in that session.
- **A headshot is an instant kill**, regardless of how many hits have landed.
- **Limb/torso hits are pure chip damage** — a hit is a hit; there is no limp-limb or
  movement-impairment effect. (Simplicity by design.)
- Misses (shots that hit only the wall) count toward nothing but still open a
  peephole.

**Body parts & hitboxes (v1):** head (vital), torso, upper/lower arm ×2, upper/lower
leg ×2. Each part is a simple 2D collider (circle/capsule) on the wall plane. Only
"head" vs. "not head" matters for rules; the rest is one bucket.

### 4.6 Adjudication authority & timing

- Hit/miss is decided **server-side** against the Hider's most recently received pose
  snapshot at the moment the shot event arrives.
- Because the Hider is playing prediction (no reaction to the shot itself), small
  network latency in adjudication is acceptable and does not create a visible
  mismatch for either player.

### 4.7 Match structure, scoring & sudden death

The match is a **two-heat race**, played sequentially (not simultaneously):

1. **Coin toss** decides who shoots first. *(Decided.)*
2. **Heat 1:** Player A is Shooter, Player B is Hider. Turns repeat (orient → shoot)
   until B dies. Record `turnsA` = number of turns A used.
3. **Heat 2:** Roles swap. Player B is Shooter, A is Hider. Turns repeat until A dies.
   Record `turnsB`.
4. **Result:** Fewer turns wins. `turnsA < turnsB` → A wins, and vice-versa.

**Sudden death (on a tie, `turnsA == turnsB`):**

- A fresh **coin toss** decides who goes first.
- Play proceeds in **single-turn rounds**. In sudden death, **any body hit is a
  win-attempt** (you don't need 3; one hit "counts").
- Each round, both players take **one** shooter-turn against the other:
  - If exactly **one** player lands a hit that round → that player **wins the match**.
  - If **both** hit or **both** miss → the round is a wash; play another round.
- Repeat until a round is decisive.

**Information rule (decided):** sudden death is played sequentially, and the second
shooter in a round **knows whether the first shooter hit** before taking their own
turn — same as a penalty shootout. (If the first shooter missed, the second shooter
knows a hit wins the match outright.)

### 4.8 Platform

- **Desktop web only.** Mouse-driven. Touch/mobile is explicitly out of scope for v1.
- Mobile visitors get a friendly "desktop only" gate rather than a broken experience.

---

## 5. Game State Machine

Server-authoritative. One instance per room.

```
LOBBY
  ├─ (player creates room) → WAITING_FOR_OPPONENT
  └─ (second player joins)  → COIN_TOSS

COIN_TOSS
  └─ (assign first shooter) → HEAT (heat=1)

HEAT
  ├─ TURN_ORIENT (10s, hider only)
  │     └─ timer expires → TURN_SHOOT
  ├─ TURN_SHOOT  (20s, shooter fires ≤3; hider moving)
  │     ├─ kill (3rd body hit OR headshot) → SESSION_END
  │     └─ timer expires, no kill           → TURN_RESULT
  ├─ TURN_RESULT (brief) → next TURN_ORIENT (turn++)
  └─ SESSION_END → record turnsUsed
        ├─ heat==1 → swap roles, heat=2, TURN_ORIENT
        └─ heat==2 → MATCH_RESOLVE

MATCH_RESOLVE
  ├─ turnsA != turnsB → MATCH_END (winner)
  └─ turnsA == turnsB → SUDDEN_DEATH

SUDDEN_DEATH
  └─ alternating single turns until decisive → MATCH_END

MATCH_END
  └─ (rematch) → COIN_TOSS   |   (leave) → teardown
```

Cross-cutting states: `OPPONENT_DISCONNECTED` (grace timer) can interrupt any active
state (see §9).

---

## 6. UX / Screens (desktop)

1. **Landing / Home** — title, "Create Game" and "Join Game" (enter 6-char code).
2. **Waiting room** — shows the room code to share; "waiting for opponent…".
3. **Coin toss / role reveal** — animates who shoots first; "You are the SHOOTER/HIDER".
4. **Shooter view** — 3D wall from the front; crosshair; holes visible with the Hider
   showing through them; shots-remaining (0–3); phase timer; hit counter; turn number.
5. **Hider view** — behind the wall; the ragdoll with draggable handles; holes shown
   as light/marks with exposed body parts highlighted; phase timer; hit counter.
6. **Turn result / session end** — hit feedback, "killed in N turns".
7. **Match end** — winner, `turnsA` vs `turnsB`, sudden-death recap if any; Rematch /
   Exit.
8. **Interstitials** — opponent disconnected (grace countdown), reconnecting, errors.

*(Visual design/art direction is deferred; wireframes to follow in a design pass.)*

---

## 7. Technical Architecture

### 7.1 Stack (recommended)

| Layer | Choice | Why |
|---|---|---|
| Frontend framework | **React + TypeScript + Vite** | Fast dev/build, ecosystem, easy static output |
| 3D rendering | **Three.js via react-three-fiber** + `@react-three/drei` | Declarative 3D in React; occlusion "for free" |
| IK | **Custom 2-bone IK solver** | Limbs are simple 2-bone chains on a 2D plane; no library needed |
| Realtime | **Socket.IO** (Node) | Built-in rooms, reconnection, heartbeats, fallbacks |
| Backend | **Node + TypeScript + Express** | Serves the built frontend *and* the socket server from one process |
| Shared code | **Shared `types`/protocol module** | Single source of truth for event contracts |
| Persistence | **In-memory only** | Rooms are ephemeral; no accounts, no DB needed at this scale |
| Hosting | **Single Render Web Service (Node)** | WebSockets supported; one service serves everything |

> Rationale: at ~50 concurrent users the traffic is trivial, there's no durable data,
> and a single Node process serving static assets + Socket.IO is the simplest thing
> that fully satisfies the requirements. Adding a DB, Redis, or a separate frontend
> host would be premature.

### 7.2 Client responsibilities

- Render both role views in 3D.
- **Hider:** run IK locally for immediate responsiveness; stream pose to server at a
  fixed rate (~15 Hz, throttled).
- **Shooter:** render the Hider from streamed pose behind the occluding wall; send
  `fire_shot` events; render holes.
- All game-flow truth (phase, timer, hit counts, kills, scores) comes **from the
  server** — the client only displays it.

### 7.3 Server responsibilities

- Room registry (create/join/teardown), 6-char codes.
- Authoritative state machine, phase timers, turn counting.
- Receive Hider pose stream; keep the latest snapshot per room.
- Adjudicate `fire_shot` against the latest pose; compute hit/part/headshot/kill.
- Broadcast phase changes, shot results, holes, session/match outcomes.
- Relay Hider pose to the Shooter for rendering.

### 7.4 Authority & anti-cheat

- **Server is authoritative** for timing and hit adjudication — clients cannot self-
  report hits or extend their own clock.
- **Known risk — "wallhack" (accepted for v1):** since the Shooter's client receives
  the full Hider pose, a determined cheater could disable the wall occlusion in the
  browser and see the whole Hider. **Decided: accept this risk — anti-cheat is out of
  scope for v1.** Server-side visibility culling (streaming only the body parts
  actually visible through existing holes) is documented as a possible v2 hardening.

### 7.5 Networking model / message protocol (draft)

**Client → Server**

| Event | Payload | Notes |
|---|---|---|
| `create_room` | `{}` | → `room_created` |
| `join_room` | `{ code }` | → `match_start` or `error` |
| `pose_update` | `{ parts: { head:{x,y,angle}, handL:{…}, … } }` | Hider only, throttled ~15 Hz |
| `fire_shot` | `{ x, y, clientTime }` | Shooter only, during shoot phase |
| `rematch` | `{}` | From match-end screen |

**Server → Client**

| Event | Payload |
|---|---|
| `room_created` | `{ code }` |
| `player_joined` / `player_left` | `{ playerId }` |
| `match_start` | `{ youAre, firstShooter }` |
| `phase_change` | `{ phase, turn, endsAt }` |
| `pose_broadcast` | `{ parts }` (to Shooter) |
| `shot_result` | `{ x, y, hit, part, isHeadshot, hitCount, killed }` |
| `session_end` | `{ shooter, turnsUsed }` |
| `role_swap` | `{ youAre, heat }` |
| `match_end` | `{ winner, turnsA, turnsB, suddenDeath }` |
| `sudden_death_start` | `{ firstShooter }` |
| `opponent_disconnected` | `{ graceEndsAt }` |
| `error` | `{ code, message }` |

*(Event names/payloads are a starting contract, to be firmed up during Phase 0.)*

### 7.6 Data models (in-memory)

```
Room {
  code: string            // 6 chars, no ambiguous glyphs (no O/0/I/1)
  players: [PlayerA, PlayerB]
  state: MachineState
  heat: 1 | 2
  turn: number
  phase: 'orient' | 'shoot' | 'result'
  phaseEndsAt: epoch ms
  holes: Array<{ x, y, r }>
  latestPose: Pose        // most recent Hider snapshot
  hitCount: number        // body hits this session
  turnsA?: number
  turnsB?: number
  createdAt, lastActivityAt
}

Pose {
  parts: Record<PartName, { x, y, angle }>
}
```

---

## 8. Rooms & Lifecycle

- **Code:** 6 uppercase alphanumeric chars, excluding ambiguous glyphs (O, 0, I, 1).
  Collision-checked against active rooms.
- **Capacity:** exactly 2 players; a 3rd join attempt is rejected with an error.
- **Creation:** on demand via `create_room`.
- **Teardown:** when both players leave, or after an inactivity timeout
  (e.g., 10 min idle).
- **Disconnect handling (decided):** if a player drops mid-match, enter
  `OPPONENT_DISCONNECTED` with a **45-second grace window** for reconnect via the
  same room code. If they don't return in time, the match is a **forfeit — the
  remaining player wins**.

---

## 9. Deployment on Render

- **One Render Web Service** running the Node server, which:
  - Serves the Vite-built static frontend.
  - Hosts the Socket.IO endpoint on the same origin/port.
- **Build:** `npm run build` (Vite → static) then start Node (`node dist/server.js`).
- **Port:** read from Render's `PORT` env var.
- **WebSockets:** supported by Render; ensure the client connects to the same origin.
- **Instance tier:** use a **paid Starter instance**, not Free. The Free tier spins
  down on idle, causing cold starts and dropped WebSocket connections — unacceptable
  for a live 2-player session. A single small instance comfortably handles the target
  load (see §10).
- **Config:** `render.yaml` (infra-as-code) checked into the repo. No database, no
  Redis, no external services for v1.

---

## 10. Scale & Performance

- **Target:** ~50 concurrent users (edge case) → ~25 simultaneous rooms.
- **Message volume:** at most one Hider streaming per room at a time (turn-based) →
  ~25 × 15 Hz ≈ **375 inbound pose msgs/sec**, plus low-rate shot/phase events. This
  is trivial for a single Node process.
- **Memory:** per-room state is tiny (a pose, a hole list, counters). Negligible.
- **CPU:** hit adjudication is a handful of 2D collision checks per shot. Negligible.
- **Conclusion:** a single small instance is sufficient with wide headroom. No
  horizontal scaling, sticky sessions, or shared state store needed at this scale.
  *(If it ever grows beyond one instance, we'd add Redis + the Socket.IO adapter — out
  of scope now.)*

---

## 11. Build Roadmap (phased)

Each phase is independently demoable.

> **Build-order note (2026-07-12):** after Phase 1 we built the full game loop as a
> **2D vertical slice first** (Phases 3–6 with SVG placeholder rendering — draggable
> IK body, wall with peephole clipping) so the game was playable end-to-end ASAP.
> Phase 2's 3D scene is now a **visual upgrade** on top of unchanged game logic.

- **Phase 0 — Scaffold & deploy.** ✅ Vite+React+TS front, Express+Socket.IO back,
  shared types, `render.yaml`. WebSockets proven end-to-end.
- **Phase 1 — Rooms.** ✅ Create/join by 6-char code, waiting room, 2-player presence,
  reject 3rd, disconnect handling, reconnect-by-identity (per-tab session id).
- **Phase 2 — 3D scene & IK.** ✅ Three.js (react-three-fiber): extruded wall with
  real hole geometry (true occlusion), capsule body from the shared pose model,
  raycast aiming, 3D drag handles, per-side lighting. One persistent Canvas per
  match (scene swap on role change) to avoid WebGL context loss.
- **Phase 3 — Turn state machine & timers.** ✅ Server-authoritative orient/shoot/result
  phases, turn counter, phase broadcasts, pause/resume on disconnect.
- **Phase 4 — Shooting & holes & visibility.** ✅ (2D form) Shooter aims/fires, holes
  persist, Hider pose streamed, peephole clipping on the Shooter's view.
- **Phase 5 — Hits & kills.** ✅ Server adjudication (limbs shield head, head before
  torso), 3-body-hit rule, headshot instakill, session end + turns-used recording.
- **Phase 6 — Full match flow.** ✅ Role swap, heat comparison, sudden death (washes
  repeat, decisive round ends), coin tosses, win/lose screens, rematch voting.
- **Phase 7 — Polish & hardening.** Sound/feedback, hole visuals, reconnection UX
  polish, desktop-only gate, edge cases, optional wallhack culling.

---

## 12. Decisions Log & Remaining Open Items

**Decided (confirmed 2026-07-12):**

1. **Who shoots first in Heat 1** — coin toss (same mechanism as sudden death). ✅
2. **Sudden-death information** — the second shooter in a round **does** learn the
   first shooter's hit/miss before taking their turn (penalty-shootout convention). ✅
3. **Disconnect resolution** — 45s reconnect grace window; a no-return is a
   **forfeit** and the remaining player wins. ✅
4. **Anti-cheat** — **out of scope for v1.** Ship without server-side visibility
   culling; accept the wallhack risk. Culling documented as possible v2 work. ✅

**Working assumptions (made to keep the PRD complete; changeable cheaply):**

5. **Unused shots** — forfeited at end of shoot phase (no banking to next turn).
6. **Pose persistence** — the Hider's pose carries across turns and only resets to
   neutral at the start of each new shooter session.

**Genuinely open (defer to build/playtest):**

7. **Draggable joints** — v1 set is head + 2 hands + 2 feet with a fixed torso root;
   torso lean/rotation to be evaluated in Phase 2.
8. **Hole radius & merging behavior** — tuning values, decided by playtest in Phase 4.

---

## 13. Out of Scope (v1)

- Mobile / touch support.
- User accounts, persistence, matchmaking, leaderboards.
- Spectators.
- More than 2 players per room.
- Voice/text chat.
- Custom characters, cosmetics, maps.
- Anti-cheat beyond server-authoritative adjudication (culling is optional/v2).
