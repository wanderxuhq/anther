# anther

> English | [中文](README.zh-CN.md)

A mobile-first, browser-based web IDE. Run one stateless Node process in a project directory and open the printed URL to browse, edit, preview, search, and run Git or terminal commands from any browser. There is no config file, database, or desktop app to install.

## Features

**Editing**

- CodeMirror 6 editor with on-demand syntax highlighting, find/replace, line-range links, and an independent undo history per file tab.
- Files open read-only by default; switch to edit mode from the toolbar. Edits auto-save with a 1-second debounce, retry on failure, and surface save errors.
- TypeScript/JavaScript completions and type diagnostics through the bundled `typescript-language-server`, with automatic reconnect and restart after crashes.

**Files and search**

- Lazy-loading file tree with reveal-current-file, create/rename/delete, upload files or whole folders (including drag and drop), and ZIP downloads for files or folders.
- Workspace-wide content search streamed over SSE: case sensitivity, excluded directories, results grouped by file, and click-to-jump line navigation.
- File, terminal, Git, and database tabs in one tab bar. File and database tabs are restored after a reload.

**Preview**

- Markdown preview (sanitized, with relative images) and source toggle; when the workspace root contains `.obsidian`, previews also handle Obsidian frontmatter properties, clickable wikilinks and Markdown internal links resolved through a vault index (including aliases and heading/block targets), inline note embeds, callouts, highlights, comments, tag search, footnotes, MathJax math (including mhchem chemistry), and Mermaid diagrams. Image preview with zoom and fit; audio/video with remembered playback position; CSV/TSV table preview.
- PDF reader with page navigation, zoom, outline, and password support; EPUB reader with chapter navigation and embedded outline.
- In-browser archive browsing for ZIP/JAR/WAR/APK/XPI/CBZ and 7z/RAR/TAR/GZ/BZ2/XZ, including nested archives, password-protected entries, read-only entries, and per-file downloads.
- SQLite/SQLite3/DB viewer running in a Web Worker via `sqlite-wasm`: tables and views, schema, indexes and foreign keys, paged rows, sorting, and column filtering.

**Git**

- Working-tree status, stage/unstage, discard (two-step confirmation), commit, amend, fetch/pull/push, and ahead/behind counts.
- Inline diffs, a commit graph (first 1,000 commits), branch creation and checkout, and multi-file diffs for individual commits.

**Terminal**

- Multiple real PTY shells per user. The server owns the VT screen buffer, so terminals survive page reloads and reconnect with scrollback intact.
- Native Windows terminals through ConPTY: pick PowerShell 7 (`pwsh`), Windows PowerShell, or `cmd` when creating a terminal; Linux/macOS/WSL keeps using `bash`.
- Touch scrolling and an on-screen modifier/arrow key bar for mobile input; switch between rendered HTML (clickable paths, Markdown, line wrapping) and plain text.
- Click a file path in terminal output to reveal it in the file tree or open it in the editor.

**Agent**

- Built-in Agent panel at `/_/agent` speaking the Agent Client Protocol (ACP) over stdio.
- The Agent panel exposes a searchable session list through `/resume`. Opening a session adds it to anther's tab bar; other sessions stay out of the tabs.
- New chat opens a draft tab without creating an agent session; the session is created on the first message.
- The first native ACP agent is the local `opencode` CLI (`opencode acp`). It uses OpenCode's own config, login, tools, and session storage; anther does not embed the OpenCode SDK.
- Tool cards, diffs, Markdown, permissions, ACP elicitation forms and consented URL links, model selection, fork/delete, and streaming replies are rendered by anther.
- Built-in Skills installer (`/skills` command) backed by `vercel-labs/skills`: preview a GitHub/git/local source, pick skills and target ACP agents, then install or remove them. Telemetry is disabled.
- ACP client filesystem and terminal capabilities: agents can read/write workspace text files and run non-interactive commands, with live terminal output in tool cards. Agent authentication methods are surfaced in the panel.
- Rich ACP content: images, audio, resource links, and embedded resources render in messages and tool cards. The composer can attach images, audio, and files, gated by the agent's prompt capabilities.
- ACP notices and context compaction render as inline timeline rows; compaction summaries stream and update the same entry in place.
- Per-workspace append system prompt for ACP sessions, sent only when the agent advertises `sessionCapabilities.systemPrompt` support.
- Per-workspace MCP servers for ACP sessions: add stdio/HTTP/SSE servers with `/mcp`, filter unsupported transports by agent capability, and pass them to new and reopened sessions.

