import type { Edge, WorldNode } from '../shared/world-types.ts'
import { EDGE_COLORS, PROVEN_PROVENANCES } from './render.ts'
import type { Scene } from './scene.ts'

// The card for the selected node: its facts, and every road in or out with
// how it was proven.

export interface InspectorActions {
  select(id: string): void
  trace(file: WorldNode): Promise<void>
}

const MAX_ROADS = 14

export function renderInspector(
  root: HTMLElement,
  scene: Scene,
  node: WorldNode | undefined,
  subtree: ReadonlySet<string>,
  actions: InspectorActions,
): void {
  root.hidden = node === undefined
  if (!node) return
  const kind = node.kind === 'symbol' ? (node.symbolKind ?? 'symbol') : node.kind
  const repo = scene.repoOf(node)
  root.replaceChildren(
    el('h3', {}, node.name),
    el('p', { class: 'muted' }, [kind, node.path].filter(Boolean).join(' · ')),
    facts([
      ['Lines', node.range ? `${node.range.start}-${node.range.end}` : node.lines.toLocaleString()],
      ['Branches', node.complexity.toLocaleString()],
      ['Language', node.language],
      ['Exported', node.exported === undefined ? undefined : node.exported ? 'yes' : 'no'],
      ['Package', node.package ? 'yes (manifest)' : undefined],
      ['Commit', (node.commit ?? (node.kind === 'repo' ? undefined : repo?.commit))?.slice(0, 8)],
    ]),
  )

  if (node.transports?.length) {
    root.append(el('h4', {}, 'Transport'))
    root.append(
      list(
        node.transports.map((t) =>
          row(
            `${t.kind} ${t.method ?? ''} ${t.target}`.replace(/\s+/g, ' '),
            `line ${t.line}`,
            t.provenance,
          ),
        ),
      ),
    )
  }

  const out: Edge[] = []
  const into: Edge[] = []
  for (const edge of scene.edges) {
    const fromInside = subtree.has(edge.from)
    const toInside = subtree.has(edge.to)
    if (fromInside && !toInside) out.push(edge)
    else if (toInside && !fromInside) into.push(edge)
  }
  for (const [title, edges, end] of [
    ['Roads out', out, 'to'],
    ['Roads in', into, 'from'],
  ] as const) {
    if (edges.length === 0) continue
    root.append(el('h4', {}, `${title} (${edges.length})`))
    // One row per kind, other end and provenance, with the first line seen.
    const groups = new Map<string, { edge: Edge; count: number }>()
    for (const edge of edges) {
      const key = `${edge.kind}|${edge[end]}|${edge.provenance}`
      const group = groups.get(key)
      if (group) group.count++
      else groups.set(key, { edge, count: 1 })
    }
    const sorted = [...groups.values()].sort((a, b) => b.count - a.count)
    const items = sorted.slice(0, MAX_ROADS).map(({ edge, count }) => {
      const other = scene.byId.get(edge[end])
      const where = count > 1 ? `×${count}` : edge.at ? `line ${edge.at.line}` : ''
      const item = row(
        `${edge.kind} ${describe(scene, other)}`,
        where,
        edge.provenance,
        EDGE_COLORS[edge.kind],
      )
      if (other) {
        item.classList.add('link')
        item.addEventListener('click', () => actions.select(other.id))
      }
      return item
    })
    if (sorted.length > MAX_ROADS)
      items.push(el('li', { class: 'muted' }, `+ ${sorted.length - MAX_ROADS} more`))
    root.append(list(items))
  }

  if (node.kind === 'file' && node.language && scene.world.languages[node.language]?.semantic) {
    const button = el('button', { type: 'button' }, 'Trace calls with the language server')
    const status = el('p', { class: 'muted' }, '')
    button.addEventListener('click', () => {
      button.disabled = true
      status.textContent = 'Asking the language server...'
      actions.trace(node).catch((error: unknown) => {
        button.disabled = false
        status.textContent = `Failed: ${(error as Error).message}`
      })
    })
    root.append(button, status)
  }
}

function describe(scene: Scene, node: WorldNode | undefined): string {
  if (!node) return '(outside the map)'
  if (node.kind !== 'symbol') return node.path ?? node.name
  const file = node.id.slice(0, node.id.indexOf('#'))
  return `${node.name} (${scene.byId.get(file)?.name ?? ''})`
}

function facts(entries: [string, string | undefined][]): HTMLElement {
  const dl = el('dl', {})
  for (const [key, value] of entries) {
    if (value === undefined || value === '') continue
    dl.append(el('dt', {}, key), el('dd', {}, value))
  }
  return dl
}

function list(items: HTMLElement[]): HTMLElement {
  const ul = el('ul', {})
  ul.append(...items)
  return ul
}

function row(text: string, where: string, provenance: string, color?: string): HTMLElement {
  const li = el('li', {})
  if (color) {
    const swatch = el('span', { class: 'swatch' })
    swatch.style.background = color
    li.append(swatch)
  }
  const proven = PROVEN_PROVENANCES.has(provenance as Edge['provenance'])
  li.append(
    el('span', {}, text),
    el('span', { class: 'muted' }, ` ${where}`),
    el('span', { class: `tag ${proven ? 'proven' : 'weak'}` }, provenance),
  )
  return li
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value)
  if (text !== undefined) element.textContent = text
  return element
}
