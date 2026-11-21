# Architecture

Code Colony turns git repositories into a map. The pipeline is:

```
git tree ──► language adapters ──► facts (cached) ──► world tree + edges ──► stable layout ──► /api ──► canvas
             (tree-sitter, LSP)                                                                  (live)
```

Everything left of "facts" is per language. Everything right of it is language-agnostic and knows nothing about TypeScript or any other language.

## Source layout (`apps/colony/src`)

| Folder      | Role                                                                                                                                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/`     | The language-agnostic model (`model.ts`), the adapter interface (`language-adapter.ts`), the tree-sitter runner (`parse.ts`), the LSP client (`lsp.ts`), HTTP path matching (`http-paths.ts`) and atomic file writes (`atomic-write.ts`). Never imports from `adapters/`. |
| `shared/`   | Types the server sends and the page reads (`api-types.ts`, `world-types.ts`) and the log helper (`log.ts`).                                                                                                                                                               |
| `config/`   | Config loading (`load-config.ts`): the projects to map, the cache folder and the port.                                                                                                                                                                                    |
| `adapters/` | One folder per language, the registry (`registry.ts`) and the adapter contract (`contract-samples.ts`, `contract.test.ts`).                                                                                                                                               |
| `layout/`   | The stable packer (`pack.ts`) and the world layout (`world-layout.ts`), persisted between runs.                                                                                                                                                                           |
| `indexer/`  | Reads committed trees from git, caches facts by content hash, builds the world tree and its edges (`build-world.ts`), and keeps it live (`colony.ts`).                                                                                                                    |
| `server/`   | The loopback HTTP server (`/api/world`, `/api/events`, `/api/deep`).                                                                                                                                                                                                      |
| `web/`      | The canvas page: camera, level of detail, renderer, inspector.                                                                                                                                                                                                            |
| `testing/`  | Git fixtures for tests.                                                                                                                                                                                                                                                   |

Folders depend on each other in one direction, lowest first: `core` and `shared`, then `config`, `adapters` and `layout`, then `indexer`, then `server`; `web` imports only `shared`. `pnpm lint` enforces it. Naming rules and the full dependency table are in [CONVENTIONS.md](CONVENTIONS.md).

## The model

A world is a tree: `world > project > repo > dir > file > symbol`. Ids are paths: `project:<name>/repo/dir/file.ts#Class.method`.

Each file carries `FileFacts`: lines, branch count, symbols (name, kind, line range, container, exported), imports (specifier, bound names, type-only), calls (callee, caller) and transports (HTTP client and route, queue produce and consume, data read and write).

Edges connect node ids and have a **kind** (`import`, `call`, `http`, `queue`, `data`) and a **provenance**, strongest first:

| Provenance    | Meaning                                                               | Drawn  |
| ------------- | --------------------------------------------------------------------- | ------ |
| `lsp`         | Answered by a language server (call hierarchy)                        | solid  |
| `tree-sitter` | Read from the syntax tree (imports, calls to names bound in the file) | solid  |
| `text`        | Matched on literals (URL paths, topic names)                          | dashed |
| `inferred`    | Guessed from a naming rule                                            | dashed |

The inspector shows the provenance of every edge, so a viewer can tell proven links from guesses.

## Adding a language

A language is one `LanguageAdapter` (`core/language-adapter.ts`) plus a grammar and, optionally, a language server. The core, indexer, layout and renderer do not change.

