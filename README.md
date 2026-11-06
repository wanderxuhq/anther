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
- Upload files or whole folders from **New** or a file-list ⋯ menu. Select several files at once, or drag files and folders from your desktop onto the tree; dropping on a folder uploads into it. There are no added size or type restrictions, and existing files are not overwritten.
- Use the Git toolbar to switch between pending changes, history, and branch management. The changes panel stages and unstages files, discards changes, amends the last commit, and runs fetch/pull/push with ahead/behind status. Pull is fast-forward only.
- Files, database objects, and terminals share a tab bar, with independent tabs for each. Refreshing reconnects terminals; closing a terminal tab ends its process. On touch screens the terminal shows a key bar with Esc, Tab, arrows and Ctrl combinations.
- The terminal renders as HTML by default: file and directory paths in output are clickable and open the existing file preview (full screen on phones, in the main pane on desktop), and Markdown output is rendered with the project's Markdown viewer. Use the **HTML / Text** switch in the terminal toolbar to return to the classic plain-text grid; switching only changes rendering, never the shell session, scrollback, or running process. The preview close button returns to the terminal.
- Click ⓘ at the bottom of the drawer for server information: host, OS, CPU, memory, disk, uptime, Node.js and Anther versions, and the workspace path. The dialog can refresh in place.
- On desktop, the file list and editor scroll independently.

## Detection API

`GET /api/anther` is an anther-specific endpoint for launchers, probes and integrations:

```json
{
  "name": "anther",
  "package": "@wanderxuhq/anther",
  "version": "0.1.5",
  "apiVersion": 1,
  "workspace": "/path/to/workspace",
  "instanceId": "0f9c…",
  "startedAt": 1760000000000
}
```

It returns identity and instance context only, not host or hardware details. A launcher can use `name`/`apiVersion` to recognize anther, and `workspace` to check whether a port that is already in use belongs to the same workspace before reusing that instance.

## File previews

| Type | Features |
| --- | --- |
| Text and code | Syntax highlighting, search, editing |
| Markdown | Rendered by default in read-only mode; source toggle and relative image paths; heading outline in the file tree |
| Images | Common browser image formats; zoom, pan, wheel and pinch gestures; SVG source editing |
| PDF | Continuous scrolling, page jumps, zoom, pinch gestures, text selection; embedded outlines in the file tree and reader toolbar |
| EPUB | Continuous chapter scrolling, chapter jumps, zoom and pinch gestures; contents in the file tree and reader toolbar |
| Audio and video | Playback and seeking; format support depends on the browser |
| CSV / TSV | Table preview, source toggle, editing; preview limited to 1,000 rows and 100 columns |
| SQLite | Expand tables and views in the file tree; separate data and structure tabs; read-only pagination, sorting, and filtering |
| ZIP / 7z / RAR / TAR / GZ / BZ2 / XZ | Expand in the file tree, preview or download entries, open nested archives |

Binary files without a supported preview can be downloaded.

EPUB 2/3 reflowable books are read in the browser using the existing ZIP library, including inside archives. Chapters and local images/styles are loaded on demand. DRM and fixed-layout books are not supported; obfuscated fonts use fallback fonts. Book scripts and remote resources are disabled.

SQLite preview runs locally in a browser Worker using official SQLite WASM; the server only transfers the file. Opening a database downloads it into browser memory, and refresh loads a new copy. Large databases are limited by available browser memory. Workspace and archive-entry databases, including nested archives, share the same table tree, tabs, and previews. Encrypted databases and WAL-mode files are not supported; export a standalone snapshot in DELETE journal mode for preview. Tables show up to 200 columns, with shortened previews for long text and BLOBs; slow queries can be cancelled or time out. Downloads return the original file, not a consistent snapshot of a live WAL database.

Archives are processed in the browser, with files extracted when opened or their outlines expanded. PDF, EPUB and Markdown entries also provide file-tree outlines and chapter navigation, including inside nested archives; Reader outlines remain available. The defaults are 3 levels of nesting including the outer archive and a 128 MiB budget for cached archives and extracted output, adjustable in archive settings. This budget is not a limit on total browser memory; large files may exceed available memory. Text previews inside archives read up to 1 MiB; downloads contain the full file.

## Downloads

Click the download icon beside the pencil or choose **Download** from a file-list ⋯ menu. Files download directly; folders download as ZIPs using store-only mode for faster preparation. Preparation shows scanning, packing, and verification progress.

