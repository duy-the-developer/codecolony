import { FileIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { SymbolKind } from '../../../shared/world-types.ts'
import { SYMBOL_COLORS } from '../../render.ts'
import { listSearchMatches, type SearchEntry, type SearchIndex } from '../../search-index.ts'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../ui/command.tsx'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog.tsx'
import { Kbd } from '../ui/kbd.tsx'

export interface SearchPaletteProps {
  isOpen: boolean
  index: SearchIndex | undefined
  onOpenChange(isOpen: boolean): void
  // Enter on a result: fly to it and select it.
  onPick(id: string): void
}

const MAX_PER_GROUP = 8

const SYMBOL_GLYPHS: Record<SymbolKind, string> = {
  function: 'ƒ',
  method: 'ƒ',
  class: 'C',
  interface: 'T',
  type: 'T',
  enum: 'E',
  variable: 'v',
  namespace: 'N',
}

// ⌘K: find a file or symbol by name.
export function SearchPalette({ isOpen, index, onOpenChange, onPick }: SearchPaletteProps) {
  const [query, setQuery] = useState('')
  const matches = useMemo(
    () => (index ? listSearchMatches(index, query, MAX_PER_GROUP) : { symbols: [], files: [] }),
    [index, query],
  )
  const count = matches.symbols.length + matches.files.length
  const handleOpenChange = (next: boolean) => {
    if (!next) setQuery('')
    onOpenChange(next)
  }
  const handlePick = (id: string) => {
    handleOpenChange(false)
    onPick(id)
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="top-2 max-w-[560px] overflow-hidden p-0">
        <DialogTitle className="sr-only">Search files and symbols</DialogTitle>
        <DialogDescription className="sr-only">
          Type a name, then press Enter to fly to it on the map.
        </DialogDescription>
        <Command shouldFilter={false} loop>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search files and symbols"
          />
          <CommandList>
            {query.trim() === '' ? (
              <p className="py-6 text-center text-muted-foreground text-sm">
                Type a file or symbol name.
              </p>
            ) : (
              <CommandEmpty>No file or symbol matches “{query.trim()}”.</CommandEmpty>
            )}
            {matches.symbols.length > 0 && (
              <CommandGroup heading="Symbols">
                {matches.symbols.map((entry) => (
                  <SearchResult key={entry.id} entry={entry} onPick={handlePick} />
                ))}
              </CommandGroup>
            )}
            {matches.files.length > 0 && (
              <CommandGroup heading="Files">
                {matches.files.map((entry) => (
                  <SearchResult key={entry.id} entry={entry} onPick={handlePick} />
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <div className="flex items-center gap-3 border-t px-3 py-2 text-muted-foreground text-xs">
            <span className="flex items-center gap-1">
              <Kbd>↑↓</Kbd> move
            </span>
            <span className="flex items-center gap-1">
              <Kbd>↵</Kbd> fly to and select
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd> close
            </span>
            {count > 0 && <span className="ml-auto">{count} results</span>}
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

interface SearchResultProps {
  entry: SearchEntry
  onPick(id: string): void
}

function SearchResult({ entry, onPick }: SearchResultProps) {
  const isSymbol = entry.kind === 'symbol'
  const folder = entry.path.slice(0, entry.path.length - entry.name.length)
  return (
    <CommandItem value={entry.id} onSelect={() => onPick(entry.id)}>
      <span
        className="flex size-6 shrink-0 items-center justify-center rounded border bg-muted font-mono font-semibold text-xs"
        style={
          isSymbol && entry.symbolKind ? { color: SYMBOL_COLORS[entry.symbolKind] } : undefined
        }
      >
        {isSymbol && entry.symbolKind ? (
          SYMBOL_GLYPHS[entry.symbolKind]
        ) : (
          <FileIcon className="size-3.5" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{entry.name}</span>
        <span className="truncate font-mono text-muted-foreground text-xs">
          {isSymbol ? `${entry.path}${entry.line ? `:${entry.line}` : ''}` : folder || '/'}
        </span>
      </span>
      <span className="shrink-0 text-muted-foreground text-xs">
        {isSymbol ? entry.symbolKind : `${entry.lines.toLocaleString()} lines`}
      </span>
    </CommandItem>
  )
}
