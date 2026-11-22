# Architecture

Code Colony turns git repositories into a map. The pipeline is:

```
git tree ──► language adapters ──► facts (cached) ──► world tree + edges ──► stable layout ──► /api ──► canvas
             (tree-sitter, LSP)                                                                  (live)
```

Everything left of "facts" is per language. Everything right of it is language-agnostic and knows nothing about TypeScript or any other language.

## Source layout (`apps/colony/src`)

Two shells start and serve the app; everything it knows sits in a module under `modules/`. Paths below are relative to `modules/` unless they start with a shell.

| Folder                  | Role                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server/`               | The Node shell: the loopback HTTP server (`main.ts`; `/api/world`, `/api/symbols`, `/api/search`, `/api/events`, `/api/deep`, `/api/file`, `/api/build-queue`, `/api/colonists` in `api.ts`), its host check and static files, and `pnpm index` (`cli.ts`).                                                                                                              |
| `web/`                  | The browser shell: the React page (`main.tsx`), its HTTP client (`client/world-client.ts`), hooks and panels (`components/`).                                                                                                                                                                                                                                            |
| `modules/world/`        | The language-agnostic fact model (`facts.ts`): facts, edges and provenance, and the world tree (`world-types.ts`).                                                                                                                                                                                                                                                       |
| `modules/language/`     | The adapter interface (`language-adapter.ts`), the tree-sitter runner (`parse.ts`), the LSP client (`lsp.ts`), one folder per language (`adapters/<language>/`), the registry (`registry.ts`) and the adapter contract (`contract-samples.ts`, `contract.test.ts`).                                                                                                      |
| `modules/indexing/`     | Reads committed trees from git, caches facts by content hash (`fact-cache.ts`), parses on worker threads, builds the world tree and its edges (`build-world.ts`), saves the layout between runs (`layout-store.ts`) and keeps the world live (`colony.ts`).                                                                                                              |
| `modules/agents/`       | The colonists: copies of the mapped repositories found by repository identity (`repo-identity.ts`, `worktree-list.ts`), each copy's diff since its fork point (`copy-diff.ts`), live sessions from Herdr and the process table (`herdr-sessions.ts`, `process-sessions.ts`), firstmate's task records (`firstmate-tasks.ts`), all kept current by `colonist-tracker.ts`. |
| `modules/layout/`       | The grid layout: the stable row packer (`pack-rows.ts`), file cells (`pack-cells.ts`), import ranks (`rank-items.ts`), gutter widening for dependency lanes (`lane-widening.ts`), symbol bands (`symbol-band.ts`) and the world layout (`world-layout.ts`).                                                                                                              |
| `modules/lane-routing/` | The dependency lane router that both the layout and the page run (`channel-graph.ts`, `route-boxes.ts`, `route-lanes.ts`).                                                                                                                                                                                                                                               |
| `modules/wire/`         | Types the server sends and the page reads (`api-types.ts`) and the world's wire format (`world-encoder.ts`, `world-decoder.ts`, `sequence-diff.ts`).                                                                                                                                                                                                                     |
| `modules/search/`       | The symbol search index behind `/api/search` (`search-index.ts`).                                                                                                                                                                                                                                                                                                        |
| `modules/build-queue/`  | The build queue behind `/api/build-queue`, read from a firstmate home (`load-build-queue.ts`): its backlog (`parse-backlog.ts`) and workers' status files (`parse-status-log.ts`).                                                                                                                                                                                       |
| `modules/config/`       | Config loading (`load-config.ts`): the projects to map, the cache folder, the firstmate home and the port.                                                                                                                                                                                                                                                               |
| `modules/scene/`        | The page's world state (`scene.ts`) and the queries panels run on it (`tree-entries.ts`, `edge-sections.ts`, `change-target.ts`), and where colonists' changes land on the map (`colonist-places.ts`).                                                                                                                                                                   |
| `modules/map/`          | The canvas engine: camera, level of detail, renderer, overlays and links (`map-controller.ts` and its internals), the colonists' diff outlines and per-file pins (`colonist-layer.ts`, laid out by `colonist-pins.ts`), and the Dependency overlay's lanes (`lanes/`).                                                                                                   |
| `modules/theme/`        | Colours (`palette.ts`), symbol glyphs (`symbol-glyphs.ts`) and colonist status icons (`colonist-glyphs.ts`), shared by the map and the panels.                                                                                                                                                                                                                           |
| `modules/preferences/`  | UI preferences kept in the browser (`shell-preferences.ts`).                                                                                                                                                                                                                                                                                                             |
| `modules/logging/`      | The log helper (`log.ts`).                                                                                                                                                                                                                                                                                                                                               |

Each module has entry files, a runtime (Node, browser or both) and a list of the modules it may import; other code imports a module only through its entry files. `pnpm lint` enforces it. The module table, naming rules and the rest of the conventions are in [CONVENTIONS.md](CONVENTIONS.md).

## The model

A world is a tree: `world > project > repo > package > module > file > symbol`. A module is a folder: it holds its own files and its subfolders' modules, so modules nest like the folders they map. A folder with no files of its own and a single subfolder merges into it (`.github/workflows` is one module). A package is a folder below the repository root with a manifest (`package.json`, `go.mod`, ...) and holds the modules below it; modules outside any package sit directly in the repository. Files directly in the repository's or a package's own folder are loose files of that repository or package, not a module. Ids are paths: `project:<name>/repo/dir/file.ts#Class.method`; a module's id is its folder and a package's is `<repo>/package:<path>`.

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

