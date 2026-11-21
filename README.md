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

The server listens on loopback only and answers 403 to any request whose host is not `127.0.0.1`, `localhost` or `[::1]`. Set `PORT` to use another port.

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
- `packages/*`: reserved for upcoming shared packages, such as the terminal dock.

## Develop

```bash
pnpm lint          # Biome lint and format check
pnpm format        # apply Biome fixes and formatting
pnpm check-types   # TypeScript, strict
pnpm test          # Vitest
pnpm index         # index the configured projects once
```

Tests and fixtures use synthetic repositories only.

## License

MIT. See [LICENSE](LICENSE).
