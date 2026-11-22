import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { emptyLayout } from '../layout/world-layout.ts'
import { loadLayout, saveLayout } from './layout-store.ts'

describe('loadLayout', () => {
  it('reads back what saveLayout wrote', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'codecolony-layout-')), 'layout.json')
    const store = emptyLayout()
    store.rows.set('p/r', [{ h: 4, slots: [['p/r/package:a', 'p/r/package:b'], ['p/r/docs']] }])
    store.modules.set('p/r/docs', { files: ['p/r/docs/a.md', 'p/r/docs/b.md'], h: 2 })
    saveLayout(path, store)
    expect(loadLayout(path)).toEqual(store)
  })

  it('drops a layout saved in an older format', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'codecolony-layout-')), 'layout.json')
    writeFileSync(path, JSON.stringify({ slots: { world: {} }, pads: {} }))
    expect(loadLayout(path)).toEqual(emptyLayout())
  })

  it('drops a version 2 layout that kept root modules', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'codecolony-layout-')), 'layout.json')
    const v2 = {
      version: 2,
      rows: { 'p/r': [{ h: 4, slots: [['p/r/package:.']] }] },
      modules: { 'p/r/.': { files: ['p/r/README.md'], h: 1 } },
    }
    writeFileSync(path, JSON.stringify(v2))
    expect(loadLayout(path)).toEqual(emptyLayout())
  })
})