1. **Create `adapters/<language>/adapter.ts`** exporting a `LanguageAdapter`:
   - `id`, `version` (bump it when queries change, so cached facts are re-read) and `extensions`.
   - `grammar(path)`: absolute path of the tree-sitter `.wasm` grammar. Most grammars ship one on npm (`tree-sitter-python`, `tree-sitter-go`, ...); resolve it with `createRequire(import.meta.url).resolve(...)`.
   - `queries`: three tree-sitter queries using these capture names:

     | Query     | Captures                                                                                                                                                                                                                                                                                    |
     | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
     | `symbols` | `@definition.<kind>` on the declaration and `@name` on its name. Kinds: `function`, `method`, `class`, `interface`, `type`, `enum`, `variable`, `namespace`. The nearest enclosing definition becomes the container. Many grammars ship a `queries/tags.scm` that uses the same convention. |
     | `imports` | `@import` on the statement, `@import.source` on the module string, `@import.name` on each bound name. Several patterns may match one statement; they are merged.                                                                                                                            |
     | `calls`   | `@call` on the call, `@call.name` on the called identifier, `@call.member` when it is a member call.                                                                                                                                                                                        |

   - `isBranch(node)`: true for nodes that add a branch (if, loops, case, catch, short-circuit operators). It drives the complexity shadows.
   - `resolveImport(specifier, fromPath, files)`: the repository path an import points to, or `undefined` for external packages.
   - Optional hooks: `symbolKind` (refine or drop a captured definition), `isExported`, `isTypeOnlyImport`.
   - Optional `languageServer`: the command of any server that speaks LSP over stdio (`pyright-langserver --stdio`, `gopls`, `jdtls`, `csharp-ls`, ...), its `languageId` per file and `initializationOptions`. The core drives it through `core/lsp.ts`: `textDocument/prepareCallHierarchy` and `callHierarchy/outgoingCalls` turn calls into `lsp` edges.
2. **Register it** in `adapters/registry.ts` (`LANGUAGE_ADAPTERS`). Two adapters cannot claim one extension.
3. **Add a contract sample** in `adapters/<language>/sample.ts` and list it in `CONTRACT_SAMPLES` (`adapters/contract-samples.ts`): a few small files, and the symbols, imports, calls, transports and (with a language server) LSP-proven calls the adapter must find. `adapters/contract.test.ts` indexes the sample end to end and checks every expectation; an adapter without a sample fails it.
4. **Allow its native build to be skipped** if its npm package has an install script: add it to `allowBuilds` in `pnpm-workspace.yaml` with `false`. Only the `.wasm` file is used.

`adapters/typescript/` is the reference adapter.

## Transport detectors

Cross-process links (HTTP, queues, data access) come from `TransportDetector`s (`core/language-adapter.ts`), one per language and framework or library. A detector gets the parsed tree and a query compiler and returns `TransportFact`s. The core links them: HTTP clients to routes with the same path (`core/http-paths.ts`), across repositories.

To add one, write a detector next to its language (see `adapters/typescript/http-detector.ts`, named `<framework>-detector.ts`) and register it in `TRANSPORT_DETECTORS` (`adapters/registry.ts`).

## Indexing

- Each repository is read at its `HEAD` commit with `git ls-tree` and `git cat-file --batch`, never from the working tree, and nothing is written into it.
- Vendored and generated files (`node_modules`, `dist`, lockfiles, minified files, files over 1 MB) are skipped.
- Facts are cached on disk by blob hash and language under `cacheDir` (default `~/.cache/codecolony`), namespaced by the adapters' ids and versions. A repository whose `HEAD` has not moved is skipped; otherwise only new blobs are parsed.
- The server polls every repository's `HEAD` every two seconds and pushes a `world` event over `/api/events` when the map changes.
- Tracing a file with its language server (`/api/deep`) reads the working tree, so it matches the map only while that file is unmodified.

## Layout

Containers are packed bottom-up by `layout/pack.ts`:

- each child keeps a reserved rectangle, relative to its container, while it still fits;
- a child that outgrows its reservation grows in place if it can, otherwise only that child moves;
- new children take free space, and deleted children keep their place;
- a container left mostly empty by moves is packed afresh.

Reservations are saved in `cacheDir/layout.json`, so the map keeps its shape across commits and restarts. Files are squares whose area follows their line count; symbols are bands over their file at the height of their line range.

## Rendering and zoom

The page draws on one canvas with a continuous camera: wheel, pinch and `+`/`-` zoom smoothly at the cursor. Detail follows on-screen size (`web/lod.ts`): a container's children fade in as it grows past 70-150 px, a file's symbols over 150-300 px, and labels fade in with their font size. Roads are drawn between the deepest visible nodes that hold their ends, so they merge as you zoom out and split as you zoom in. A building's drop shadow grows with its branch count.
