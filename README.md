# Code Colony

A live, game-like top-down map of your codebases. Packages become bands, modules become blocks and files become squares on one grid; zoom in continuously, like a web map, down to individual functions. Overlay lenses show the network, change heat, external systems and data access, and the coding agents working on the code appear on the map next to the build queue.

Inspired by Oxygen Not Included and Factorio. Early work in progress.

## Run it

Requires Node 24+ and pnpm.

```bash
pnpm install
pnpm dev               # http://127.0.0.1:4320, with hot reload
pnpm dev:no-herdr      # the same, with the terminal dock's Herdr switched off
pnpm start             # builds the page, then serves it
```

Automated runs (tests, validation pipelines, screenshot tools) must start the app with Herdr off: `pnpm dev:no-herdr`, `--no-herdr` or `CODECOLONY_HERDR=off`. Otherwise the dock attaches to your live Herdr session and resizes its panes. Herdr is off by default when `CI` is set.

Out of the box it maps its own checkout. `pnpm index` indexes the configured projects once and prints a summary; `pnpm index --relayout` also lays the map out afresh instead of keeping the saved order of modules and files.

The server prints the page's URL with a fresh token for this run, `http://127.0.0.1:4320/#token=...`; open that exact URL. The token sits in the URL fragment, so it is never sent to the server or logged, and the page keeps it for the tab and strips it from the address bar.

The server listens on loopback only and answers 403 to any request whose host is not `127.0.0.1`, `localhost` or `[::1]`. Set `PORT` to use another port.

## Terminal dock

The right panel's Terminal tab runs the real [Herdr](https://herdr.dev) client in the page (xterm.js over node-pty and a WebSocket), filling the whole tab: Herdr's own sidebar lists the agents and switches between them, and the tab title counts them. The dock needs `herdr` on your `PATH`; without it the terminal shows the client's exit (for example `[herdr exited with code 1]`), a bar above the terminal says "Disconnected" with a Reconnect button, and the rest of the app keeps working. While the terminal is connected but the Herdr socket cannot be reached, that bar says "Workers unavailable" instead.

| Flag                     | Environment                | Default                                            |
| ------------------------ | -------------------------- | -------------------------------------------------- |
| `--herdr-session <name>` | `CODECOLONY_HERDR_SESSION` | Herdr's default session                            |
| `--herdr-socket <path>`  | `CODECOLONY_HERDR_SOCKET`  | the session's `herdr.sock` under `~/.config/herdr` |
| `--herdr-bin <path>`     | `CODECOLONY_HERDR_BIN`     | `herdr`                                            |
| `--herdr-lab`            | `CODECOLONY_HERDR_LAB=1`   | off                                                |
| `--no-herdr`             | `CODECOLONY_HERDR=off`     | on, or off when `CI` is set                        |

Pass flags after the script name, for example `pnpm dev --herdr-session work`. Lab mode, for experiments, attaches only to sessions named `fm-lab-*` and refuses any other session.

With Herdr off, the dock never starts the Herdr client or opens its socket: the panel says "Herdr is disabled for this run", the terminal and Herdr routes answer 503, and the rest of the app works as usual. `--no-herdr` wins over the environment, and `CODECOLONY_HERDR=on` turns Herdr back on under CI. Any automated run must use it, so it never touches your live session.

Herdr shares its panes between all attached clients and sizes them to the client that most recently attached or sent input, so the last one wins. When the dock and another Herdr client (another tab, or a terminal) are both attached, the panes take the other client's size until the dock is used again. This is accepted for v1: there is no single-client limit or deferred sizing.

The terminal WebSocket, the dock's `/api/dock/*` routes and the source text at `/api/file` need the token, a loopback `Host` and, when the browser sends one, a matching `Origin`. Every response carries a strict Content-Security-Policy, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. Terminal data is never logged.

## Configuration

Code Colony reads the projects to map from a local file that is never committed: `codecolony.config.json` at the repository root (gitignored), or the file named by the `CODECOLONY_CONFIG` environment variable. Without one, it maps its own checkout.

```json
{
  "projects": [
    { "name": "my-monorepo", "root": "~/code/my-monorepo", "kind": "monorepo" },
    { "name": "my-org", "root": "~/code/my-org", "kind": "repos" }
  ]
}
```

