# anther

> English | [中文](README.zh-CN.md)

A mobile-first code viewer and editor for the browser. Manage files, preview documents, use Git, and run multiple terminals in a server workspace from your desktop or phone.

## Install / Run

```bash
# Run directly in the current directory
npx @wanderxuhq/anther

# Choose a directory and port
npx @wanderxuhq/anther /path/to/project --port 8080

# Or install globally
npm i -g @wanderxuhq/anther
anther /path/to/project
```

Open `http://localhost:3000` by default. The startup log also shows a LAN address.

## Usage

- Files open read-only. Click the pencil icon in the toolbar to edit.
- Upload files from **New** or a file-list ⋯ menu. There are no added size or type restrictions, and existing files are not overwritten.
- Use the Git toolbar to switch between pending changes, history, and branch management.
- Files, database objects, and terminals share a tab bar, with independent tabs for each. Refreshing reconnects terminals; closing a terminal tab ends its process.
- On desktop, the file list and editor scroll independently.

## File previews

| Type | Features |
| --- | --- |
| Text and code | Syntax highlighting, search, editing |
| Markdown | Rendered by default in read-only mode; source toggle and relative image paths; heading outline in the file tree |
| Images | Common browser image formats; zoom, pan, wheel and pinch gestures; SVG source editing |
| PDF | Continuous scrolling, page jumps, zoom, pinch gestures, text selection; embedded outlines in the file tree and reader toolbar |
| Audio and video | Playback and seeking; format support depends on the browser |
| CSV / TSV | Table preview, source toggle, editing; preview limited to 1,000 rows and 100 columns |
| SQLite | Expand tables and views in the file tree; separate data and structure tabs; read-only pagination, sorting, and filtering |
| ZIP / 7z / RAR / TAR / GZ / BZ2 / XZ | Expand in the file tree, preview or download entries, open nested archives |

Binary files without a supported preview can be downloaded.

SQLite preview requires Node.js 24+ and supports workspace files. Encrypted databases and databases inside archives are not supported. Tables show up to 200 columns, with shortened previews for long text and BLOBs; slow queries can be cancelled or time out. Downloads return the original file, not a consistent snapshot of a live WAL database.

Archives are processed in the browser, with files extracted when opened or their outlines expanded. PDF and Markdown entries also provide file-tree outlines and chapter navigation, including inside nested archives; PDF reader outlines remain available. The defaults are 3 levels of nesting including the outer archive and a 128 MiB budget for cached archives and extracted output, adjustable in archive settings. This budget is not a limit on total browser memory; large files may exceed available memory. Text previews inside archives read up to 1 MiB; downloads contain the full file.

## Downloads

Click the download icon beside the pencil or choose **Download** from a file-list ⋯ menu. Files download directly; folders download as ZIPs using store-only mode for faster preparation. Preparation shows scanning, packing, and verification progress.

- Workspace files and folder ZIPs support resuming and parallel range downloads. File URLs use `/api/download?path=<URL-encoded relative path>` and work with download managers supporting HTTP Range.
- Folder ZIPs are stored temporarily on the server, support archives over 4 GiB, and require enough temporary disk space. An unchanged folder reuses its ZIP while the cache remains available.
- Temporary ZIPs are removed about one minute after a complete transfer, or after about 30 minutes idle if incomplete or unused. Downloads must be prepared again after cleanup.
- Downloading an archive entry requires browser-side extraction and is subject to the extraction budget. These downloads do not support resuming or parallel downloads through external download managers.

## URL state

Links preserve the current file, Git view, and display settings across refresh and browser Back/Forward navigation.

| State | Example |
| --- | --- |
| File, line, or selection | `/src/main.ts?line=42`, `/src/main.ts?line=42-50` |
| Edit mode, theme, font size | `/src/main.ts?ro=0&theme=dark&fs=110` |
| Git changes / branches | `/-/git`, `/-/git/branches` |
| File diff | `/-/git/diff/src/main.ts` |
| History / commit | `/-/git/history?branch=main`, `/-/git/commit/abc1234` |
| Sidebar / search | `/?panel=tabs`, `/?panel=search&q=TODO&case=1&exclude=dist` |
| Archive entry / nested archive | `/books.zip?entry=readme.md`, `/books.zip?inside=inner.zip&entry=readme.md` |
| Database table / structure | `/-/database/app.db?object=users`, `/-/database/app.db?object=users&mode=structure` |
| Terminal | `/?term=t_…` |
| Language | `?lang=zh`, `?lang=en` |

Parameters can be combined. Defaults are read-only mode, system theme, browser language, and 100% font size. Search is case-insensitive and excludes `.git,node_modules,dist`. The `panel` parameter saves the selected sidebar tab; refreshing does not open the mobile drawer.

Git uses the `/-/git` route. File paths starting with `-/` use the `/-/file/` prefix, for example `/-/file/-/git/history`.

## Platform notes

File browsing and editing work across platforms. Terminals require `script` and `stty`: Linux, Termux, WSL, and macOS are supported; Windows terminals are unavailable.

## Development

```bash
npm install
npm run dev          # backend :3000, frontend :5173
npm test
npm run typecheck
npm run build        # output in dist/
npm pack
```

The backend and frontend can also run separately with `npm run dev:server` and `npm run dev:web`.
