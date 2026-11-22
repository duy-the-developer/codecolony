# Conventions

How files, symbols and folders are named and how modules depend on each other. `pnpm lint` (Biome, see `biome.json`) enforces file names, symbol cases, barrel files and the module rules; the rest is checked in review.

## Files and folders

- kebab-case, ASCII only (`useFilenamingConvention`).
- Folders are singular nouns that name an area: `indexing/`, `layout/`, `config/`. `adapters/` and `modules/` are the two plural exceptions.
- Name a file after its main export: `buildWorld` lives in `build-world.ts`, `class Scene` in `scene.ts`.
- When a file plays a role inside a set, the role comes last: `http-detector.ts`, `grpc-detector.ts`.
- Reuse a base name only for files with the same role in sibling folders: `adapters/<language>/adapter.ts`, `adapters/<language>/sample.ts`.
- Types a module offers to others: `<module>/<topic>-types.ts`.
- `index.ts` is only a package entry point named in `package.json` `exports`. No other barrel files (`noBarrelFile`); import from the file that defines the thing.
- Entry scripts are `main.ts` (servers and pages) or `cli.ts` (command-line tools).
- No `utils.ts`, `helpers.ts` or `misc.ts`. Name helpers by what they do: `atomic-write.ts`, `color-scale.ts`.
- Named exports only. Tool config files (`vite.config.ts`, `vitest.config.ts`) are the exception, because their tools need a default export.

## Functions

camelCase, verb first. The verb says what the call costs:

| Prefix                              | Meaning                                                    | Example                        |
| ----------------------------------- | ---------------------------------------------------------- | ------------------------------ |
| `get…`                              | Cheap, synchronous, in memory                              | `getTile(id)`                  |
| `load…` / `read…`                   | Disk or git                                                | `loadLayout`, `readBlobs`      |
| `fetch…`                            | Network                                                    |                                |
| `save…` / `write…`                  | Persistence                                                | `saveLayout`                   |
| `parse…`                            | Text to structure; may throw                               | `parseConfig`                  |
| `build…`                            | Pure assembly from parts                                   | `buildWorld`                   |
| `create…`                           | Factory returning an object or handle with a lifecycle     | `createDock`                   |
| `start…`                            | Begins a background process or server and returns a handle | `startFakeHerdr`               |
| `resolve…`                          | Works out a value from inputs, defaults and fallbacks      | `resolveDockOptions`           |
| `list…` / `find…`                   | Returns an array / may return `undefined`                  | `listTree`, `findAdapter`      |
| `mount…` / `render…`                | DOM and canvas                                             | `mountDock`                    |
| `to<X>` / `<x>From<Y>`              | Converters                                                 | `tokenFromAuthorization`       |
| `is…` / `has…` / `can…` / `should…` | Predicates; a plural subject plus a verb also works        | `isLoopbackHost`, `pathsMatch` |

A pure, cheap function that derives a value may be a noun phrase (`repoId`, `fileSide`, `qualifiedName`). Anything that does I/O, mutates, allocates resources or is expensive starts with a verb.

## Types

- PascalCase. `interface` for object shapes, `type` for unions and aliases.
- Avoid names that clash with global DOM or Node types (`DockWorker`, not `Worker`).
- No TypeScript `enum`: an `as const` list plus a derived union.

Glossary of type suffixes:

| Suffix                                | Meaning                                               |
| ------------------------------------- | ----------------------------------------------------- |
| `…Options`                            | Caller-supplied settings; defaults are applied inside |
| `…Deps`                               | Injected collaborators for a factory                  |
| `…Request` / `…Response` / `…Message` | Wire shapes                                           |
| `…Fact`                               | Data pulled from source code                          |
| `…Kind`                               | A union of string literals                            |
| `…Error`                              | An `Error` subclass                                   |
| `…Handle`                             | What a `create…`, `mount…` or `start…` returns        |
| `…Result`                             | The outcome of an operation                           |

## Constants

- SCREAMING_SNAKE_CASE for module-level fixed values and `as const` lists: `MAX_ZOOM`, `EDGE_KINDS`.
- Units go in the name: `POLL_MS`, `MAX_REPLY_BYTES`, `MIN_VISIBLE_PX`.
- A list of literals is plural (`EDGE_KINDS`); the type derived from it is singular (`EdgeKind`).
- A set or map constant says what it holds: `PROVEN_PROVENANCES`.
- Long-lived instances and registries of objects are camelCase (`typescriptAdapter`), unless they are fixed tables (`LANGUAGE_ADAPTERS`).
- Object properties that copy an outside format keep it: env var keys (`CODECOLONY_CONFIG`) and snake_case JSON (`pane_id`). `useNamingConvention` allows camelCase, CONSTANT_CASE and snake_case for object literal properties only.

## Errors and logging

- `class <Area>Error extends Error` with `override name = '<Area>Error'`, a `readonly code` from a PascalCase string-literal union (`'MissingFile' | 'BadJson'`) and `ErrorOptions` passed to `super`, so `{ cause }` is kept. Callers branch on `code`, never on the message.
- `HerdrError` is the exception: its `code` carries Herdr's own error codes through unchanged.
- Log with `log(message, context)` or `logError(message, context)` from `modules/logging/log.ts`: a fixed message plus a context object, never values formatted into the message. Lines get one `[codecolony]` prefix.

## Tests

