import { z } from 'zod'

// Globally disable JIT code generation if supported (e.g. Zod v4 strict CSP policies without 'unsafe-eval')
const maybeZod = z as Record<string, unknown>
if (typeof maybeZod['config'] === 'function') {
  ;(maybeZod['config'] as (options: { jitless: boolean }) => void)({ jitless: true })
}

export { z }
export default z
