import { z } from 'zod'

// Globally disable JIT code generation to comply with strict CSP policies without 'unsafe-eval'
if (typeof (z as any).config === 'function') {
  ;(z as any).config({ jitless: true })
}

export { z }
export default z


