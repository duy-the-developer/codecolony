// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { Scene } from '../../../modules/scene/scene.ts'
import type { FileResponse } from '../../../modules/wire/api-types.ts'
import type { World, WorldNode } from '../../../modules/world/world-types.ts'
import { FileTab } from './file-tab.tsx'

// The real module loads the terminal too; only the token matters here.
vi.mock('@codecolony/dock/web', () => ({ readToken: () => 'secret' }))

const RECT = { x: 0, y: 0, w: 1, h: 1 }
const FILE_ID = 'p/r/src/pack.ts'
const TEXT =
  'export interface PackItem {\n  id: string\n}\n\nexport function pack() {\n  return 1\n}\n'

function node(fields: Partial<WorldNode> & Pick<WorldNode, 'id' | 'kind' | 'name'>): WorldNode {
  return { lines: 1, complexity: 1, rect: RECT, ...fields }
}

const SCENE = new Scene({
  version: 1,
  indexedAt: '',
  languages: {},
  nodes: [
    node({ id: 'world', kind: 'world', name: 'world' }),
    node({ id: 'p/r', parent: 'world', kind: 'repo', name: 'r', commit: '55af102deadbeef' }),
    node({
      id: FILE_ID,
      parent: 'p/r',
      kind: 'file',
      name: 'pack.ts',
      path: 'src/pack.ts',
      lines: 7,
      language: 'typescript',
    }),
    node({
      id: `${FILE_ID}#pack`,
      parent: FILE_ID,
      kind: 'symbol',
      name: 'pack',
      symbolKind: 'function',
      range: { start: 5, end: 7 },
    }),
    node({
      id: `${FILE_ID}#PackItem`,
      parent: FILE_ID,
      kind: 'symbol',
      name: 'PackItem',
      symbolKind: 'interface',
      range: { start: 1, end: 3 },
    }),
  ],
  edges: [],
} satisfies World)

function serve(response: Response) {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(response))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function fileResponse(): Response {
  const body: FileResponse = {
    id: FILE_ID,
    path: 'src/pack.ts',
    commit: '55af102deadbeef',
    isBinary: false,
    text: TEXT,
  }
  return new Response(JSON.stringify(body))
}

describe('FileTab', () => {
  beforeAll(() => {
    // CodeMirror measures text after rendering; jsdom has no layout.
    Range.prototype.getClientRects = () => ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: [][Symbol.iterator],
    })
    Range.prototype.getBoundingClientRect = () => new DOMRect()
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows the file read only with its path, facts and code', async () => {
    const fetchMock = serve(fileResponse())
    render(<FileTab scene={SCENE} selected={SCENE.byId.get(FILE_ID)} onPick={() => {}} />)

    expect(screen.getByText('src/').nextSibling?.textContent).toBe('pack.ts')
    expect(screen.getByText('READ ONLY').parentElement?.textContent).toBe(
      'READ ONLYTypeScript · 7 lines · 55af102',
    )
    expect(await screen.findByText('export function pack() {')).toBeTruthy()
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe(`/api/file?id=${encodeURIComponent(FILE_ID)}`)
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret')
    expect(screen.getByTestId('code-view').querySelector('[contenteditable="true"]')).toBeNull()
  })

  it('lists symbols in line order and marks the selected one', async () => {
    serve(fileResponse())
    const onPick = vi.fn()
    render(<FileTab scene={SCENE} selected={SCENE.byId.get(`${FILE_ID}#pack`)} onPick={onPick} />)

    const chips = within(screen.getByRole('list', { name: 'Symbols' })).getAllByRole('button')
    expect(chips.map((chip) => chip.textContent)).toEqual(['TPackItem', 'ƒpack'])
    expect(chips.map((chip) => chip.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
    await screen.findByText('export function pack() {')
    const highlighted = document.querySelectorAll('.cm-highlighted-line')
    expect([...highlighted].map((line) => line.textContent)).toEqual([
      'export function pack() {',
      '  return 1',
      '}',
    ])

    fireEvent.click(chips[0] as HTMLElement)
    expect(onPick).toHaveBeenCalledWith(`${FILE_ID}#PackItem`)
    fireEvent.click(screen.getByRole('button', { name: /Reveal on map/ }))
    expect(onPick).toHaveBeenLastCalledWith(FILE_ID)
  })

  it('says why the text could not be loaded', async () => {
    serve(new Response(JSON.stringify({ error: 'missing or wrong token' }), { status: 401 }))
    render(<FileTab scene={SCENE} selected={SCENE.byId.get(FILE_ID)} onPick={() => {}} />)
    expect(await screen.findByText(/Token not accepted/)).toBeTruthy()
  })

  it('asks for a file when nothing is selected', () => {
    render(<FileTab scene={SCENE} selected={undefined} onPick={() => {}} />)
    expect(screen.getByText(/Select a file on the map/)).toBeTruthy()
  })
})
