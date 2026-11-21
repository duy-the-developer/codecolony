import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { Colony } from '../indexer/colony.ts'
import { createApi } from './api.ts'
import { loadConfig } from './config.ts'
import { isLoopbackHost } from './host.ts'
import { type Handler, staticFiles } from './static.ts'

const HOST = '127.0.0.1'
const DEFAULT_PORT = 4320
const WATCH_MS = 2000

const appRoot = fileURLToPath(new URL('../../', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const dev = process.argv.includes('--dev')
const port = Number(process.env.PORT ?? DEFAULT_PORT)

const config = loadConfig({ repoRoot })
const colony = new Colony(config)
await colony.refresh()
colony.watch(WATCH_MS)
const api = createApi(config, colony)

let web: Handler
if (dev) {
  const { createServer: createVite } = await import('vite')
  const vite = await createVite({
    configFile: `${appRoot}vite.config.ts`,
    server: { middlewareMode: true },
    appType: 'spa',
  })
  web = vite.middlewares
} else {
  web = staticFiles(`${appRoot}dist/web`)
}

const server = createServer((req, res) => {
  if (!isLoopbackHost(req.headers.host)) {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden host')
    return
  }
  if (!api(req, res)) web(req, res)
})

// Loopback only: the page shows local source code and, later, agent terminals.
server.listen(port, HOST, () => {
  console.log(
    `Code Colony on http://${HOST}:${port} (${dev ? 'dev' : 'built'}; config: ${config.source})`,
  )
})
