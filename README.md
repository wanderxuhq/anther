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

Open `http://localhost:3000` by default. If the port is already served by anther, running `anther` in another directory attaches it to that server; use `--no-attach` to disable attaching, and `anther --detach` to detach. Terminals require POSIX `script`, `stty`, and `bash` (use WSL on Windows).

After `npm run build`, `npm start` runs the built server.

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

Vite proxies `/api` to `localhost:3000`; if you change the backend port, update the proxy target in `web/vite.config.ts`.
