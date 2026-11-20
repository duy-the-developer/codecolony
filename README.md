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

The server listens on loopback only.

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
- `packages/*`: shared packages, such as the terminal dock.

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
