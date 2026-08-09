# anther

> English | [中文](README.zh-CN.md)

A mobile-first, browser-based code viewer/editor. View and edit code on your server from any browser, designed for mobile experience first (unlike code-server's desktop UI scaling). Supports multi-terminal (PTY), a unified tab bar mixing file and terminal tabs, and auto-reconnect on refresh.

## Install / Run

```bash
# Run directly without installing (auto-downloads)
npx anther

# With a working directory
npx anther /path/to/project

# Custom port
npx anther /path/to/project --port 8080

# Or install globally
npm i -g anther
anther /path/to/project
```

After startup, open `http://localhost:3000` in your browser (the log also prints a LAN address, handy for accessing from your phone or other devices).

## Usage

- Read-only by default (browse mode); click ✎ in the toolbar to switch to edit mode and edit files (writes are governed per request by the `ro` flag — no startup flag)
- Click a file in the activity bar → file tab; click ➕ → terminal tab (bash), multiple can be open; file and terminal tabs mix in one bar
- ✕ on a terminal tab kills its process; typing `exit` inside a terminal auto-closes the tab
- Deep links: `?path=` opens a file, `?term=` connects straight to a terminal (terminals are private per user; foreign URLs are silently ignored)
- Refreshing reconnects the terminal automatically and restores the screen
- No database, no config file; the tab list lives in server memory and is restored from the first visitor's browser snapshot after a restart

## Platform Notes

File browsing/editing is pure Node and cross-platform. **Terminals (PTY) depend on Linux-family tools** (`script`, `stty`):

- Linux desktop / Termux / WSL: full terminal support
- macOS: `script` is syntax-compatible, works
- Windows: file features work, terminal is unavailable

## Development

```bash
npm install
npm run dev                  # one-shot: backend :3000 (--watch) + frontend :5173 (vite, proxies /api)
npm test                     # all tests (node:test, server + web unified)
npm run typecheck            # dual tsc type checks
npm run build                # compile backend + build frontend into dist/
npm pack                     # local packaging (triggers the prepack build, verifies the publish shape)
```

You can also start them separately for debugging: `npm run dev:server` (backend) + `npm run dev:web` (frontend).

## Device Test Checklist

See Appendix A of `docs/superpowers/specs/2026-08-08-anther-design.md`.
