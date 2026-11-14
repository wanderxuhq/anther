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

TypeScript runs directly with Node's type stripping, so tests/dev need Node 22.7+ for `--experimental-transform-types` (this repo is developed on Node 24). The `skills` dependency and its tests require Node 22.20+. All relative imports use explicit `.ts`/`.tsx` extensions, including frontend code.

## Layout

- `server/cli.ts` — real entrypoint: parses `[dir] --port`, builds the workspace and mount registry, starts the HTTP server, and prints startup URLs. Register per-workspace route modules in `server/workspace.ts`.
- `server/http.ts` — hand-rolled router. Routes match exact pathnames (no `:params`); helpers are `get`/`put`/`post`, `postBinary` (raw body, no 1 MB JSON cap), `getStream`, `sse`, `ws`. Unknown `/api/*` returns JSON 404; other GETs fall back to `index.html`, or redirect to `/-` when the host is detached or the mount is unknown.
- `server/files.ts` (`FileStore`) — the only layer for workspace file access; confines paths to the workspace and rejects `..`/absolute paths. Route code must go through it. Temporary archive caches and host-level system info use `fs` directly.
- `server/routes/*.ts` — HTTP/WS feature routes; adjacent top-level server files implement git, PTY terminals, LSP, ACP agents (`agent.ts`, with elicitation mapping in `agent-forms.ts`, session pagination in `agent-session-list.ts`, ACP client filesystem in `agent-fs.ts`, and ACP client terminals in `agent-terminal.ts`), the skills installer (`skills.ts`, backed by `vercel-labs/skills`), archives, downloads, previews, and the in-memory tab store.
- `web/src/App.tsx` — root component; `views/` outer panes; `components/` UI; `stores.ts` global signals; `api.ts` fetch/WS client; `url-state.ts` URL parse/serialize; `agent/` is the built-in ACP agent panel; `database/`, `readers/`, and `archive*.ts` are browser-side preview engines.
- `bin/anther.js` — published CLI shim into built `dist/server/cli.js`.

## Conventions that are easy to get wrong

- The frontend is **SolidJS**, not React. Use `createSignal`, `createMemo`, `Show`, `For`, `on`/`onCleanup`; JSX is compiled by `vite-plugin-solid`.
- Every user-visible string goes through `t()` in `web/src/i18n.ts`, with keys added to **both** `en` and `zh`. Unknown keys render as the key itself.
- URL is the source of navigation state. Extend `parseUrl`/`serializeUrl` in `web/src/url-state.ts` (and `url-fragment.ts` for `#field:value`) and keep round-trip/leak tests.
- `/-` (and `/-/`) is the instances list page; `/-/<name>/...` is the workspace-mount namespace; `/_/` is the frontend's internal route namespace (`/_/git`, `/_/file/`, `/_/database/`). URL parsing/serialization and API/WS URLs are base-aware via `web/src/base.ts`.
- `/api/anther` is read-only identity. Attaching is a loopback-only `POST /api/anther/attach`; `--no-attach` disables it. Do not expose the attach route to LAN clients. Detaching is `POST /api/anther/detach`, used by `anther --detach` and the `/-` page; the host mount can also be detached.
- Tests are colocated `*.test.ts` using `node:test` + `node:assert/strict`. Web tests also run under Node, which cannot parse `.tsx`/JSX: put testable logic in `.ts` modules, and use `jsdom` explicitly for DOM-dependent tests. `web/tsconfig.json` excludes tests, so typecheck does not cover them.
- Server writes are intentionally **not** read-only-gated; read-only is a frontend/editor mode (see the comment in `server/routes/fs.ts`). Don't add server-side `ro` checks unless the behavior is deliberately changing.
- Keep the server stateless: tabs, terminals, heartbeat state, and pending skill source previews are in memory, with no config/db/session/log files. Browser persistence is limited to a few localStorage keys (user id, file-tab snapshot, database-tab snapshot, archive limits, terminal render mode, terminal key bar open state, agent model preference, agent runtime preference, MCP server config).
- The skills installer loads `skills` lazily (it requires Node 22.20+) and must pass `telemetry: false` on install/remove. Use project scope, `mode: 'copy'`, `symlinks: 'reject'`, and `duplicates: 'error'`. Derive install targets from anther's ACP discovery (`agent-profiles.ts`), not `detectAgents()` alone; local source paths must stay inside the workspace. Installs write agent skill directories plus `skills-lock.json`; previews expire and are disposed with the workspace.
- ACP client capabilities: `agent-fs.ts` implements `fs/read_text_file` and `fs/write_text_file`; `agent-terminal.ts` implements the five `terminal/*` methods for non-interactive commands. Both confine requested paths/cwd to the session root; terminal commands still run with server permissions and are not sandboxed. Terminal output is emitted through `terminal_output` agent events and rendered from `ToolItem.terminalIds`; don't put raw control sequences in the DOM. Agent authentication supports agent-type `authenticate`/`logout`; terminal-type auth is not implemented, so do not advertise `clientCapabilities.auth.terminal`.
- ACP session config options: the composer renders generic select/boolean options in addition to model and mode. Boolean `session/set_config_option` requests must include `type: 'boolean'` and advertise `clientCapabilities.session.configOptions.boolean`. Permission replies send the agent's exact `optionId`; never re-map option kinds to local allow/deny decisions.
- ACP rich content: `web/src/agent/content.ts` parses non-text blocks for messages/tool cards; `web/src/agent/attachment.ts` maps composer attachments to prompt blocks. Image/audio attachments are gated by `promptCapabilities`; text files use embedded resources only when `embeddedContext` is advertised. Keep attachments under the 1 MB JSON body cap. `@file` workspace mentions are not implemented.
- ACP MCP servers: `server/mcp.ts` validates configs, `AcpAgent` keeps the workspace list in memory, and `AgentRuntime` filters HTTP/SSE by `mcpCapabilities` and injects the list into new/load/fork/bootstrap sessions. The browser persists the list in localStorage and syncs it before status on initialize; changes invalidate only an unused bootstrap and apply to new sessions. MCP commands run with server permissions; UI must keep the trust warning.
- Terminal rendering lives in `web/src/terminal/`; `shared/terminal/vt.ts` is the in-repo VT parser/screen buffer, and `views/terminal.tsx` owns the DOM/HTML renderer. Keep the HTML/plain-text switch render-only: it must never reset the PTY, screen buffer, or WebSocket. Don't reintroduce xterm.
- `/api/anther` is the public detection API (`server/app-info.ts`); only change `apiVersion` for incompatible changes. `/api/system` exposes host/hardware details.
- Git shells out to the real `git` via `execFile` (no shell) and inherits the user's git config. Tests create temporary repos, so `git` must be installed. Terminals require util-linux `script`, GNU `stty`, and `bash`; Linux/WSL provide them, Termux and macOS may need them installed, and Windows uses WSL.
- `staticDirFor()` deliberately resolves `../web` from the module URL: source runs serve `web/`, builds serve `dist/web/`. Don't replace it with a hardcoded `dist/web`.
- `web/vite.config.ts` patches `os.networkInterfaces()` for sandboxed/container environments; preserve that guard.
- When behavior or CLI docs change, update both `README.md` and `README.zh-CN.md`.
