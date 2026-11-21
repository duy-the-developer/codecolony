import { describe, expect, it } from 'vitest'
import {
  createToken,
  isAllowedHost,
  isAllowedOrigin,
  tokenFromAuthorization,
  tokenFromProtocols,
  tokensMatch,
} from './auth.ts'

describe('tokens', () => {
  it('creates distinct url-safe tokens', () => {
    const a = createToken()
    expect(a).toMatch(/^[\w-]{43}$/)
    expect(createToken()).not.toBe(a)
  })

  it('matches only the same token', () => {
    const token = createToken()
    expect(tokensMatch(token, token)).toBe(true)
    expect(tokensMatch(token, `${token}x`)).toBe(false)
    expect(tokensMatch(token, '')).toBe(false)
    expect(tokensMatch(token, undefined)).toBe(false)
    expect(tokensMatch('', '')).toBe(false)
  })

  it('reads the token from the subprotocol header', () => {
    expect(tokenFromProtocols('codecolony-dock.v1, token.abc-123')).toBe('abc-123')
    expect(tokenFromProtocols('codecolony-dock.v1')).toBeUndefined()
    expect(tokenFromProtocols(undefined)).toBeUndefined()
  })

  it('reads the token from a bearer header', () => {
    expect(tokenFromAuthorization('Bearer abc-123')).toBe('abc-123')
    expect(tokenFromAuthorization('Basic abc')).toBeUndefined()
    expect(tokenFromAuthorization('Bearer a b')).toBeUndefined()
    expect(tokenFromAuthorization(undefined)).toBeUndefined()
  })
})

describe('isAllowedHost', () => {
  it.each(['127.0.0.1:4320', 'localhost:4320', 'LOCALHOST:4320'])('accepts %s', (host) => {
    expect(isAllowedHost(host, 4320)).toBe(true)
  })

  it.each([
    undefined,
    '127.0.0.1',
    '127.0.0.1:4321',
    'evil.example:4320',
    'localhost.evil.example:4320',
    '0.0.0.0:4320',
  ])('rejects %s', (host) => {
    expect(isAllowedHost(host, 4320)).toBe(false)
  })
})

describe('isAllowedOrigin', () => {
  it('accepts this server', () => {
    expect(isAllowedOrigin('http://127.0.0.1:4320', 4320)).toBe(true)
    expect(isAllowedOrigin('http://localhost:4320', 4320)).toBe(true)
  })

  it.each([
    undefined,
    'null',
    'http://evil.example',
    'http://127.0.0.1:4321',
    'https://127.0.0.1:4320',
  ])('rejects %s', (origin) => {
    expect(isAllowedOrigin(origin, 4320)).toBe(false)
  })
})
