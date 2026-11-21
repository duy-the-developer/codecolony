import type { Node } from 'web-tree-sitter'
import type { TransportDetector } from '../../core/adapter.ts'
import type { TransportFact } from '../../core/model.ts'

// HTTP for TypeScript and JavaScript: client calls through fetch and common
// clients, and routes declared Express-style or by comparing the request path.

const CLIENT = `
((call_expression
  function: (identifier) @fn
  arguments: (arguments . [(string) (template_string)] @url))
  (#eq? @fn "fetch"))
((call_expression
  function: (member_expression object: (identifier) @client property: (property_identifier) @method)
  arguments: (arguments . [(string) (template_string)] @url))
  (#match? @client "^(axios|ky|got|superagent)$")
  (#match? @method "^(get|post|put|patch|delete|head)$"))
`

const ROUTE = `
((call_expression
  function: (member_expression object: (identifier) @router property: (property_identifier) @method)
  arguments: (arguments . (string) @url))
  (#match? @router "^(app|router|routes|fastify)$")
  (#match? @method "^(get|post|put|patch|delete|all)$"))
((binary_expression left: (identifier) @var right: (string) @url) @cmp
  (#match? @var "^(pathname|path|url|route)$"))
((binary_expression left: (string) @url right: (identifier) @var) @cmp
  (#match? @var "^(pathname|path|url|route)$"))
`

function literal(node: Node): string {
  // Template substitutions become :param, like route parameters.
  if (node.type === 'template_string') {
    return node.children
      .map((child) => {
        if (!child || child.type === '`') return ''
        return child.type === 'template_substitution' ? ':param' : child.text
      })
      .join('')
  }
  return node.text.slice(1, -1)
}

function methodOf(node: Node | undefined): string | undefined {
  const method = node?.text.toUpperCase()
  return method === undefined || method === 'ALL' ? undefined : method
}

const ID = 'typescript-http'

export const typescriptHttp: TransportDetector = {
  id: ID,
  version: 1,
  languages: ['typescript'],
  detect(tree, ctx) {
    const facts: TransportFact[] = []
    for (const [kind, source] of [
      ['http-client', CLIENT],
      ['http-route', ROUTE],
    ] as const) {
      for (const match of ctx.query(source).matches(tree.rootNode)) {
        const url = match.captures.find((c) => c.name === 'url')?.node
        if (!url) continue
        const cmp = match.captures.find((c) => c.name === 'cmp')?.node
        const operator = cmp?.childForFieldName('operator')?.type
        if (cmp && operator !== '===' && operator !== '==') continue
        const target = literal(url)
        if (kind === 'http-route' && !target.startsWith('/')) continue
        const fact: TransportFact = {
          kind,
          target,
          line: url.startPosition.row + 1,
          detector: ID,
          provenance: 'text',
        }
        const method = methodOf(match.captures.find((c) => c.name === 'method')?.node)
        if (method) fact.method = method
        facts.push(fact)
      }
    }
    return facts
  },
}
