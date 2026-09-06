'use strict'

// Differential harness: whatever mode the classifier picks, the compiled
// object must agree with zod itself on every value. zod is the reference;
// any disagreement is a bug here, never in zod.

const assert = require('assert')
const { z } = require('zod')
const { compile, analyze } = require('./index.js')

let checked = 0
let passed = 0

function ok (name, cond) {
  assert.strictEqual(cond, true, name)
  passed++
}

// A blunt JSON-value mutator: enough to knock a valid sample into most of the
// interesting invalid shapes without knowing the schema.
function mutate (value, rng) {
  const roll = rng()
  if (value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
    const keys = Object.keys(value)
    const out = { ...value }
    if (keys.length > 0) {
      const k = keys[Math.floor(rng() * keys.length)]
      if (roll < 0.3) delete out[k]
      else if (roll < 0.6) out[k] = mutate(out[k], rng)
      else if (roll < 0.8) out[k] = roll < 0.7 ? 'x' : 42
      else out['extra_' + Math.floor(rng() * 10)] = roll
    }
    return out
  }
  if (Array.isArray(value)) {
    const out = value.slice()
    if (roll < 0.4 && out.length) out[Math.floor(rng() * out.length)] = mutate(out[0], rng)
    else if (roll < 0.7) out.push(roll < 0.55 ? 'x' : { bad: true })
    else return roll < 0.85 ? 'not an array' : out.slice(1)
    return out
  }
  if (typeof value === 'string') return roll < 0.3 ? 123 : roll < 0.6 ? '' : value + '!'
  if (typeof value === 'number') return roll < 0.3 ? 'NaN' : roll < 0.6 ? -value - 1000 : value + 0.5
  if (typeof value === 'boolean') return roll < 0.5 ? 'true' : 0
  if (value instanceof Date) return roll < 0.5 ? value.toISOString() : {}
  return roll < 0.5 ? null : { unexpected: true }
}

function lcg (seed) {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296)
}

function differential (name, schema, samples, expectedMode) {
  const compiled = compile(schema)
  if (expectedMode) {
    ok(name + ': classified as ' + expectedMode + ' (got ' + compiled.engine + ')', compiled.engine === expectedMode)
  }
  const rng = lcg(0xa7a)
  const values = [undefined, null, 0, '', 'x', 42, true, [], {}, [1, 'x'], { unexpected: 1 }]
  for (const s of samples) {
    values.push(s)
    let v = s
    for (let i = 0; i < 400; i++) {
      v = i % 5 === 0 ? mutate(s, rng) : mutate(v, rng)
      values.push(v)
    }
  }
  for (const v of values) {
    checked++
    const want = schema.safeParse(v).success
    const got = compiled.isValid(v)
    if (got !== want) {
      throw new Error(name + ': isValid disagrees with zod on ' + JSON.stringify(v) + ' (zod ' + want + ', got ' + got + ')')
    }
    const sp = compiled.safeParse(v)
    if (sp.success !== want) {
      throw new Error(name + ': safeParse disagrees with zod on ' + JSON.stringify(v))
    }
    if (want && sp.success) {
      const ref = schema.safeParse(v)
      assert.deepStrictEqual(sp.data, ref.data, name + ': parsed value differs from zod for ' + JSON.stringify(v))
    }
  }
  passed++
  return compiled
}

// 1. exact conversions: ata answers alone
differential('flat object', z.object({
  id: z.number().int().min(1),
  name: z.string().min(1).max(64),
  role: z.enum(['admin', 'user']),
  bio: z.string().optional(),
  score: z.number().nullable(),
}), [
  { id: 1, name: 'a', role: 'admin', score: null },
  { id: 9, name: 'bob', role: 'user', bio: 'hi', score: 3.5 },
], 'ata')

