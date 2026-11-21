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

The server prints the page's URL with a one-time token, `http://127.0.0.1:4320/#token=...`; open that exact URL. The token sits in the URL fragment, so it is never sent to the server or logged, and the page keeps it for the tab and strips it from the address bar.

The server listens on loopback only and answers 403 to any request whose host is not `127.0.0.1`, `localhost` or `[::1]`. Set `PORT` to use another port.

## Terminal dock

The bottom panel runs the real [Herdr](https://herdr.dev) client in the page (xterm.js over node-pty and a WebSocket), with a list of the agents Herdr knows about. Clicking a worker, in the dock or on the map, focuses its pane. The dock needs `herdr` on your `PATH`; without it the panel says so and the rest of the app still works.

| Flag                     | Environment                | Default                                            |
| ------------------------ | -------------------------- | -------------------------------------------------- |
| `--herdr-session <name>` | `CODECOLONY_HERDR_SESSION` | Herdr's default session                            |
| `--herdr-socket <path>`  | `CODECOLONY_HERDR_SOCKET`  | the session's `herdr.sock` under `~/.config/herdr` |
| `--herdr-bin <path>`     | `CODECOLONY_HERDR_BIN`     | `herdr`                                            |
| `--herdr-lab`            | `CODECOLONY_HERDR_LAB=1`   | off                                                |

Pass flags after the script name, for example `pnpm dev --herdr-session work`. Lab mode, for experiments, attaches only to sessions named `fm-lab-*` and refuses any other session.

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

## Layout

- `apps/colony`: the app. A Vite-built canvas page (`src/web`) and a Node server and indexer run with tsx (`src/server`).
- `packages/dock`: the terminal dock. A Herdr socket client, the pty bridge and its HTTP and WebSocket routes (`src/server`), and `mountDock` for the page (`src/web`).

## Develop

```bash
pnpm lint          # Biome lint and format check
pnpm format        # apply Biome fixes and formatting
pnpm check-types   # TypeScript, strict
pnpm test          # Vitest
```

Tests and fixtures use synthetic repositories only.

## License

MIT. See [LICENSE](LICENSE).
