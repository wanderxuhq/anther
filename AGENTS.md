# AGENTS.md

## Project

anther (`@wanderxuhq/anther`) is a single-package, stateless web IDE. A plain Node `http` server exposes one or more workspace directories; the browser app is SolidJS + CodeMirror 6. There is no auth, database, or server framework. Heavy previews (SQLite/WASM, ZIP/7z/RAR, PDF, EPUB) run in the browser and Web Workers; the server mainly moves bytes and runs git, PTY, and LSP subprocesses.

## Commands

- `npm install`
- `npm run dev` — backend `:3000` + Vite `:5173`. Vite proxies `/api` (including WebSocket upgrades) to `localhost:3000`. Backend args pass through, but changing the backend port also requires updating the proxy target in `web/vite.config.ts`.
- `npm run dev:server` / `npm run dev:web` — run one side only.
- `npm test` — Node's test runner over `server/**/*.test.ts` and `web/src/**/*.test.ts`. It runs hundreds of tests in parallel; use a single file while iterating.
- Single test: `node --test --experimental-transform-types server/routes/git.test.ts` (same pattern for a web test).
- `npm run typecheck` — both `tsconfig.json` and `web/tsconfig.json`. There is no lint, formatter, or CI config.
- `npm run build` — emits `dist/server`, `dist/shared`, and `dist/web`. `npm start` requires it: `bin/anther.js` imports `dist/server/cli.js`. `npm pack` runs the build automatically through `prepack`.

TypeScript runs directly with Node's type stripping, so tests/dev need Node 22.7+ for `--experimental-transform-types` (this repo is developed on Node 24). All relative imports use explicit `.ts`/`.tsx` extensions, including frontend code.

## Layout

- `server/cli.ts` — real entrypoint: parses `[dir] --port`, builds the workspace and mount registry, starts the HTTP server, and prints startup URLs. Register per-workspace route modules in `server/workspace.ts`.
- `server/http.ts` — hand-rolled router. Routes match exact pathnames (no `:params`); helpers are `get`/`put`/`post`, `postBinary` (raw body, no 1 MB JSON cap), `getStream`, `sse`, `ws`. Unknown `/api/*` returns JSON 404; other GETs fall back to `index.html`, or redirect to `/-` when the host is detached or the mount is unknown.
- `server/files.ts` (`FileStore`) — the only layer for workspace file access; confines paths to the workspace and rejects `..`/absolute paths. Route code must go through it. Temporary archive caches and host-level system info use `fs` directly.
- `server/routes/*.ts` — HTTP/WS feature routes; adjacent top-level server files implement git, PTY terminals, LSP, archives, downloads, previews, and the in-memory tab store.
- `web/src/App.tsx` — root component; `views/` outer panes; `components/` UI; `stores.ts` global signals; `api.ts` fetch/WS client; `url-state.ts` URL parse/serialize; `database/`, `readers/`, and `archive*.ts` are browser-side preview engines.
- `bin/anther.js` — published CLI shim into built `dist/server/cli.js`.

## Conventions that are easy to get wrong

- The frontend is **SolidJS**, not React. Use `createSignal`, `createMemo`, `Show`, `For`, `on`/`onCleanup`; JSX is compiled by `vite-plugin-solid`.
- Every user-visible string goes through `t()` in `web/src/i18n.ts`, with keys added to **both** `en` and `zh`. Unknown keys render as the key itself.
- URL is the source of navigation state. Extend `parseUrl`/`serializeUrl` in `web/src/url-state.ts` (and `url-fragment.ts` for `#field:value`) and keep round-trip/leak tests.
- `/-` (and `/-/`) is the instances list page; `/-/<name>/...` is the workspace-mount namespace; `/_/` is the frontend's internal route namespace (`/_/git`, `/_/file/`, `/_/database/`). URL parsing/serialization and API/WS URLs are base-aware via `web/src/base.ts`.
- `/api/anther` is read-only identity. Attaching is a loopback-only `POST /api/anther/attach`; `--no-attach` disables it. Do not expose the attach route to LAN clients. Detaching is `POST /api/anther/detach`, used by `anther --detach` and the `/-` page; the host mount can also be detached.
- Tests are colocated `*.test.ts` using `node:test` + `node:assert/strict`. Web tests also run under Node, which cannot parse `.tsx`/JSX: put testable logic in `.ts` modules, and use `jsdom` explicitly for DOM-dependent tests. `web/tsconfig.json` excludes tests, so typecheck does not cover them.
- Server writes are intentionally **not** read-only-gated; read-only is a frontend/editor mode (see the comment in `server/routes/fs.ts`). Don't add server-side `ro` checks unless the behavior is deliberately changing.
- Keep the server stateless: tabs, terminals, and heartbeat state are in memory, with no config/db/session/log files. Browser persistence is limited to a few localStorage keys (user id, file-tab snapshot, database-tab snapshot, archive limits, terminal render mode, terminal key bar open state).
- Terminal rendering lives in `web/src/terminal/`; `shared/terminal/vt.ts` is the in-repo VT parser/screen buffer, and `views/terminal.tsx` owns the DOM/HTML renderer. Keep the HTML/plain-text switch render-only: it must never reset the PTY, screen buffer, or WebSocket. Don't reintroduce xterm.
- `/api/anther` is the public detection API (`server/app-info.ts`); only change `apiVersion` for incompatible changes. `/api/system` exposes host/hardware details.
- Git shells out to the real `git` via `execFile` (no shell) and inherits the user's git config. Tests create temporary repos, so `git` must be installed. Terminals require util-linux `script`, GNU `stty`, and `bash`; Linux/WSL provide them, Termux and macOS may need them installed, and Windows uses WSL.
- `staticDirFor()` deliberately resolves `../web` from the module URL: source runs serve `web/`, builds serve `dist/web/`. Don't replace it with a hardcoded `dist/web`.
- `web/vite.config.ts` patches `os.networkInterfaces()` for sandboxed/container environments; preserve that guard.
- When behavior or CLI docs change, update both `README.md` and `README.zh-CN.md`.
