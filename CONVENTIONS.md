# Conventions

How files, symbols and folders are named and how folders depend on each other. `pnpm lint` (Biome, see `biome.json`) enforces file names, symbol cases, barrel files and the folder dependency direction; the rest is checked in review.

## Files and folders

- kebab-case, ASCII only (`useFilenamingConvention`).
- Folders are singular nouns that name an area: `indexer/`, `layout/`, `config/`. `adapters/` is the one plural exception.
- Name a file after its main export: `buildWorld` lives in `build-world.ts`, `class Scene` in `scene.ts`.
- When a file plays a role inside a set, the role comes last: `http-detector.ts`, `grpc-detector.ts`.
- Reuse a base name only for files with the same role in sibling folders: `adapters/<language>/adapter.ts`, `adapters/<language>/sample.ts`.
- Shared wire types: `shared/<topic>-types.ts`.
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
- Log with `log(message, context)` or `logError(message, context)` from `shared/log.ts`: a fixed message plus a context object, never values formatted into the message. Lines get one `[codecolony]` prefix.

## Tests

- `<file>.test.ts` next to the source.
- `describe('<exported symbol>')`, `it('<does something in plain words>')`.
- Per package, `src/testing/` holds fixtures and fakes, imported only by tests: `<thing>-fixture.ts` exports `make<Thing>()`, and `fake-<service>.ts` exports `startFake<Service>()` or `createFake<Service>()`.
- Constants for fake data start with `FAKE_` (`FAKE_AGENTS`).

## React (if adopted)

- A folder per component: `components/project-picker/` holds `project-picker.tsx` (exports `ProjectPicker`), `project-picker.test.tsx` and optionally `project-picker.css`.
- Hooks go in `use-camera.ts`, which exports `useCamera`.
- Props type `ProjectPickerProps`. Boolean props are `isOpen`, `hasError`, `canEdit`; event props are `onSelect`, and their handlers `handleSelect`.
- One exported component per file, named exports only. Small helper components used only by that file may sit below it.
- shadcn/ui primitives live in `web/components/ui/<name>.tsx` as shadcn shapes them: several exported parts per file (`Tabs`, `TabsList`, `TabsTrigger`). Edit them in place.

## Environment variables and flags

- Env vars start with `CODECOLONY_`; `PORT` and `CI` are the standard exceptions. Each matches a flag: `--herdr-socket` and `CODECOLONY_HERDR_SOCKET`.
- The app reads them in `config/load-config.ts` and the dock in `packages/dock/src/server/options.ts`; the README lists them all.

## Folder dependency direction

Imports point one way. `noRestrictedImports` overrides in `biome.json` enforce it per folder.

`apps/colony/src`, lowest first: `core` and `shared`, then `config`, `adapters` and `layout`, then `indexer`, then `server`. `web` stands apart and imports only `shared`.

| Folder      | May import                                            |
| ----------- | ----------------------------------------------------- |
| `core/`     | nothing else in the app                               |
| `shared/`   | `core/`                                               |
| `config/`   | `core/`, `shared/`                                    |
| `adapters/` | `core/`, `shared/`                                    |
| `layout/`   | `core/`, `shared/`                                    |
| `indexer/`  | `core/`, `shared/`, `config/`, `adapters/`, `layout/` |
| `server/`   | everything except `web/`                              |
| `web/`      | `shared/` only (and `@codecolony/dock/web`)           |
| `testing/`  | imported by `*.test.ts` files only                    |

Tests may also import `testing/`, and the adapter contract test may reach up to `indexer/` and `config/`, because it indexes a sample end to end.

`packages/dock/src`: `shared/` imports neither `server/` nor `web/`; `server/` and `web/` do not import each other; `testing/` is for tests only.