- Workspace files and folder ZIPs support resuming and parallel range downloads. File URLs use `/api/download?path=<URL-encoded relative path>` and work with download managers supporting HTTP Range.
- Folder ZIPs are stored temporarily on the server, support archives over 4 GiB, and require enough temporary disk space. An unchanged folder reuses its ZIP while the cache remains available.
- Temporary ZIPs are removed about one minute after a complete transfer, or after about 30 minutes idle if incomplete or unused. Downloads must be prepared again after cleanup.
- Downloading an archive entry requires browser-side extraction and is subject to the extraction budget. These downloads do not support resuming or parallel downloads through external download managers.

## URL state

Links preserve the current file, Git view, and display settings across refresh and browser Back/Forward navigation.

All file positions and preview states use `#field:value;field:value`. Field order does not matter, the last duplicate wins, unknown or invalid fields are ignored, and default settings are omitted. Delimiters and special characters inside values are percent-encoded. Resource identity, database filters and global settings remain query parameters.

| State | Example |
| --- | --- |
| File, line, or selection | `/src/main.ts#line:42`, `/src/main.ts#line:42-50` |
| EPUB position / zoom | `/book.epub#lbp:2@1/3%2342;zoom:125` |
| PDF page / page coordinates | `/manual.pdf#page:7;x:0;y:600` |
| Markdown heading | `/README.md#heading:3` |
| Image zoom / center | `/image.png#zoom:200;x:0.7;y:0.3` |
| Media time / speed | `/movie.mp4#time:90.5;rate:1.5` |
| CSV/TSV position / details | `/data.csv#at:30;across:4;row:35;expanded:1`, `/data.csv#row:20;column:3` |
| Edit mode, theme, font size | `/src/main.ts?ro=0&theme=dark&fs=110` |
| Git changes / branches | `/-/git`, `/-/git/branches` |
| File diff | `/-/git/diff/src/main.ts` |
| History / commit | `/-/git/history?branch=main`, `/-/git/commit/abc1234` |
| Sidebar / search | `/?panel=tabs`, `/?panel=search&q=TODO&case=1&exclude=dist` |
| Archive entry / nested archive | `/books.zip?entry=readme.md`, `/books.zip?inside=inner.zip&entry=readme.md` |
| Archive database | `/-/database/data.zip?inside=inner.zip&entry=app.db&object=users` |
| Database table / structure | `/-/database/app.db?object=users`, `/-/database/app.db?object=users&mode=structure` |
| Database filter / sort / page | `/-/database/app.db?object=users&filter=name&value=Alice&sort=id&order=desc#offset:100` |
| Terminal | `/?term=t_…` |
| Language | `?lang=zh`, `?lang=en` |

Parameters can be combined. Defaults are read-only mode, system theme, browser language, and 100% font size. Search is case-insensitive and excludes `.git,node_modules,dist`. The `panel` parameter saves the selected sidebar tab; refreshing does not open the mobile drawer.

Reading updates replace the current URL without adding history entries for continuous scrolling. Positions survive refresh, sharing and Back/Forward, including documents inside archives. EPUB reuses [Leaf Reader](https://github.com/wanderxuhq/leaf-reader)'s LBP coordinates: `spineIndex@elementPath#UTF-16Offset`, with zero-based indices; the URL path and archive parameters identify the book. Text coordinates survive changes in viewport width; edited content may fall back to an ancestor element or chapter start. `zoom` is a reader percentage; omitting it fits PDF to width and uses 100% for EPUB. Markdown records the current heading, without persisting the source/rendered toggle.

Git uses the `/-/git` route. File paths starting with `-/` use the `/-/file/` prefix, for example `/-/file/-/git/history`.

Image `x/y` specify the center as fractions of the original dimensions (0–1); omitting `zoom` fits the window. Media `time` is in seconds; restoration leaves playback paused. Table `at/across` identify the first visible row/column, and `row/column` identify inspected data, all one-based; `expanded:1` expands row details. SQLite uses the same table parameters, plus a result `offset` and an optional `cursor` for sequential paging. These states and text `line` selections also work inside archives.

## Platform notes

File browsing and editing work across platforms. Terminals require `script` and `stty`: Linux, Termux, WSL, and macOS are supported; Windows terminals are unavailable.

Git sync uses your existing git configuration. Interactive credential prompts are disabled, so configure an SSH agent, a credential helper, or an HTTPS token before pushing over the network.

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
