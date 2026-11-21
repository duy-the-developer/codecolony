import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  createDock,
  DOCK_CLI_OPTIONS,
  resolveDockOptions,
  securityHeaders,
} from '@codecolony/dock/server'
import { loadConfig } from '../config/load-config.ts'
import { Colony } from '../indexer/colony.ts'
import { log } from '../shared/log.ts'
import { createApi } from './api.ts'
import { isLoopbackHost } from './host.ts'
import { createStaticHandler, type Handler } from './static.ts'

const HOST = '127.0.0.1'
const WATCH_MS = 2000

const appRoot = fileURLToPath(new URL('../../', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const { values: args } = parseArgs({ options: { dev: { type: 'boolean' }, ...DOCK_CLI_OPTIONS } })
const dev = args.dev ?? false

const config = loadConfig({ repoRoot })
const colony = new Colony(config)
await colony.refresh()
colony.watch(WATCH_MS)
const api = createApi(config, colony)
const dockOptions = resolveDockOptions(args)
const dock = createDock(dockOptions)
const headers = securityHeaders({ dev })

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
  web = createStaticHandler(`${appRoot}dist/web`)
}

const server = createServer((req, res) => {
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value)
  if (!isLoopbackHost(req.headers.host)) {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('Forbidden host')
    return
  }
  if (!dock.handle(req, res) && !api(req, res)) web(req, res)
})

// The terminal dock's WebSocket; the dock checks host, origin and token itself.
server.on('upgrade', (req, socket, head) => {
  if (!dock.upgrade(req, socket, head)) socket.destroy()
})

// Loopback only: the page shows local source code and agent terminals.
// The token sits in the URL fragment, which browsers never send to the server.
server.listen(config.port, HOST, () => {
  log('Code Colony is running', {
    url: `http://${HOST}:${config.port}/#token=${dock.token}`,
    mode: dev ? 'dev' : 'built',
    herdr: dockOptions.enabled ? 'on' : 'off',
    config: config.source,
  })
})

// Stop language servers and the dock's terminals with the app.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    dock.close()
    server.close()
    colony.close().finally(() => process.exit(0))
  })
}
