# anther

> English | [中文](README.zh-CN.md)

Mobile-first, browser-based code viewer and editor. Run it in a project directory and open the printed URL.

## Install / Run

Requires Node.js 22.7+.

```bash
# Run directly in the current directory
npx @wanderxuhq/anther

# Choose a directory and port
npx @wanderxuhq/anther /path/to/project --port 8080

# Or install globally
npm i -g @wanderxuhq/anther
anther /path/to/project
```

Open `http://localhost:3000` by default. The server listens only on the local machine (`127.0.0.1`) by default; use `--lan` to listen on all interfaces (`0.0.0.0`) so phones and other machines on the LAN can use the printed LAN URL, or `--host <addr>` to pick a specific address (`--host ::` gives dual-stack IPv6). There is no authentication: only expose it on trusted networks, or put it behind a reverse proxy that adds authentication.

If the port is already served by anther, running `anther` in another directory attaches it to that server; use `--no-attach` to disable attaching, and `anther --detach` to detach. Terminals require POSIX `script`, `stty`, and `bash` (use WSL on Windows).

After `npm run build`, `npm start` runs the built server.

The ⓘ system information dialog can switch the listener between local (`127.0.0.1`) and LAN (`0.0.0.0`) while the server is running; existing terminal and LSP WebSocket connections stay connected.

## Development

```bash
npm install
npm run dev         # backend :3000 + Vite :5173
npm run dev:server  # backend only
npm run dev:web     # frontend only
npm test
npm run typecheck
npm run build
```

Both the backend and Vite listen only on the local machine by default. To try it from a phone on the LAN, run `npm run dev -- --lan` (or `--host 0.0.0.0`), which applies to both. Vite proxies `/api` to `127.0.0.1:3000`; if you change the backend port, update the proxy target in `web/vite.config.ts`.