differential('nested + arrays', z.object({
  tags: z.array(z.string().min(1)).max(5),
  point: z.tuple([z.number(), z.number()]),
  nested: z.object({ ok: z.boolean(), list: z.array(z.object({ n: z.number() })) }),
  mixed: z.union([z.string(), z.number()]),
  dict: z.record(z.string(), z.number()),
}), [
  { tags: ['a'], point: [1, 2], nested: { ok: true, list: [{ n: 1 }] }, mixed: 'x', dict: { a: 1 } },
], 'ata')

differential('strict object', z.strictObject({ a: z.number(), b: z.string() }), [
  { a: 1, b: 'x' },
], 'ata')

differential('formats', z.object({
  email: z.string().email(),
  uuid: z.string().uuid(),
  url: z.string().url(),
}), [
  { email: 'a@b.co', uuid: '9c858901-8a57-4791-81fe-4c455b099bc9', url: 'https://example.com/x' },
], 'ata')

differential('default fills nothing on verdicts', z.object({ n: z.number().default(7), s: z.string() }), [
  { n: 1, s: 'x' },
  { s: 'only' },
])

// 2. residue: ata rejects fast, zod owns acceptance
differential('object refine', z.object({ lo: z.number(), hi: z.number() }).refine((o) => o.lo <= o.hi), [
  { lo: 1, hi: 2 },
  { lo: 5, hi: 1 },
], 'hybrid')

differential('field refine', z.object({ even: z.number().refine((n) => n % 2 === 0) }), [
  { even: 2 },
  { even: 3 },
], 'hybrid')

differential('transform', z.object({ s: z.string().transform((x) => x.length) }), [
  { s: 'abc' },
], 'hybrid')

differential('pipe', z.object({ s: z.string().pipe(z.string().max(3)) }), [
  { s: 'ab' },
  { s: 'toolong' },
], 'hybrid')

differential('date', z.object({ d: z.date(), n: z.number() }), [
  { d: new Date(), n: 1 },
  { d: 'not a date', n: 1 },
], 'hybrid')

// 3. unsound for a fast path: zod answers
differential('coerce', z.object({ n: z.coerce.number() }), [
  { n: 5 },
  { n: '5' },
  { n: 'x' },
], 'zod')

differential('catch', z.object({ n: z.number().catch(0) }), [
  { n: 1 },
  { n: 'junk' },
], 'zod')

differential('preprocess', z.object({ n: z.preprocess((x) => (typeof x === 'string' ? Number(x) : x), z.number()) }), [
  { n: '5' },
  { n: 5 },
], 'zod')

// 4. recursion through z.lazy stays classified and correct
{
  const Tree = z.object({
    value: z.number(),
    children: z.lazy(() => z.array(Tree)).optional(),
  })
  differential('recursive tree', Tree, [
    { value: 1 },
    { value: 1, children: [{ value: 2, children: [] }] },
  ])
}

// 4b. primitive and non-object roots
differential('string root', z.string().min(2).max(5), ['ab', 'abcde'], 'ata')
differential('union root', z.union([z.literal('a'), z.number().int()]), ['a', 3])
differential('array root', z.array(z.object({ n: z.number() })).min(1), [[{ n: 1 }]], 'ata')
differential('refined root', z.number().refine((n) => n !== 13), [7, 13], 'hybrid')

// 5. the standard schema face agrees too
{
  const schema = z.object({ n: z.number().min(1) })
  const c = compile(schema)
  const good = c['~standard'].validate({ n: 2 })
  ok('standard: accepts', 'value' in good)
  const bad = c['~standard'].validate({ n: 0 })
  ok('standard: rejects with issues', Array.isArray(bad.issues) && bad.issues.length > 0)
  ok('standard: issue has path', bad.issues[0].path[0] === 'n')
}

// 6. classification is conservative for the unknown
{
  const fake = { _zod: { def: { type: 'shiny_new_feature' } } }
  const a = analyze(fake)
  ok('unknown node lands in zod mode', a.mode === 'zod')
}

console.log('ata-zod: ' + passed + ' checks, ' + checked + ' differential values, all agreeing with zod')
