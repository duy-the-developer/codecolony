import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { TOKEN_PROTOCOL_PREFIX } from '../shared/protocol.ts'

const TOKEN_BYTES = 32

// A fresh random token for one server run; never persisted.
export function createToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url')
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}

// Constant-time comparison; hashing first equalizes the lengths.
export function tokensMatch(expected: string, given: string | undefined): boolean {
  if (!expected || !given) return false
  return timingSafeEqual(digest(expected), digest(given))
}

const LOOPBACK_NAMES = ['127.0.0.1', 'localhost']

// The Host header must name the loopback address and this server's port.
// This defeats DNS rebinding: a remote page that resolves its own name to
// 127.0.0.1 still sends its own name as Host.
export function isAllowedHost(host: string | undefined, port: number): boolean {
  return LOOPBACK_NAMES.some((name) => host?.toLowerCase() === `${name}:${port}`)
}

// Requests that carry an Origin, and every WebSocket upgrade, must come from a
// page this server served.
export function isAllowedOrigin(origin: string | undefined, port: number): boolean {
  return LOOPBACK_NAMES.some((name) => origin === `http://${name}:${port}`)
}

// Reads the token from a `Sec-WebSocket-Protocol` header value.
export function tokenFromProtocols(header: string | undefined): string | undefined {
  const entry = header
    ?.split(',')
    .map((value) => value.trim())
    .find((value) => value.startsWith(TOKEN_PROTOCOL_PREFIX))
  return entry?.slice(TOKEN_PROTOCOL_PREFIX.length)
}

// Reads the token from an `Authorization: Bearer <token>` header value.
export function tokenFromAuthorization(header: string | undefined): string | undefined {
  return header?.match(/^Bearer (\S+)$/)?.[1]
}