A language is one `LanguageAdapter` (`language/language-adapter.ts`) plus a grammar and, optionally, a language server. The core, indexer, layout and renderer do not change.

1. **Create `language/adapters/<language>/adapter.ts`** exporting a `LanguageAdapter`:
   - `id`, `version` (bump it when queries change, so cached facts are re-read) and `extensions`.
   - `grammar(path)`: absolute path of the tree-sitter `.wasm` grammar. Most grammars ship one on npm (`tree-sitter-python`, `tree-sitter-go`, ...); resolve it with `createRequire(import.meta.url).resolve(...)`.
   - `queries`: three tree-sitter queries using these capture names:

     | Query     | Captures                                                                                                                                                                                                                                                                                    |
     | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
     | `symbols` | `@definition.<kind>` on the declaration and `@name` on its name. Kinds: `function`, `method`, `class`, `interface`, `type`, `enum`, `variable`, `namespace`. The nearest enclosing definition becomes the container. Many grammars ship a `queries/tags.scm` that uses the same convention. |
     | `imports` | `@import` on the statement, `@import.source` on the module string, `@import.name` on each bound name. Several patterns may match one statement; they are merged.                                                                                                                            |
     | `calls`   | `@call` on the call, `@call.name` on the called identifier, `@call.member` when it is a member call.                                                                                                                                                                                        |

   - `isBranch(type, node)`: true for nodes that add a branch (if, loops, case, catch, short-circuit operators). It drives the branch counts in the inspector. It runs on every syntax node, so decide from `type` where you can and call `node()` only when the type is not enough (it builds the full node, which is much slower).
   - `resolveImport(specifier, fromPath, files)`: the repository path an import points to, or `undefined` for external packages.
   - Optional hooks: `symbolKind` (refine or drop a captured definition), `isExported`, `isTypeOnlyImport`.
   - Optional `languageServer`: the command of any server that speaks LSP over stdio (`pyright-langserver --stdio`, `gopls`, `jdtls`, `csharp-ls`, ...), its `languageId` per file and `initializationOptions`. The core drives it through `language/lsp.ts`: `textDocument/prepareCallHierarchy` and `callHierarchy/outgoingCalls` turn calls into `lsp` edges.
2. **Register it** in `language/registry.ts` (`LANGUAGE_ADAPTERS`). Two adapters cannot claim one extension.
3. **Add a contract sample** in `language/adapters/<language>/sample.ts` and list it in `CONTRACT_SAMPLES` (`language/contract-samples.ts`): a few small files, and the symbols, imports, calls, transports and (with a language server) LSP-proven calls the adapter must find. `language/contract.test.ts` indexes the sample end to end and checks every expectation; an adapter without a sample fails it.
4. **Allow its native build to be skipped** if its npm package has an install script: add it to `allowBuilds` in `pnpm-workspace.yaml` with `false`. Only the `.wasm` file is used.

`language/adapters/typescript/` is the reference adapter.

## Transport detectors

