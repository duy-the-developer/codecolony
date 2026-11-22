import { FileIcon } from 'lucide-react'
import { type KeyboardEvent, useEffect, useState } from 'react'
import { logError } from '../../../modules/logging/log.ts'
import { SYMBOL_COLORS } from '../../../modules/theme/palette.ts'
import { SYMBOL_GLYPHS } from '../../../modules/theme/symbol-glyphs.ts'
import type { SearchEntry, SearchMatches } from '../../../modules/wire/api-types.ts'
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
  // Asks the server for the best matches; the page does not hold every symbol.
  fetchMatches(query: string, limit: number): Promise<SearchMatches>
  onOpenChange(isOpen: boolean): void
  // Enter on a result: fly to it and select it.
  onPick(id: string): void
  // ⇧Enter on a result: select it and show its file in the File tab.
  onOpen(id: string): void
}

const MAX_PER_GROUP = 8
const NO_MATCHES: SearchMatches = { symbols: [], files: [] }

// ⌘K: find a file or symbol by name.
export function SearchPalette({
  isOpen,
  fetchMatches,
  onOpenChange,
  onPick,
  onOpen,
}: SearchPaletteProps) {
  const [query, setQuery] = useState('')
  // The highlighted result's id, which cmdk keeps as the item value.
  const [active, setActive] = useState('')
  const [matches, setMatches] = useState(NO_MATCHES)
  // Only the answer to the latest query is shown.
  useEffect(() => {
    if (query.trim() === '') {
      setMatches(NO_MATCHES)
      return
    }
    let isCurrent = true
    fetchMatches(query, MAX_PER_GROUP).then(
      (next) => {
        if (isCurrent) setMatches(next)
      },
      (error: unknown) => logError('Search failed', { error }),
    )
    return () => {
      isCurrent = false
    }
  }, [query, fetchMatches])
  const count = matches.symbols.length + matches.files.length
  const handleOpenChange = (next: boolean) => {
    if (!next) setQuery('')
    onOpenChange(next)
  }
  const handlePick = (id: string) => {
    handleOpenChange(false)
    onPick(id)
  }
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' || !event.shiftKey || !active) return
    event.preventDefault()
    handleOpenChange(false)
    onOpen(active)
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="top-2 max-w-[560px] overflow-hidden p-0">
        <DialogTitle className="sr-only">Search files and symbols</DialogTitle>
        <DialogDescription className="sr-only">
          Type a name, then press Enter to fly to it on the map, or Shift+Enter to open its file.
        </DialogDescription>
        <Command
          shouldFilter={false}
          loop
          value={active}
          onValueChange={setActive}
          onKeyDown={handleKeyDown}
        >
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
              <Kbd>⇧↵</Kbd> open file
            </span>
            <span className="flex items-center gap-1">
              <Kbd>esc</Kbd> close
            </span>
            {count > 0 && (
              <span className="ml-auto">
                {count} {count === 1 ? 'result' : 'results'}
              </span>
            )}
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
