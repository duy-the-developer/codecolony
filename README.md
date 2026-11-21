# Code Colony

A live, game-like top-down map of your codebases. Repositories become districts, modules become blocks and files become buildings; zoom in continuously, like a web map, down to individual functions. Overlay lenses show the network, change heat, external systems and data access, and the coding agents working on the code appear on the map next to the build queue.

Inspired by Oxygen Not Included and Factorio. Early work in progress.

## Run it

Requires Node 24+ and pnpm.

```bash
pnpm install
pnpm dev      # http://127.0.0.1:4320, with hot reload
pnpm start    # builds the page, then serves it
```

Out of the box it maps its own checkout. `pnpm index` indexes the configured projects once and prints a summary.

The server prints the page's URL with a fresh token for this run, `http://127.0.0.1:4320/#token=...`; open that exact URL. The token sits in the URL fragment, so it is never sent to the server or logged, and the page keeps it for the tab and strips it from the address bar.

The server listens on loopback only and answers 403 to any request whose host is not `127.0.0.1`, `localhost` or `[::1]`. Set `PORT` to use another port.

## Terminal dock

The bottom panel runs the real [Herdr](https://herdr.dev) client in the page (xterm.js over node-pty and a WebSocket), with a list of the agents Herdr knows about. Clicking a worker, in the dock or on the map, focuses its pane. The dock needs `herdr` on your `PATH`; without it the terminal shows the client's exit (for example `[herdr exited with code 1]`), the worker list says it cannot reach the Herdr socket, and the rest of the app keeps working.

| Flag                     | Environment                | Default                                            |
| ------------------------ | -------------------------- | -------------------------------------------------- |
| `--herdr-session <name>` | `CODECOLONY_HERDR_SESSION` | Herdr's default session                            |
| `--herdr-socket <path>`  | `CODECOLONY_HERDR_SOCKET`  | the session's `herdr.sock` under `~/.config/herdr` |
| `--herdr-bin <path>`     | `CODECOLONY_HERDR_BIN`     | `herdr`                                            |
| `--herdr-lab`            | `CODECOLONY_HERDR_LAB=1`   | off                                                |

Pass flags after the script name, for example `pnpm dev --herdr-session work`. Lab mode, for experiments, attaches only to sessions named `fm-lab-*` and refuses any other session.

Herdr shares its panes between all attached clients and sizes them to the client that most recently attached or sent input, so the last one wins. When the dock and another Herdr client (another tab, or a terminal) are both attached, the panes take the other client's size until the dock is used again. This is accepted for v1: there is no single-client limit or deferred sizing.

The terminal WebSocket and the dock's `/api/dock/*` routes need the token, a loopback `Host` and, when the browser sends one, a matching `Origin`. Every response carries a strict Content-Security-Policy, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and `Cache-Control: no-store`. Terminal data is never logged.

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

| Input                    | Action                                                           |
| ------------------------ | ---------------------------------------------------------------- |
| Scroll, pinch, `+` / `-` | Zoom smoothly at the cursor; detail fades in and out as you zoom |
| Drag, arrow keys         | Pan                                                              |
| Click                    | Inspect: facts, and every road in or out with how it was proven  |
| Double-click             | Fly into a building                                              |
| `Home`                   | See everything                                                   |
| `Esc`                    | Clear the selection                                              |

Roads: blue imports, teal calls, amber HTTP. Solid roads are proven by a language server or the syntax tree; dashed ones are matched on text. In the inspector, "Trace calls with the language server" proves the calls of a file's functions, including method calls the parser cannot resolve.

The map updates live: commit to a mapped repository and it redraws within a few seconds.

## Languages

TypeScript and JavaScript are supported today, through tree-sitter and `typescript-language-server`. Languages plug in as adapters: a tree-sitter grammar with three queries, plus any language server that speaks LSP over stdio. See [ARCHITECTURE.md](ARCHITECTURE.md) for how to add one.

## Layout

- `apps/colony`: the app. A Vite-built canvas page (`src/web`), a Node server (`src/server`), the indexer (`src/indexer`), the language-agnostic core (`src/core`) and the language adapters (`src/adapters`). See [ARCHITECTURE.md](ARCHITECTURE.md).
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
