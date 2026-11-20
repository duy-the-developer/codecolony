import { createReadStream, existsSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, join, normalize, sep } from 'node:path'

export type Handler = (req: IncomingMessage, res: ServerResponse) => void

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

// Serves the built page; unknown paths fall back to index.html.
export function staticFiles(dir: string): Handler {
  const root = normalize(dir + sep)
  return (req, res) => {
    let path: string
    try {
      path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)
    } catch {
      res.writeHead(400).end()
      return
    }
    let file = normalize(join(root, path))
    if (!file.startsWith(root)) {
      res.writeHead(403).end()
      return
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html')
    if (!existsSync(file)) {
      res
        .writeHead(404, { 'content-type': 'text/plain' })
        .end('Run `pnpm build` first, or use `pnpm dev`.')
      return
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
    createReadStream(file).pipe(res)
  }
}
