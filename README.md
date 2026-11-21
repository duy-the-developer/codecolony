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

See `codecolony.config.example.json`.

## Using the map

The page has a header (project picker, search, map controls), the map, and a side panel on each side. The left panel holds the Build queue, the Legend and a Files tree; the right panel holds the Terminal, the File tab (the selected file, read only, as committed at the indexed commit) and the Inspector. Drag a panel's edge to resize it; widths, collapsed panels and the open tabs are remembered in the browser.

| Input                    | Action                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Scroll, pinch, `+` / `-` | Zoom smoothly at the cursor; detail fades in and out as you zoom                                                                     |
| Drag, arrow keys         | Pan                                                                                                                                  |
| Hover                    | Show the module's or file's dependencies; with an overlay on, highlight them                                                         |
| Click                    | Select and keep the highlight; the Inspector lists facts, then imports, calls and HTTP requests in and out, with how each was proven |
| Double-click             | Fly into a block or file; on a file or symbol, also show it in the File tab                                                          |
| `Home`                   | See everything                                                                                                                       |
| `Esc`                    | Clear the selection                                                                                                                  |
| `⌘K` / `Ctrl+K`          | Search files and symbols by name; Enter flies to the result and selects it, Shift+Enter opens its file                               |
| `[` / `]`                | Collapse or expand the left / right panel                                                                                            |
| `D`                      | Turn the Dependency overlay on or off                                                                                                |

By default the map shows only module blocks and file squares. Overlays draw connections over it, switched on from Overlays in the header; Dependency, the first, draws imports as arrows from the importing module to the imported one. The arrows run through the gutters between blocks, never across them, in lanes on the grid one unit apart, so they never overlap and only cross at right angles. Gutters widen, up to 8 units, to fit their lanes; in a gutter that is still full, arrows to the same module share a lane. Zoomed out, arrows join at the folders, packages and repositories you can see.

With no overlay on, hovering a module or file shows its dependencies; with one on, all of them show and hovering highlights the module's own. The Inspector lists connections as Imports / Imported by, Calls / Called by, and HTTP requests / HTTP routes served, by route, with how each was proven. "Trace calls with the language server" proves the calls of a file's functions, including method calls the parser cannot resolve.

The map updates live: commit to a mapped repository and it redraws within a few seconds. A repository created in place inside a mapped folder of repositories can take up to a minute to appear.

## Languages

TypeScript and JavaScript are supported today, through tree-sitter and `typescript-language-server`. Languages plug in as adapters: a tree-sitter grammar with three queries, plus any language server that speaks LSP over stdio. See [ARCHITECTURE.md](ARCHITECTURE.md) for how to add one.

## Layout

- `apps/colony`: the app. A Vite-built page (`src/web`: React, Tailwind and shadcn/ui panels around a canvas map), a Node server (`src/server`), the indexer (`src/indexer`), the language-agnostic core (`src/core`) and the language adapters (`src/adapters`). See [ARCHITECTURE.md](ARCHITECTURE.md).
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