Cross-process links (HTTP, queues, data access) come from `TransportDetector`s (`language/language-adapter.ts`), one per language and framework or library. A detector gets the parsed tree and a query compiler and returns `TransportFact`s. The core links them: HTTP clients to routes with the same path (`indexing/http-paths.ts`), across repositories.

To add one, write a detector next to its language (see `language/adapters/typescript/http-detector.ts`, named `<framework>-detector.ts`) and register it in `TRANSPORT_DETECTORS` (`language/registry.ts`).

## Indexing

- Each repository is read at its `HEAD` commit with `git ls-tree` and `git cat-file --batch`, never from the working tree, and nothing is written into it.
- Vendored and generated files (`node_modules`, `dist`, lockfiles, minified files, files over 1 MB) are skipped.
- Facts are cached on disk by blob hash and language under `cacheDir` (default `~/.cache/codecolony`), namespaced by the adapters' ids and versions. A repository whose `HEAD` has not moved is skipped; otherwise only new blobs are parsed.
- New blobs are parsed on a pool of worker threads, one per core (`indexing/parse-pool.ts`), which stops when idle. Adapters and detectors are loaded in each worker by Node's built-in TypeScript type stripping, so the app uses erasable TypeScript only (`erasableSyntaxOnly`): no parameter properties, enums or namespaces.
- The server watches each repository's `HEAD`, branch refs and `packed-refs` (in the worktree's own git dir and the shared common dir), checks only the repositories that changed, and pushes a `world` event over `/api/events` when the map changes. A full `HEAD` check every minute catches anything the watcher missed. A folder of repositories is watched only at its top level, so a repository created in place there (`mkdir`, then `git init`) can take up to that minute to appear; a clone shows up at once.
- Tracing a file with its language server (`/api/deep`) reads the working tree, so it matches the map only while that file is unmodified.

## The world on the wire

The page never receives the server's `World` as is (`wire/world-encoder.ts`, `wire/world-decoder.ts`):

- `/api/world` sends the world without symbols. Nodes are rows that refer to their parent by index, ids and paths are front-coded on the parent's, rectangles are relative to the parent and rounded to 1/256 of a grid unit, and edges are a flat array of numbers over a string table. A vscode-sized world is about 18 MB instead of 276 MB, encoded once per version.
- A file's symbols come from `/api/symbols` when the file is about to open on the map, when its file is shown, or when a symbol is picked. Their rectangles are not sent: the page places them with the layout's own formula (`layout/symbol-band.ts`). Until they arrive, an edge that ends on one of them is held by its file. Search runs on the server (`/api/search`), since the page holds only the symbols it loaded.
- After a `world` event the page asks `/api/world?session=<s>&since=<version>` and gets a patch, splices over the version before (`wire/sequence-diff.ts`), when the server still has that version; otherwise the whole world.
- On the page, `scene/scene.ts` is the one place that reads world data, and `web/client/world-client.ts` makes the requests.
- `/api/colonists` sends the colonists whole, with the token, after each `colonists` event; the page keeps one `/api/events` stream for both kinds of event (`web/client/server-events.ts`).

## Layout

Everything is measured in grid units, the spacing of the page's background grid, and every size, padding and gap is a whole number of them, so every block edge lands on a grid line:

- a file is a square 1 to 4 units wide: up to 36, 144, 324 or more lines (`layout/pack-cells.ts`);
- a module packs its files into columns from the top down, largest first, a fixed 1-unit street apart, inside a 1-unit padding on every side, below a 1-unit label strip; its height starts about square, so its width grows with its code. The street never widens, so files keep their places whatever imports change;
- a module with subfolders, like packages, repositories and projects, lays its children out in rows (`layout/pack-rows.ts`), a gutter apart (`LayoutOptions.gutter`, 2 units by default), widened by whole units to fit the Dependency overlay's lanes, up to `LayoutOptions.maxGutter` (8 units): the layout routes every import between the blocks seen with every folder open and every module of files closed, counts the lanes each gutter needs, widens the row, slot and stack gaps that are short and lays out again, twice at most (`layout/lane-widening.ts`). Its 1-unit padding on every side, below the label strip, holds a ring of lanes and grows per side by whole units to fit them, up to one lane (`RING_LANES`); a module of files is never widened, its streets are its ring. Each row is a line of slots; a slot holds one module, stretched to the row height when it is nearly that tall, or a stack of small ones. The own files of a repository, a package or a module with subfolders pack like a module's, as one more item in its rows, with no border, padding or label;
- on first placement, rows go from importers to what they import (`layout/rank-items.ts`), so most imports point down.
- new children fill a row up to a width-to-height ratio of about 1.6, judged by their area. The top level instead fills its rows to the width that brings the whole map closest to the shape of the app window (width over height, side panels included): the first page to load a fresh layout reports it (`Colony.fitWindow`), it is saved with the layout (`LayoutStore.aspect`), and resizing the window never moves anything. Until a page reports one, the top level fills to 16:9.

