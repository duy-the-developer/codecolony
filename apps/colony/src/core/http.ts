// Matches HTTP client targets to declared routes, language-agnostic.

const PARAM = /^(:\w+|\{\w+\}|\[\w+\]|<\w+>|\*)$/

// '/api/users/:id?x=1' and 'http://host:4320/api/users/${id}' both become
// ['api', 'users', '*'].
export function pathSegments(target: string): string[] | undefined {
  let path = target.trim()
  const scheme = path.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i)
  if (scheme) path = path.slice(scheme[0].length)
  // A client target that starts with a substitution (a base URL from config)
  // keeps only its literal path.
  path = path.replace(/^:param(?=\/)/, '')
  if (!path.startsWith('/')) return undefined
  path = path.split(/[?#]/)[0] ?? ''
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => (PARAM.test(segment) || segment.includes(':param') ? '*' : segment))
}

export function pathsMatch(client: string, route: string): boolean {
  const a = pathSegments(client)
  const b = pathSegments(route)
  if (!a || !b || a.length !== b.length) return false
  return a.every((segment, i) => segment === '*' || b[i] === '*' || segment === b[i])
}
