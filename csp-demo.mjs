// Run with code generation blocked, the way a strict CSP or an edge runtime
// blocks it:
//
//   node --disallow-code-generation-from-strings csp-demo.mjs
//
// z.compile builds its fast path with new Function, so it dies here. The same
// schema through ata falls back to ata's interpreted engine and keeps
// answering, with the same verdicts.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { z } = require('zod')
const { compile } = require('./index.js')

const schema = z.object({ id: z.number().int().min(1), name: z.string().min(1) })
const good = { id: 1, name: 'ada' }
const bad = { id: 0, name: '' }

try {
  const zc = z.compile(schema)
  console.log('z.compile:', zc.safeParse(good).success, zc.safeParse(bad).success)
} catch (e) {
  console.log('z.compile: threw at compile time:', e.constructor.name + ':', e.message.slice(0, 60))
}

const ata = compile(schema)
console.log('ata     :', ata.isValid(good), ata.isValid(bad), '(engine: ' + ata.engine + ')')
