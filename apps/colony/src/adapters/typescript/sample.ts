import type { AdapterSample } from '../contract.ts'

// The TypeScript adapter's contract sample: a tiny synthetic repository and
// what the adapter must find in it.

export const typescriptSample: AdapterSample = {
  files: {
    'src/math.ts': [
      'export function add(a: number, b: number): number {',
      '  return a + b',
      '}',
      '',
      'export class Calc {',
      '  total = 0',
      '  plus(n: number): number {',
      '    this.total = add(this.total, n)',
      '    return this.total',
      '  }',
      '}',
      '',
    ].join('\n'),
    'src/types.ts': [
      'export interface Point { x: number; y: number }',
      'export type Id = string',
      'export enum Color { Red, Green }',
      '',
    ].join('\n'),
    'src/app.ts': [
      "import { add, Calc } from './math'",
      "import type { Point } from './types.ts'",
      '',
      'export function run(p: Point): number {',
      '  const calc = new Calc()',
      '  if (p.x > 0 && p.y > 0) calc.plus(p.x)',
      '  return add(p.x, p.y)',
      '}',
      '',
      'export async function load(): Promise<unknown> {',
      "  const res = await fetch('/api/points')",
      '  return res.json()',
      '}',
      '',
    ].join('\n'),
    'src/server.ts': [
      'export function handle(pathname: string): string {',
      "  if (pathname === '/api/points') return 'points'",
      "  return 'none'",
      '}',
      '',
    ].join('\n'),
  },
  symbols: [
    { path: 'src/math.ts', name: 'add', kind: 'function', exported: true, lines: [1, 3] },
    { path: 'src/math.ts', name: 'Calc', kind: 'class', exported: true, lines: [5, 11] },
    { path: 'src/math.ts', name: 'plus', container: 'Calc', kind: 'method', lines: [7, 10] },
    { path: 'src/types.ts', name: 'Point', kind: 'interface', exported: true },
    { path: 'src/types.ts', name: 'Id', kind: 'type', exported: true },
    { path: 'src/types.ts', name: 'Color', kind: 'enum', exported: true },
    { path: 'src/app.ts', name: 'run', kind: 'function', exported: true, complexity: 2 },
    { path: 'src/app.ts', name: 'load', kind: 'function', exported: true },
  ],
  imports: [
    { from: 'src/app.ts', to: 'src/math.ts' },
    { from: 'src/app.ts', to: 'src/types.ts', typeOnly: true },
  ],
  calls: [
    { from: 'src/app.ts#run', to: 'src/math.ts#add' },
    { from: 'src/app.ts#run', to: 'src/math.ts#Calc' },
    { from: 'src/math.ts#Calc.plus', to: 'src/math.ts#add' },
  ],
  // A member call only a language server can resolve.
  semanticCalls: [
    { from: 'src/app.ts#run', to: 'src/math.ts#Calc.plus' },
    { from: 'src/app.ts#run', to: 'src/math.ts#add' },
  ],
  transports: [
    { path: 'src/app.ts', kind: 'http-client', target: '/api/points' },
    { path: 'src/server.ts', kind: 'http-route', target: '/api/points' },
  ],
  http: [{ from: 'src/app.ts', to: 'src/server.ts' }],
}
