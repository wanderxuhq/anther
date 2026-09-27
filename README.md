# anther

> English | [中文](README.zh-CN.md)

A mobile-first, browser-based code viewer/editor. View and edit code on your server from any browser, designed for mobile experience first (unlike code-server's desktop UI scaling). Supports multi-terminal (PTY), a unified tab bar mixing file and terminal tabs, and auto-reconnect on refresh.

## Install / Run

```bash
# Run directly without installing (auto-downloads)
npx @wanderxuhq/anther

# With a working directory
npx @wanderxuhq/anther /path/to/project

# Custom port
npx @wanderxuhq/anther /path/to/project --port 8080

# Or install globally
npm i -g @wanderxuhq/anther
anther /path/to/project
```

After startup, open `http://localhost:3000` in your browser (the log also prints a LAN address, handy for accessing from your phone or other devices).

## Usage

- Read-only by default (browse mode); click ✎ in the toolbar to toggle edit mode — read-only only controls whether the editor accepts input, it is purely client-side and never gated by the server
- Choose **Upload file** from **New** or a file-list ⋯ menu to upload into the corresponding directory. There is no added file-size or file-type restriction; an existing file with the same name is never overwritten.
- Markdown files, including README files, render by default in read-only mode using marked.js and DOMPurify. Use the toolbar icon to switch between source and preview; entering edit mode shows the source.
- The Git toolbar has icons for changes, history, branches and refresh. Use the changes icon beside history to return to the pending changes list.
- On desktop, the file list and editor scroll independently.
- The download icon beside ✎ downloads the original file with its filename and bytes preserved. Pending edits are saved first; downloads have no added size or file-type limit. Resuming and concurrent downloads of separate ranges are supported.
- Choose **Download** in a file-list ⋯ menu: files download directly, while folders are prepared as temporary ZIPs. An unchanged folder reuses its cached ZIP. Additions, deletions, renames or edits create a new archive; existing downloads keep their original snapshot.
- Click a file in the activity bar → file tab; click ➕ → terminal tab (bash), multiple can be open; file and terminal tabs mix in one bar
- ✕ on a terminal tab kills its process; typing `exit` inside a terminal auto-closes the tab
- Deep links: `/src/main.ts` opens a file, `/?term=t_…` connects straight to a terminal (terminals are private per user; foreign URLs are silently ignored)
- Refreshing reconnects the terminal automatically and restores the screen
- No database, no config file; the tab list lives in server memory and is restored from the first visitor's browser snapshot after a restart

## Downloads

Download URLs use `/api/download?path=<URL-encoded relative file path>` and can be used directly by download managers supporting HTTP Range. The endpoint supports HEAD, single and multiple ranges, and provides Accept-Ranges, Content-Range, ETag, and Last-Modified headers. If-Range / If-Match with the ETag validate the file version when resuming. Date-only If-Range requests return the complete file because workspace files can change multiple times within a second.

For folders, POST `{"path":"relative/folder"}` to `/api/download/prepare`, poll `/api/download/status?id=...` with the returned ID, and download from the returned `url` once ready. The ZIP URL supports the same HEAD, resume and parallel-range requests. Cache validation checks every entry's path, size, nanosecond timestamps, file identity and permissions before reusing an unchanged archive.

Archives are compressed file by file into the system temporary directory, with automatic ZIP64 support for sizes above 4 GiB and large entry counts. File contents and ZIP output are streamed; entry metadata still takes memory. Up to two archives are compressed concurrently, with at most eight preparation jobs accepted. Temporary disk space must accommodate the compressed archive; space is checked during writing and failures clean up partial output. Nested symbolic links are stored as links without traversing them. Detected source changes during preparation cause an error so the download can be retried.

Once the server has sent the entire ZIP (including coverage across Range requests), cleanup occurs about one minute after the last request finishes. Incomplete or unused archives expire after about 30 minutes idle. Cleanup runs every 30 seconds and skips active builds and transfers. Normal shutdown removes the cache; subsequent archive preparation and cleanup also remove expired leftovers from exited processes. Expired URLs return 410 and require preparation again. A deleted ZIP must be compressed again even if its folder is unchanged.

## URL state

Direct links, refresh, and browser Back/Forward restore the corresponding view. Linked files do not need to be in the tab list already. Default values are omitted.

| State | Example |
| --- | --- |
| Edit mode, theme, font size | `/src/main.ts?ro=0&theme=dark&fs=110` (defaults: read-only, system theme, 100%) |
| Line / line range | `/src/main.ts?line=42`, `/src/main.ts?line=42-50` (1-based, inclusive) |
| Git changes / branch management | `/-/git`, `/-/git/branches` |
| File diff | `/-/git/diff/src/main.ts` |
| History and branch filter | `/-/git/history?branch=main` (filters history; does not check out a branch) |
| Commit | `/-/git/commit/abc1234` (short or full hash) |
| Sidebar | `/?panel=tabs`, `/?panel=search` (defaults to the file tree) |
| Search | `/?panel=search&q=TODO&case=1&exclude=dist` |
| Language | `?lang=zh`, `?lang=en` (browser language when omitted) |

Parameters can be combined, for example `/src/main.ts?lang=zh&line=42&panel=search&q=TODO`. Search is case-insensitive by default and excludes `.git,node_modules,dist`; `exclude=` excludes no directories. Typing and cursor movement replace the current history entry; file, main view, and sidebar navigation create new entries. Markdown source/preview switching is not stored in the URL.

`panel` only records the selected sidebar tab; refresh and Back/Forward do not automatically open the mobile drawer. Restoring a link removes paths and parameters that do not apply to its view, such as file paths, line numbers, and commit hashes on the history page, without adding a history entry.

Git routes use the reserved `/-/git` namespace. `/git/history` still opens a regular file. Files whose paths start with `-/` use an explicit file route: `-/git/history` becomes `/-/file/-/git/history`. The old `view` and `commit` query parameters are no longer interpreted.

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
