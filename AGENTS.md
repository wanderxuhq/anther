# AGENTS.md

## Project

anther (`@wanderxuhq/anther`) is a single-package, stateless web IDE. A plain Node `http` server exposes a workspace directory; the browser app is SolidJS + CodeMirror 6. There is no auth, database, or server framework. Heavy previews (SQLite/WASM, ZIP/7z/RAR, PDF, EPUB) run in the browser and Web Workers; the server mainly moves bytes and runs git, PTY, and LSP subprocesses.

## Commands

- `npm install`
- `npm run dev` — backend `:3000` + Vite `:5173`. Vite proxies `/api` (including WebSocket upgrades) to the backend. Backend args pass through: `npm run dev -- --port 8080`.
- `npm run dev:server` / `npm run dev:web` — run one side only.
- `npm test` — Node's test runner over `server/**/*.test.ts` and `web/src/**/*.test.ts`. It runs hundreds of tests in parallel; use a single file while iterating.
- Single test: `node --test --experimental-transform-types server/routes/git.test.ts` (same pattern for a web test).
- `npm run typecheck` — both `tsconfig.json` and `web/tsconfig.json`. There is no lint, formatter, or CI config.
- `npm run build` — emits `dist/server` + `dist/web`. `npm start` / `npm pack` require this first: `bin/anther.js` imports `dist/server/cli.js` (`prepack` runs the build).

TypeScript runs directly with Node's type stripping, so tests/dev need Node 22.7+ for `--experimental-transform-types` (this repo is developed on Node 24). All relative imports use explicit `.ts`/`.tsx` extensions, including frontend code.

## Layout

- `server/cli.ts` — real entrypoint: parses `[dir] --port`, builds stores/managers, registers routes, serves static files. Register every new route module here.
- `server/http.ts` — hand-rolled router. Routes match exact pathnames (no `:params`); helpers are `get`/`put`/`post`, `postBinary` (raw body, no 1 MB JSON cap), `getStream`, `sse`, `ws`. Unknown `/api/*` returns JSON 404; other GETs fall back to `index.html`.
- `server/files.ts` (`FileStore`) — the only filesystem access layer; confines paths to the workspace and rejects `..`/absolute paths. Route code must go through it.
- `server/routes/*.ts` — HTTP/WS feature routes; adjacent top-level server files implement git, PTY terminals, LSP, archives, downloads, previews, and the in-memory tab store.
- `web/src/App.tsx` — root component; `views/` outer panes; `components/` UI; `stores.ts` global signals; `api.ts` fetch/WS client; `url-state.ts` URL parse/serialize; `database/`, `readers/`, and `archive*.ts` are browser-side preview engines.
- `bin/anther.js` — published CLI shim into built `dist/server/cli.js`.

## Conventions that are easy to get wrong

- The frontend is **SolidJS**, not React. Use `createSignal`, `createMemo`, `Show`, `For`, `on`/`onCleanup`; JSX is compiled by `vite-plugin-solid`.
- Every user-visible string goes through `t()` in `web/src/i18n.ts`, with keys added to **both** `en` and `zh`. Unknown keys render as the key itself.
- URL is the source of navigation state. Extend `parseUrl`/`serializeUrl` in `web/src/url-state.ts` (and `url-fragment.ts` for `#field:value`) and keep round-trip/leak tests. The documented URL schema is in `README.md`.
- Tests are colocated `*.test.ts` using `node:test` + `node:assert/strict`. Web tests also run under Node, which cannot parse `.tsx`/JSX: put testable logic in `.ts` modules, and use `jsdom` explicitly for DOM-dependent tests. `web/tsconfig.json` excludes tests, so typecheck does not cover them.
- Server writes are intentionally **not** read-only-gated; read-only is a frontend/editor mode (see the comment in `server/routes/fs.ts`). Don't add server-side `ro` checks unless the behavior is deliberately changing.
- Keep the server stateless: tabs, terminals, and heartbeat state are in memory, with no config/db/session/log files. Browser persistence is limited to a few localStorage keys (user id, tab snapshot, archive limits).
- User identity is the `x-user-id` header; WebSockets use `?user=`. Tabs and terminals are scoped per user.
- `/api/anther` is the public detection API (`server/app-info.ts`); only change `apiVersion` for incompatible changes. `/api/system` exposes host/hardware details.
- Git shells out to the real `git` via `execFile` (no shell) and inherits the user's git config. Tests create temporary repos, so `git` must be installed. Terminals require POSIX `script` + `stty` (Linux/macOS/WSL/Termux); Windows terminals are unsupported.
- `staticDirFor()` deliberately resolves `../web` from the module URL: source runs serve `web/`, builds serve `dist/web/`. Don't replace it with a hardcoded `dist/web`.
- `web/vite.config.ts` patches `os.networkInterfaces()` for sandboxed/container environments; preserve that guard.
- When behavior or CLI docs change, update both `README.md` and `README.zh-CN.md`.
