import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { CheckIcon, CopyIcon, CrosshairIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { WorldNode } from '../../../shared/world-types.ts'
import { cn } from '../../class-names.ts'
import { useFileText } from '../../hooks/use-file-text.ts'
import { SYMBOL_COLORS } from '../../render.ts'
import type { Scene } from '../../scene.ts'
import { SYMBOL_GLYPHS } from '../../symbol-glyphs.ts'
import { CodeView } from '../code-view/code-view.tsx'
import { Button } from '../ui/button.tsx'

export interface FileTabProps {
  scene: Scene | undefined
  selected: WorldNode | undefined
  // Selects a node and flies the map to it.
  onPick(id: string): void
}

const COPIED_MS = 1500

// The File tab: the selected file, or the file of the selected symbol, read
// only at the commit it was indexed at. Its symbols sit above the code; the
// selected one is highlighted.
export function FileTab({ scene, selected, onPick }: FileTabProps) {
  const file = selected?.kind === 'symbol' ? fileOf(scene, selected) : selected
  if (!scene || file?.kind !== 'file') {
    return (
      <p className="m-3 rounded-md border border-dashed p-4 text-center text-muted-foreground text-sm">
        Select a file on the map, in Files or with ⌘K to see it here.
      </p>
    )
  }
  return (
    <FileView
      key={file.id}
      scene={scene}
      file={file}
      symbol={selected?.kind === 'symbol' ? selected : undefined}
      onPick={onPick}
    />
  )
}

interface FileViewProps {
  scene: Scene
  file: WorldNode
  symbol: WorldNode | undefined
  onPick(id: string): void
}

function FileView({ scene, file, symbol, onPick }: FileViewProps) {
  const commit = scene.repoOf(file)?.commit
  const state = useFileText(file.id, commit)
  const path = file.path ?? file.name
  const folder = path.slice(0, -file.name.length)
  const symbols = scene.world.nodes
    .filter((node) => node.kind === 'symbol' && node.id.startsWith(`${file.id}#`))
    .sort((a, b) => (a.range?.start ?? 0) - (b.range?.start ?? 0))
  const meta = [
    languageName(file),
    `${file.lines.toLocaleString()} lines`,
    commit?.slice(0, 7),
  ].filter(Boolean)

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b p-3">
        <div className="flex items-center gap-2">
          {/* The folder gives way first, so the file name stays readable. */}
          <p className="flex min-w-0 flex-1 font-mono text-xs" title={path}>
            <span className="truncate text-muted-foreground">{folder}</span>
            <span className="max-w-full shrink-0 truncate font-semibold">{file.name}</span>
          </p>
          <Button variant="outline" size="sm" onClick={() => onPick(file.id)}>
            <CrosshairIcon />
            Reveal on map
          </Button>
          <CopyPathButton path={path} />
        </div>
        <p className="flex items-center gap-2 text-muted-foreground text-xs">
          <span className="rounded-sm border px-1 font-mono text-[10px] tracking-wider">
            READ ONLY
          </span>
          {meta.join(' · ')}
        </p>
      </div>
      {symbols.length > 0 && (
        <ul
          aria-label="Symbols"
          className="flex max-h-24 shrink-0 flex-wrap gap-1 overflow-y-auto border-b px-3 py-2"
        >
          {symbols.map((node) => (
            <li key={node.id}>
              <SymbolChip node={node} isSelected={node.id === symbol?.id} onPick={onPick} />
            </li>
          ))}
        </ul>
      )}
      <div className="min-h-0 flex-1">
        {state.status === 'ready' && !state.file.isBinary && (
          <CodeView text={state.file.text} fileName={file.name} highlight={symbol?.range} />
        )}
        {state.status === 'ready' && state.file.isBinary && (
          <Note>A binary file: there is no text to show.</Note>
        )}
        {state.status === 'loading' && <Note>Loading...</Note>}
        {state.status === 'error' && <Note>{`Could not load the file: ${state.message}`}</Note>}
      </div>
    </div>
  )
}

interface SymbolChipProps {
  node: WorldNode
  isSelected: boolean
  onPick(id: string): void
}

function SymbolChip({ node, isSelected, onPick }: SymbolChipProps) {
  const kind = node.symbolKind
  return (
    <button
      type="button"
      aria-pressed={isSelected}
      title={node.range ? `${node.name}, lines ${node.range.start}-${node.range.end}` : node.name}
      onClick={() => onPick(node.id)}
      className={cn(
        'flex h-6 cursor-pointer items-center gap-1 rounded-sm border px-1.5 font-mono text-[11px] hover:bg-accent',
        isSelected && 'border-primary bg-primary/10 text-primary hover:bg-primary/20',
      )}
    >
      {kind && (
        <span style={isSelected ? undefined : { color: SYMBOL_COLORS[kind] }}>
          {SYMBOL_GLYPHS[kind]}
        </span>
      )}
      {node.name}
    </button>
  )
}

function CopyPathButton({ path }: { path: string }) {
  const [isCopied, setIsCopied] = useState(false)
  useEffect(() => {
    if (!isCopied) return
    const timer = setTimeout(() => setIsCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [isCopied])
  const handleClick = () => {
    navigator.clipboard.writeText(path).then(
      () => setIsCopied(true),
      () => setIsCopied(false),
    )
  }
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className="text-muted-foreground"
      aria-label={isCopied ? 'Path copied' : 'Copy path'}
      title={isCopied ? 'Copied' : 'Copy path'}
      onClick={handleClick}
    >
      {isCopied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

function Note({ children }: { children: string }) {
  return <p className="p-3 text-muted-foreground text-sm">{children}</p>
}

// The file a symbol sits in; a method's parent is its class, not the file.
function fileOf(scene: Scene | undefined, symbol: WorldNode): WorldNode | undefined {
  let node: WorldNode | undefined = symbol
  while (node?.kind === 'symbol') node = scene?.parentOf(node)
  return node
}

// The language's display name, as the syntax colours see it.
function languageName(file: WorldNode): string {
  const description = LanguageDescription.matchFilename(languages, file.name)
  return description?.name ?? (file.language === 'binary' ? 'Binary' : 'Plain text')
}
