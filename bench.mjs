// Interleaved comparison on one API-boundary schema: zod, zod's own compiler,
// and the same schema through ata. Medians of 7 rounds; run it a few times
// and quote the run you can reproduce, not the best one.
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { z } = require('zod')
const { compile } = require('./index.js')

const imageSchema = z.object({
  id: z.number(),
  title: z.string().min(1).max(100),
  type: z.enum(['jpg', 'png']),
  size: z.number(),
  url: z.string().min(1),
})
const schema = z.object({
  id: z.number(),
  title: z.string().min(1).max(100),
  brand: z.string().min(1).max(30),
  description: z.string().min(1).max(500),
  price: z.number().min(1).max(10000),
  discount: z.union([z.number().min(1).max(100), z.null()]),
  quantity: z.number().min(0).max(10),
  tags: z.array(z.string().min(1).max(30)),
  images: z.array(imageSchema),
})

const valid = {
  id: 252,
  title: 'Apple',
  brand: 'Sunny Backyard',
  description: 'Red apple from Lake Constance',
  price: 89,
  discount: null,
  quantity: 5,
  tags: ['fruit', 'red', 'round'],
  images: [
    { id: 1, title: 'a', type: 'jpg', size: 100, url: 'https://example.com/1' },
    { id: 2, title: 'b', type: 'png', size: 200, url: 'https://example.com/2' },
  ],
}
const invalid = { ...valid, title: '', quantity: 1000 }

const ata = compile(schema)
const zc = z.compile(schema)
console.log('mode:', ata.engine)
console.log('sanity:', ata.isValid(valid), ata.isValid(invalid), schema.safeParse(valid).success, schema.safeParse(invalid).success)

const cases = [
  ['zod    safeParse   valid  ', () => schema.safeParse(valid).success],
  ['zod    compile     valid  ', () => zc.safeParse(valid).success],
  ['ata    isValid     valid  ', () => ata.isValid(valid)],
  ['ata    safeParse   valid  ', () => ata.safeParse(valid).success],
  ['zod    safeParse   invalid', () => schema.safeParse(invalid).success],
  ['zod    compile     invalid', () => zc.safeParse(invalid).success],
  ['ata    isValid     invalid', () => ata.isValid(invalid)],
  ['ata    safeParse   invalid', () => ata.safeParse(invalid).success],
]

const N = 200000
for (const [, f] of cases) for (let i = 0; i < 50000; i++) f()
const acc = new Map(cases.map(([n]) => [n, []]))
for (let r = 0; r < 7; r++) {
  for (const [n, f] of cases) {
    const s = process.hrtime.bigint()
    for (let i = 0; i < N; i++) f()
    acc.get(n).push(Number(process.hrtime.bigint() - s) / N)
  }
}
for (const [n, xs] of acc) { xs.sort((a, b) => a - b); console.log(n, xs[3].toFixed(1).padStart(8) + ' ns') }