- `kind`: `repo` (one repository, the default), `repos` (a folder of repositories) or `monorepo` (one repository with workspace packages).
- Relative paths resolve against the config file's folder; `~` is your home folder.
- `cacheDir` (optional): where index data is cached, outside your repositories. Defaults to `~/.cache/codecolony`.
- `firstmateHome` (optional): a [firstmate](https://github.com/kunchenguid/firstmate) home whose orders fill the Build queue. Code Colony only reads it: the backlog (`data/backlog.md`) and each worker's `state/<id>.meta` and `state/<id>.status`. Without it the Build queue says it is not connected. Colonists then also carry their firstmate task, status line and pull request, and firstmate's clones under `projects/` count as copies of your repositories.

See `codecolony.config.example.json`.

## Using the map

The page has a header (project picker, search, map controls), the map, and a side panel on each side. The left panel holds the Build queue, the Legend and a Files tree; the right panel holds the Terminal, the File tab (the selected file, read only, as committed at the indexed commit) and the Inspector. Drag a panel's edge to resize it; widths, collapsed panels and the open tabs are remembered in the browser.

The Build queue lists the firstmate orders for the projects on the map in three sections, as in VS Code's Source Control view: Active (waiting on you, blocked, PR ready, working; an order held for you waits on you whatever its worker last said), Queued and Done. Each section folds, scrolls on its own and is remembered open or closed. A card shows the order's state, its worker (the colonist), the worker's latest status, a link to its pull request and, while the worker has a copy, Show on map, which flies to the files it changed. The queue refreshes every few seconds.

| Input                    | Action                                                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scroll, pinch, `+` / `-` | Zoom smoothly at the cursor; detail fades in and out as you zoom                                                                                                          |
| Drag, arrow keys         | Pan                                                                                                                                                                       |
| Hover                    | Show the dependencies of the module, file or closed block under the pointer; with an overlay on, highlight them. While something is selected, only show its name and kind |
| Click                    | Select and keep the highlight; the Inspector lists facts, then imports, calls and HTTP requests in and out, with how each was proven. Click empty map to clear            |
| `⌘`-click / `Ctrl`-click | Add a block or file to the selection, or take it out; the connections of everything selected show together and the Inspector sums them up                                 |
| Double-click             | Fly into a block or file; on a file or symbol, also show it in the File tab                                                                                               |
| `Home`                   | See everything                                                                                                                                                            |
| `Esc`                    | Clear the selection                                                                                                                                                       |
| `⌘K` / `Ctrl+K`          | Search files and symbols by name; Enter flies to the result and selects it, Shift+Enter opens its file                                                                    |
| `[` / `]`                | Collapse or expand the left / right panel                                                                                                                                 |

By default the map shows only module blocks and file squares. Overlays draw connections over it, switched on from Overlays in the header; Dependency, the first, draws imports as arrows from the importing module to the imported one. The arrows run through the gutters between blocks, never across them, in lanes on the grid one unit apart, so they never overlap and only cross at right angles. Gutters widen, up to 8 units, to fit their lanes; in a gutter that is still full, arrows to the same module share a lane. Zoomed out, arrows join at the folders, packages and repositories you can see. Zoomed in, once a grid unit is 12 px wide, the modules on screen open and arrows run between their files, in the 1-unit streets around each file, half a unit apart.

With no overlay on, hovering a module or file shows its dependencies; with one on, all of them show and hovering highlights the module's own. Once something is selected, hovering leaves its highlight alone and only shows the name and kind of the block under the pointer, so you can pan along its connections; `⌘`-click (`Ctrl`-click off a Mac) selects several at once. The Inspector lists connections as Imports / Imported by, Calls / Called by, and HTTP requests / HTTP routes served, by route, with how each was proven. "Trace calls with the language server" proves the calls of a file's functions, including method calls the parser cannot resolve.

### Colonists

A colonist is a coding session at work in a copy of a mapped repository: a clone or worktree with the same origin (firstmate's worktrees, your own clone) whose files differ from its main branch. Its diff is taken from where the copy forked, committed and uncommitted changes plus new files, so a copy parked on an old commit is not a colonist. Sub-agents work in their parent's copy and never add one.

Each colonist is a robot in the roster at the top right, coloured by status: blue working (its robot bobs) or paused, amber waiting on you (also a firstmate task the backlog holds for you, live session or not; its pins pulse), red blocked or failed, green with a pull request ready, and grey with changes but no live session. On the map, every file it touches carries a pin in that colour with its initials, and gets a dashed outline: blue modified, red removed, and a green placeholder square in the target folder for each added file (one dashed box for a new folder; an added file with no room for a placeholder gets its pin on the folder). Every file keeps its own pin at every zoom, so a colonist's pins match its file list one for one. Zoomed out, a closed folder holding changes gets one outline. When two or more colonists change the same file in different copies, their pins sit side by side with a pink possible-conflict badge; clicking the badge selects the file, and the Inspector lists the colonists changing it. Clicking a pin picks its colonist (double-click also frames it); clicking a roster entry picks it and frames all its pins. A picked colonist's pins stand out while the others dim, and its card in the Inspector shows task, session, copy, branch, pull request and every file in its diff.

Live sessions are found by the `claude`, `codex`, `opencode`, `gemini` and `cursor-agent` processes working in a copy, and, with Herdr on, by Herdr's agents, which also tell when a session waits on you and let Open terminal focus its pane. The colonists refresh every few seconds; nothing is ever written to the copies.

The map updates live: commit to a mapped repository and it redraws within a few seconds. A repository created in place inside a mapped folder of repositories can take up to a minute to appear.

## Languages

TypeScript and JavaScript are supported today, through tree-sitter and `typescript-language-server`. Languages plug in as adapters: a tree-sitter grammar with three queries, plus any language server that speaks LSP over stdio. See [ARCHITECTURE.md](ARCHITECTURE.md) for how to add one.

## Layout

- `apps/colony`: the app. A Node server (`src/server`) and a Vite-built page (`src/web`: React, Tailwind and shadcn/ui panels around a canvas map), over domain modules (`src/modules`): the fact model, the language adapters, the indexer, the layout, the canvas map engine and more. See [ARCHITECTURE.md](ARCHITECTURE.md).
- `packages/dock`: the terminal dock. A Herdr socket client, the pty bridge and its HTTP and WebSocket routes (`src/server`), and `mountDock` for the page (`src/web`).

## Develop

```bash
pnpm lint          # Biome lint and format check
pnpm format        # apply Biome fixes and formatting
pnpm check-types   # TypeScript, strict
pnpm test          # Vitest
pnpm index         # index the configured projects once
```

Tests and fixtures use synthetic repositories only. Naming, layering and error conventions are in [CONVENTIONS.md](CONVENTIONS.md); `pnpm lint` enforces them.

## License

MIT. See [LICENSE](LICENSE).
