import { readFileSync } from 'node:fs'
import {
  emptyLayout,
  type LayoutStore,
  type StoredModule,
  type StoredRow,
} from '../layout/world-layout.ts'
import { writeAtomic } from './atomic-write.ts'

// Keeps the layout store on disk between runs, so the map keeps its shape
// across commits and restarts.

// Bumped when stored layouts can no longer be read as they are; older ones are
// dropped and the world is laid out afresh. Version 3 keeps the files of a
// repository's or package's own folder as loose files instead of a root module;
// version 4 nests a folder's subfolders inside its module.
const STORE_VERSION = 4

interface StoredLayout {
  version: number
  rows: Record<string, StoredRow[]>
  modules: Record<string, StoredModule>
}

export function loadLayout(path: string): LayoutStore {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<StoredLayout>
    if (raw.version !== STORE_VERSION) return emptyLayout()
    return {
      rows: new Map(Object.entries(raw.rows ?? {})),
      modules: new Map(Object.entries(raw.modules ?? {})),
    }
  } catch {
    return emptyLayout()
  }
}

export function saveLayout(path: string, store: LayoutStore): void {
  const raw: StoredLayout = {
    version: STORE_VERSION,
    rows: Object.fromEntries(store.rows),
    modules: Object.fromEntries(store.modules),
  }
  writeAtomic(path, JSON.stringify(raw))
}