**Workspaces and navigation**

- Attach multiple workspace directories to one server; each has its own URL prefix and isolated files, terminals, Git, and LSP state. The `/-` page lists and detaches instances.
- The URL carries navigation state: file and line range, search, Git commit, database table/filter, reading position, theme, font size, and UI language are all shareable and work with browser back/forward.
- Responsive mobile layout with a drawer sidebar, automatic/light/dark themes, and English/Chinese UI selected from the browser language (`?lang=en|zh` overrides it).

## Install / Run

Requires Node.js 22.7+. The built-in Skills installer requires Node.js 22.20+.

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

| Option | Description |
| --- | --- |
| `[dir]` | Workspace directory (defaults to the current directory) |
| `--port <port>` | Port to listen on (default `3000`) |
| `--lan` | Listen on `0.0.0.0` |
| `--host <addr>` | Listen on a specific address |
| `--no-attach` | Do not attach to an anther already serving the port |
| `--detach` | Detach the current directory from the running server and exit |
| `--update` | Update to the latest published version and exit |
| `--feature <spec>` | Load an optional first-party feature package (repeatable; also `ANTHER_FEATURES`) |
| `--shell <shell>` | Default terminal shell: `auto`, `bash`, `pwsh`, `powershell`, or `cmd` (also `ANTHER_SHELL`) |

If the port is already served by anther, running `anther` in another directory attaches that directory to the existing server. Each attached workspace gets its own URL prefix (`/-/<name>/`), and `/-` lists all mounted instances with options to open or detach them. Use `--no-attach` to disable attaching, and `anther --detach` to detach from the command line.

On startup anther checks npm for a newer published version in the background. The check never delays startup, prints only when a newer version exists, and is disabled with `ANTHER_NO_UPDATE_CHECK=1`. `anther --update` upgrades a normal installation; npx runs and source checkouts print the matching command instead.

On Linux, macOS, and WSL, terminals require POSIX `script`, `stty`, and `bash`. On native Windows (10 1809+), anther uses ConPTY through the optional `@wanderxuhq/anther-node-pty` package and starts PowerShell 7, Windows PowerShell, or `cmd`; do not install with `--omit=optional`. `--shell` / `ANTHER_SHELL` sets the default, and the new-terminal menu lets you pick a shell per terminal. Git features require `git` on the server.

After `npm run build`, `npm start` runs the built server. The ⓘ system information dialog can switch the listener between local (`127.0.0.1`) and LAN (`0.0.0.0`) while the server is running; existing terminal and LSP WebSocket connections stay connected.

### Built-in ACP agent

The Agent panel at `/_/agent` is part of anther core. It discovers a native
Agent Client Protocol (ACP) agent automatically, launches it as a child process,
and speaks JSON-RPC over stdio. OpenCode is preferred:

```bash
opencode acp
```

anther searches `PATH` and common install locations, then falls back to other
known native ACP agents (currently Command Code). If none is found, the panel
shows an install/configuration error.

When more than one native ACP agent is available, the panel shows a small agent
selector and remembers the choice per workspace. Each used agent keeps its ACP
process alive, so switching back is immediate after the first switch. Switching
still closes tabs opened against the previous agent; with one agent or none, the
selector stays hidden.

anther uses the agent's own config, login, tools, and session storage. It does
not embed the OpenCode SDK and does not manage provider keys or the agent
database. Configure OpenCode as you normally would (for example
`~/.config/opencode/opencode.json(c)` and `~/.local/share/opencode/opencode.db`).

anther advertises ACP `elicitation.form` and `elicitation.url` support and
renders session-scoped form requests as pending cards. This includes OpenCode's
`question` tool: pick an option or type a custom answer, and the agent continues
the same turn. Session-scoped URL requests show the full address and require
explicit consent before opening the link in a new tab; request-scoped
elicitations are declined, and invalid or non-HTTP(S) URLs are rejected.

The model picker remembers your last explicit choice per workspace and applies
it to new chats with ACP `session/set_config_option`. ACP itself defines the
model per session, so the agent's own config remains the default for sessions
created outside anther.

The Mode selector uses ACP `session/set_mode` or the agent's `mode` config
option and is hidden when fewer than two modes are available. On the new-chat
screen it selects the mode for the next session; inside a session it changes
that session immediately.

The `/resume` command opens a searchable, date-grouped session picker backed by
ACP `session/list`, including every `nextCursor` page. Opening a session adds a
tab and loads its history and config options together, so its model and mode
are restored without a separate request. When the agent supports
`session/resume` but not `session/load`, anther resumes the session without
history replay so it can still be prompted. Closing the tab keeps the session
in `/resume`; it is only removed by the delete action.