The layout is stable. The order of rows, slots, stacks and files is saved in `cacheDir/layout.json` (`indexing/layout-store.ts`), so the map keeps its shape across commits and restarts:

- placed children keep their row, slot and place in the stack; only sizes move what follows them;
- new children slot in by rank, on a stack with room or at the end of a row; new files follow a module's existing ones;
- deleted children free their place;
- a row keeps its height until its children need more, or less than half of it.

The map is laid out afresh only on request: `pnpm index --relayout`. Symbols are bands over their file at the height of their line range.

## Rendering and zoom

The page draws on one canvas with a continuous camera: wheel, pinch and `+`/`-` zoom smoothly at the cursor. Detail follows on-screen size (`map/lod.ts`): a module's files fade in as it grows past 12-24 px (packages 24-48 px, repositories and projects 40-90 px), a file's symbols over 150-300 px, and labels fade in with their font size. Connections are overlays (`map/overlays.ts`), off by default. The Dependency overlay draws imports as lanes through the gutters (`lane-routing/channel-graph.ts`, `lane-routing/route-lanes.ts`): the free space between blocks is cut into channels along the rows, slots and stacks of each container, with a ring of channels around the whole map so a row filled by one block never cuts it in two, and a ring of channels in each open folder's padding. Each link between two blocks takes the shortest orthogonal path through them that stays inside the deepest open folder holding both ends, and leaves a folder only straight on, through a door where a gutter meets the folder's ring on its left, right or bottom, never across its label strip; a link with no such path is not drawn. Each link gets a lane on a whole grid unit in each channel, ordered so lines keep their order through bends and only cross at right angles. Where a channel has fewer lanes than links, links to the same block share one; links to different blocks never do, so opposite directions never merge, and lanes that still do not fit run closer than a unit apart. Routes never depend on the camera. Like wiring on a circuit board, every lane is routed once from the layout, in world units, in a worker (`map/lanes/lane-world.ts`, `map/lanes/lane-worker.ts`). Highways join blocks with every folder open: a module of files, or a container's own files taken together (`lane-routing/route-boxes.ts`); they are routed once for the whole world, through the gutters the layout widened for exactly them. Inside each such holder of files, the links between its own files and a tail from each highway's port on its border to every file the highway serves are routed on their own, on a half-unit pitch (`FILE_LANE_PITCH`), only inside the holder and in a ring half a unit around it, so a 1-unit street holds one lane and tails never share a lane with a highway; a module's tails reach a port on its left, right or bottom through the ring in its padding, and any other port from outside, as nothing crosses a label strip. A holder is routed the first time it is drawn with its files and kept. Zooming works like map generalization: each zoom level (`map/link-cache.ts`) only cuts a highway where it enters the closed container drawn for an end, and hides one whose ends fall in one drawn block (`map/lanes/clip-highways.ts`), so a highway drawn at two zoom levels has the same corners at both, and panning changes nothing. Once a unit is 12 px wide (`FILE_LANES_PX` in `map/lod.ts`), the lanes inside the holders whose files are on screen show too, dimmed under the overlay, with the focus's on top. Hovering a node, or selecting one or more, draws just their lanes when no overlay is on; while anything is selected, hovering does not change them. Blocks are flat: a fill and a 1px border, drawn on the same pixel rows and columns as the grid lines, which fade out once a unit is under about 5 px.

The panels around the map are React, styled with Tailwind and shadcn/ui (`web/components/`). The map itself stays imperative: `map/map-controller.ts` owns the canvas, camera and input, and one React component (`components/map-view/`) creates it and passes it the world. React never renders map nodes, so a frame costs the same however many panels are open.
