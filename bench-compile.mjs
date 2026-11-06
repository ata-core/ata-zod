// The compile figure on ataproject.dev: compile(schema) on the nine-field
// product schema of bench.mjs, a fresh zod schema object each round so no
// cache answers, median of 40 rounds in one process after a warm-up on a
// different schema. Run it a few times and quote the run you can reproduce.
//
//   node bench-compile.mjs
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { z } = require('zod')
const { compile } = require('./index.js')
const ata = require('ata-validator/package.json').version
const mk = () => z.object({
  id: z.number(),
  title: z.string().min(1).max(100),
  brand: z.string().min(1).max(30),
  description: z.string().min(1).max(500),
  price: z.number().min(1).max(10000),
  discount: z.union([z.number().min(1).max(100), z.null()]),
  quantity: z.number().min(0).max(10),
  tags: z.array(z.string().min(1).max(30)),
  images: z.array(z.object({ id: z.number(), title: z.string().min(1).max(100), type: z.enum(['jpg', 'png']), size: z.number(), url: z.string().min(1) })),
})
compile(z.object({ a: z.string(), b: z.number().min(0) })).isValid({ a: 'x', b: 1 })
const fresh = [], again = []
for (let i = 0; i < 40; i++) {
  const s = mk()
  let t0 = process.hrtime.bigint(); compile(s); fresh.push(Number(process.hrtime.bigint() - t0) / 1000)
  t0 = process.hrtime.bigint(); compile(s); again.push(Number(process.hrtime.bigint() - t0) / 1000)
}
const med = (a) => { a.sort((x, y) => x - y); return a[a.length >> 1].toFixed(1) }
console.log(`ata-validator ${ata}, zod ${require('zod/package.json').version}`)
console.log(`compile(schema), fresh schema object   ${med(fresh)} µs`)
console.log(`compile(schema), same object again     ${med(again)} µs`)