ACP `plan` updates are rendered as a persistent checklist in the Agent timeline.
Mode and configuration changes made by the agent are applied to the active
session and to the session list immediately. ACP notices render as inline
status rows, and context compaction updates keep a single timeline entry whose
summary streams in place. Notices are live events and are not replayed when a
session is reopened.

The `/mcp` command opens an MCP server manager. Add stdio, HTTP, or SSE servers
with commands/URLs and environment variables or headers; the list is persisted
in browser storage and synced to the server for this workspace. ACP transports
the selected agent does not advertise are filtered out. MCP changes apply to new
sessions. Sessions created or loaded during this run keep the server set they
were captured with; after a server restart, reopening a session uses the current
list. MCP servers can run commands and receive credentials, and the list
(including env values and headers) is stored in browser storage, so only add
trusted servers.

The `/prompt` command can also set a per-workspace system prompt. When the selected
agent advertises `sessionCapabilities.systemPrompt`, anther appends the prompt
to new sessions and to
sessions loaded later in this run; sessions keep the prompt snapshot they were
created or loaded with. The text is stored in browser storage and sent as ACP
`systemPrompt` with `mode: "append"`.

The composer exposes all non-model/non-mode session config options, including
boolean switches; new-chat draft settings are applied to new sessions.
Permission cards render the options supplied by the agent instead of a fixed
allow-once/always/deny set.

The `/skills` command uses `vercel-labs/skills` to install
reusable agent instructions without leaving anther. Enter a GitHub shorthand,
git URL, or a local path inside the workspace, preview the discovered skills, choose the ACP agents to
install for (OpenCode uses `.agents/skills`, Command Code uses
`.commandcode/skills`), and install. Installed skills can be removed from the
same panel. Installs use strict duplicate/symlink checks, copy files into each
target, update `skills-lock.json`, and disable telemetry. Installed skills also
appear in the `/` menu as `/skill:<id>`; picking one inserts an `@<id>` mention
(OpenCode V2's skill attachment syntax), and `/skill:<id> <task>` sends it
directly.

anther advertises the ACP `fs` and `terminal` client capabilities. Agents can
read and write text files inside the workspace, and run non-interactive commands
through the ACP terminal bridge; live output appears inside the tool card.
Filesystem paths are confined to the workspace. Terminal commands run with the
server user's permissions; their requested `cwd` is resolved and checked against
the workspace, but the commands themselves are not sandboxed.

Rich ACP content blocks are rendered in user messages, agent messages, and tool
cards: images, audio, resource links, and embedded text/blob resources. The
composer can attach up to six images, audio files, or files. Image/audio
attachments are accepted only when the agent advertises the matching prompt
capability; text files are embedded when `embeddedContext` is supported and
otherwise sent as resource links. Unsupported or oversized text files fall back
to resource links. The final prompt JSON is checked against the request body
limit before sending. `@file` workspace mentions are not implemented yet.

Agent authentication methods from `initialize.authMethods` are surfaced in the
panel. Agent-type methods can be completed in place, and `/logout` is available
when the agent advertises it. Terminal-type authentication methods are shown as
unsupported for now.

### Optional features

Other features are separate packages loaded explicitly at startup with
`--feature <spec>` or `ANTHER_FEATURES=<spec,...>`. anther core does not bundle,
install, or scan for them. A package declares one or more panels (route + ESM UI
bundle), registers workspace API routes, and receives its own directory through
the anther-owned state API. A feature can also publish document tabs and actions
for anther's main toolbar. State lives under `~/.anther` by default; set
`ANTHER_STATE_DIR` to override it.

## Security

The server has no authentication or authorization. Anyone who can reach the port can read and write workspace files, browse archives, run Git commands, and open interactive shells through terminals. Read-only mode is a frontend/editor mode only; it does not restrict the server API. Bind to loopback unless you trust the network, or add authentication at a reverse proxy. Workspace path access is confined to the served directories, including checks against symlink escapes.

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

Both the backend and Vite listen only on the local machine by default. To try it from a phone on the LAN, run `npm run dev -- --lan` (or `--host 0.0.0.0`), which applies to both. Vite proxies `/api` to `127.0.0.1:3000`; it also proxies feature bundles and feature APIs under `/_/<panel>/`. If you change the backend port, update the proxy target in `web/vite.config.ts`.

## License

MIT