- `<file>.test.ts` next to the source.
- `describe('<exported symbol>')`, `it('<does something in plain words>')`.
- Per module, `testing/` holds fixtures and fakes, imported only by tests: `<thing>-fixture.ts` exports `make<Thing>()`, and `fake-<service>.ts` exports `startFake<Service>()` or `createFake<Service>()`.
- Constants for fake data start with `FAKE_` (`FAKE_AGENTS`).

## React (if adopted)

- A folder per component: `components/project-picker/` holds `project-picker.tsx` (exports `ProjectPicker`), `project-picker.test.tsx` and optionally `project-picker.css`.
- Hooks go in `use-camera.ts`, which exports `useCamera`.
- Props type `ProjectPickerProps`. Boolean props are `isOpen`, `hasError`, `canEdit`; event props are `onSelect`, and their handlers `handleSelect`.
- One exported component per file, named exports only. Small helper components used only by that file may sit below it.
- shadcn/ui primitives live in `web/components/ui/<name>.tsx` as shadcn shapes them: several exported parts per file (`Tabs`, `TabsList`, `TabsTrigger`). Edit them in place.

## Environment variables and flags

- Env vars start with `CODECOLONY_`; `PORT` and `CI` are the standard exceptions. Each matches a flag: `--herdr-socket` and `CODECOLONY_HERDR_SOCKET`.
- The app reads them in `modules/config/load-config.ts` and the dock in `packages/dock/src/server/options.ts`; the README lists them all.

## Modules

`apps/colony/src` has two shells and the domain modules they use:

- `server/`: how the Node app starts and is reached (`main.ts`, `cli.ts`, the `/api` routes).
- `web/`: the React app (`main.tsx`, `client/` for HTTP requests, `hooks/`, `components/`).
- `modules/<domain>/`: everything the app knows, one folder per domain, named with a singular noun.

Rules:

1. Import a module only through its entry files (below). Inside a module, import anything.
2. A module starts flat. The role goes last in the file name (`fact-cache.ts`, `head-watcher.ts`, `parse-pool.ts`, `http-detector.ts`). Add a sub-folder only for a sub-domain of three or more files (`map/lanes/`), a plugin set (`language/adapters/<language>/`) or the module's own test helpers (`testing/`). Split a module that passes about 15 source files.
3. A module imports only the modules listed for it. Modules never import `server/` or `web/`.
4. Browser and both-runtime modules, and `web/`, never import `node:*`.
5. No `common/`, `utils/` or `helpers/` module. Shared code goes in a module named for what it does; a helper with one consumer lives in that consumer's module.
6. Test helpers live in `testing/` inside the module whose tests use them, and only tests import them.

| Module          | Runtime | Entry files                                                | May import                                                                                 |
| --------------- | ------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `world/`        | both    | all                                                        | nothing                                                                                    |
| `logging/`      | both    | `log.ts`                                                   | nothing                                                                                    |
| `theme/`        | both    | all                                                        | `world`                                                                                    |
| `lane-routing/` | both    | all                                                        | `world`                                                                                    |
| `layout/`       | both    | `world-layout.ts`, `symbol-band.ts`                        | `world`, `lane-routing`                                                                    |
| `wire/`         | both    | `api-types.ts`, `world-encoder.ts`, `world-decoder.ts`     | `world`, `layout`                                                                          |
| `config/`       | Node    | `load-config.ts`                                           | `wire`                                                                                     |
| `language/`     | Node    | `language-adapter.ts`, `registry.ts`, `parse.ts`, `lsp.ts` | `world`                                                                                    |
| `search/`       | Node    | `search-index.ts`                                          | `world`, `wire`                                                                            |
| `indexing/`     | Node    | `colony.ts` (`testing/` for tests)                         | `world`, `wire`, `logging`, `config`, `language`, `layout`                                 |
| `scene/`        | browser | all                                                        | `world`, `wire`, `logging`                                                                 |
| `map/`          | browser | `map-controller.ts`, `overlays.ts`, `camera.ts`            | `world`, `logging`, `lane-routing`, `scene`, `theme`                                       |
| `preferences/`  | browser | `shell-preferences.ts`                                     | nothing                                                                                    |
| `server/` shell | Node    | -                                                          | `world`, `wire`, `logging`, `config`, `search`, `indexing`; `@codecolony/dock/server`      |
| `web/` shell    | browser | -                                                          | `world`, `wire`, `logging`, `scene`, `map`, `theme`, `preferences`; `@codecolony/dock/web` |

Inside `language/`, only `registry.ts` and `contract-samples.ts` import `adapters/`. The adapter contract test may also import `indexing/colony.ts` and `indexing/testing/`, because it indexes each sample end to end.

`pnpm lint` enforces these rules: a `noRestrictedImports` override per module and shell in `biome.json` checks the direction, `testing/` and the runtime, and the `lint/module-entries.grit` plugin checks the entry files. Adding a module: add its folder, a row here, a `noRestrictedImports` override in `biome.json` and, if it hides internals, a line in `lint/module-entries.grit`. Adding an entry file: add it to this table and to the plugin.

`packages/dock` is a package, not a module: its entries are the subpaths in its `package.json` `exports` (`./server`, `./web`, `./protocol`), and nothing outside imports deeper. Inside it, `protocol/` imports neither `server/` nor `web/`; `server/` and `web/` do not import each other; `server/testing/` is for tests only.
