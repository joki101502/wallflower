# Wallflower

A 2-player, turn-based browser game of nerve. One player shoots through a wall;
the other hugs the far side of it, contorting to survive. Every bullet hole is a
permanent peephole. See [PRD.md](PRD.md) for the full design.

## Stack

- **Client:** React + TypeScript + Vite (in `client/`)
- **Server:** Node + Express + Socket.IO (in `server/`)
- **Shared:** protocol types & constants (in `shared/`)
- One process serves both the static client and the WebSocket endpoint.

## Run locally (first time)

### 0. Prerequisites

- **Node.js 22 or newer** — check with:
  ```sh
  node --version
  ```
  If you don't have it, install from https://nodejs.org (or `brew install node` on macOS).
- **npm** (comes with Node).

### 1. Clone and enter the repo

```sh
git clone https://github.com/<your-username>/wallflower.git
cd wallflower
```

### 2. Install dependencies

```sh
npm install
```

Installs everything for the client, server, and shared code (single package —
one install covers all of it).

### 3. Start the dev servers

```sh
npm run dev
```

This starts **two processes at once**:

| Process | URL | What it is |
|---|---|---|
| `server` | http://localhost:3001 | Node + Socket.IO game server (auto-restarts on change) |
| `client` | **http://localhost:5173** | Vite dev server with hot reload (proxies WebSockets to :3001) |

### 4. Play

1. Open **http://localhost:5173** in your browser.
2. Open the **same URL in a second window** (or an incognito window) — that's player 2.
3. In window 1, click **Create Game** and note the 6-character room code.
4. In window 2, enter the code and click **Join**.

Both windows are now in the same room.

### 5. Stop

Press `Ctrl+C` in the terminal running `npm run dev`.

## Run the production build locally

To run exactly what gets deployed (one server, no hot reload):

```sh
npm run build      # client → dist/client, server → dist/server
npm start          # everything on http://localhost:3001 (or $PORT)
```

Then open **http://localhost:3001** (note: port 3001, not 5173).

## Deploy (Render)

The repo contains a [render.yaml](render.yaml) blueprint: a single Node web
service (paid **starter** plan — the free tier idles down and drops live
WebSocket sessions).

1. Push to GitHub.
2. In the Render dashboard: **New → Blueprint**, pick this repo, apply.
3. Health check is served at `/healthz`.

## All scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev mode: server (auto-restart) + client (hot reload), both at once |
| `npm run dev:server` | Just the game server on :3001 |
| `npm run dev:client` | Just the Vite client on :5173 |
| `npm run build` | Production build of client and server into `dist/` |
| `npm start` | Run the production server from `dist/` |
| `npm run typecheck` | Typecheck client and server (no output, errors only) |

## Troubleshooting

- **"disconnected" badge in the top-right** — the game server isn't running or
  the client can't reach it. Make sure `npm run dev` shows both `server` and
  `client` processes running, and that nothing else is using port 3001.
- **Port already in use** — kill whatever is on 3001/5173 or change the port
  (`PORT=4000 npm run dev:server`, and update the proxy target in
  [client/vite.config.ts](client/vite.config.ts) to match).
- **Blank page on :3001** — you ran `npm start` without building first; run
  `npm run build` then `npm start`.
