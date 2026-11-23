import { describe, expect, it } from 'vitest'
import { resolveImport } from './adapter.ts'

describe('python resolveImport', () => {
  it('resolves absolute imports from the repository root', () => {
    const files = new Set(['app/__init__.py', 'app/models.py', 'app/api/__init__.py'])
    expect(resolveImport('app.models', 'app/api/__init__.py', files)).toBe('app/models.py')
    expect(resolveImport('app.api', 'app/models.py', files)).toBe('app/api/__init__.py')
    // `from app.models import User` names a class, so the module answers.
    expect(resolveImport('app.models.User', 'app/api/__init__.py', files)).toBe('app/models.py')
  })

  it('resolves relative imports', () => {
    const files = new Set(['pkg/__init__.py', 'pkg/a.py', 'pkg/sub/__init__.py', 'pkg/sub/b.py'])
    expect(resolveImport('.a', 'pkg/__init__.py', files)).toBe('pkg/a.py')
    expect(resolveImport('..a', 'pkg/sub/b.py', files)).toBe('pkg/a.py')
    expect(resolveImport('.', 'pkg/sub/b.py', files)).toBe('pkg/sub/__init__.py')
    // `from . import helper` where helper is defined in __init__.py.
    expect(resolveImport('..helper', 'pkg/sub/b.py', files)).toBe('pkg/__init__.py')
    expect(resolveImport('...x', 'pkg/sub/b.py', files)).toBeUndefined()
  })

  it('starts from src/ and from folders holding a pyproject.toml or setup.cfg', () => {
    const files = new Set([
      'backend/pyproject.toml',
      'backend/app/__init__.py',
      'backend/app/core/config.py',
      'backend/app/main.py',
      'lib/setup.cfg',
      'lib/src/tools/__init__.py',
      'lib/src/tools/text.py',
    ])
    expect(resolveImport('app.core.config.settings', 'backend/app/main.py', files)).toBe(
      'backend/app/core/config.py',
    )
    expect(resolveImport('tools.text', 'backend/app/main.py', files)).toBe('lib/src/tools/text.py')
  })

  it('prefers the project root that holds the importing file', () => {
    const files = new Set([
      'a/pyproject.toml',
      'a/app/__init__.py',
      'b/pyproject.toml',
      'b/app/__init__.py',
      'b/app/main.py',
    ])
    expect(resolveImport('app', 'b/app/main.py', files)).toBe('b/app/__init__.py')
  })

  it('resolves modules inside namespace packages', () => {
    const files = new Set(['ns/plugins/web.py', 'main.py'])
    expect(resolveImport('ns.plugins.web', 'main.py', files)).toBe('ns/plugins/web.py')
    expect(resolveImport('ns', 'main.py', files)).toBeUndefined()
  })

  it('drops third-party and standard library imports', () => {
    const files = new Set(['app/__init__.py', 'app/email.py', 'app/main.py'])
    expect(resolveImport('flask', 'app/main.py', files)).toBeUndefined()
    expect(resolveImport('fastapi.APIRouter', 'app/main.py', files)).toBeUndefined()
    // Inside a package, `import email` is the standard library, not app/email.py.
    expect(resolveImport('email', 'app/main.py', files)).toBeUndefined()
  })

  it('lets a script outside a package import from its own folder', () => {
    const files = new Set(['scripts/run.py', 'scripts/helpers.py'])
    expect(resolveImport('helpers', 'scripts/run.py', files)).toBe('scripts/helpers.py')
  })
})
