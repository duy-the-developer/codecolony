// One log format for the server, the indexer and the page: a fixed message
// plus a context object, so lines stay easy to search. Primitive context values
// print as key=value; objects (errors) go to the console as they are, so it
// can show their stack.

export type LogContext = Record<string, unknown>

const PREFIX = '[codecolony]'

export function log(message: string, context: LogContext = {}): void {
  write(console.log, message, context)
}

export function logError(message: string, context: LogContext = {}): void {
  write(console.error, message, context)
}

function write(print: (...data: unknown[]) => void, message: string, context: LogContext): void {
  const fields: string[] = []
  const objects: unknown[] = []
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === 'object' && value !== null) objects.push(value)
    else fields.push(`${key}=${String(value)}`)
  }
  print([PREFIX, message, ...fields].join(' '), ...objects)
}
