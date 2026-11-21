import { describe, expect, it } from 'vitest'
import { pathSegments, pathsMatch } from './http.ts'

describe('HTTP path matching', () => {
  it.each([
    ['/api/projects', '/api/projects', true],
    ['http://localhost:4320/api/projects?x=1', '/api/projects', true],
    ['/api/users/:param', '/api/users/:id', true],
    [':param/api/users/7', '/api/users/{id}', true],
    ['/api/users/7', '/api/users/[id]', true],
    ['/api/users', '/api/users/:id', false],
    ['/api/projects', '/api/world', false],
    ['relative/path', '/relative/path', false],
  ])('%s vs %s -> %s', (client, route, expected) => {
    expect(pathsMatch(client, route)).toBe(expected)
  })

  it('normalises parameters and drops the origin and query', () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a URL template as written in source
    expect(pathSegments('https://api.example.com/v1/items/${id}?q=1')).toEqual(['v1', 'items', '*'])
  })
})
