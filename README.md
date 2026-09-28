# @ata-project/zod

Run zod schemas on the [ata](https://github.com/ata-core/ata-validator) engine.
The schema stays zod. The verdict comes from compiled JSON Schema validation
where that is provably safe, and from zod itself everywhere it is not.

```sh
npm i @ata-project/zod
```

zod 4 and ata-validator are peer dependencies; npm and pnpm install them
automatically, yarn users add them alongside.

![One zod schema, three ways to run it: measured times for accepting and rejecting documents, in Node and with code generation blocked](https://raw.githubusercontent.com/ata-core/ata-zod/main/assets/bench.png)

```js
import { z } from 'zod'
import { compile } from '@ata-project/zod'

const user = z.object({
  id: z.number().int().min(1),
  name: z.string().min(1).max(64),
  email: z.string().email(),
})

const check = compile(user)

check.isValid(data)      // boolean, ata answers
check.safeParse(data)    // zod-shaped result, the value zod would return
check.parse(data)        // throws a real ZodError
```

Types carry through: `safeParse` returns `z.output` of your schema.

## How it stays correct

zod 4 turns a schema into JSON Schema with `z.toJSONSchema`, and ata executes
JSON Schema. That conversion is lossy in both directions: refinements and
transforms are dropped silently, which makes the emitted schema looser than
zod, and coercion is dropped too, which makes it stricter. A wrong answer in
either direction is unacceptable, so `compile` classifies the schema by
walking zod's own definition tree before anything runs:

| Mode | When | Who answers |
|---|---|---|
| `ata` | the conversion is exact | ata alone |
| `hybrid` | refine, transform, pipe, Date and other non-JSON types | ata's rejection is final; an acceptance runs zod for the residue |
| `zod` | coerce, catch, preprocess, or a node this package does not recognise | zod, undecorated |

The classification is conservative: an unrecognised node lands in `zod` mode,
so a new zod feature can make this package slower, never wrong. The test suite
holds `isValid`, `safeParse` and the parsed value against zod itself over
15,000 generated values across all three modes, including recursive schemas,
and runs the whole suite a second time with code generation blocked.

`compiled.engine` tells you which mode you got, `compiled.reasons` says why.

## What it costs, measured

One representative API-boundary object schema (nine fields, nested arrays of
objects, enum, union), interleaved medians of 7 rounds on an M-series Mac,
Node 25, zod 4.6.5, ata-validator 1.36.0, median of three runs:

| | zod `safeParse` | `z.compile` | this package |
|---|---|---|---|
| accept, verdict only | 527 ns | 44 ns | **23 ns** |
| reject, verdict only | 822 ns | 851 ns | **6 ns** |
| reject, `safeParse` | 822 ns | 851 ns | **8.3 ns** |
| accept, `safeParse` | 527 ns | 44 ns | 54.3 ns |

An accepted value is built by ata's `parse()` wherever the classifier proves
it comes out exactly as zod would build it: plain objects whose optional keys
follow the required ones, arrays, primitives and unions of primitives, with
nothing that fills a default, rewrites a value or keeps undeclared keys. The
differential suite holds that value to zod's, key order included. Anything
else, a default, a transform, a record, a union of objects, a loose object,
hands the accepted value to zod, which returns exactly what it always did.
This needs ata-validator 1.33.0 or later, which copies arrays instead of
sharing them with the input; with an older ata every accepted value goes to
zod. `isValid` never runs zod in `ata` mode, and a rejected `safeParse` builds
its `ZodError` only when somebody reads it, by running zod once at that moment.

With code generation blocked, the way a strict CSP or a locked-down edge
runtime blocks it (`node --disallow-code-generation-from-strings`):

| | zod `safeParse` | `z.compile` | this package |
|---|---|---|---|
| accept, verdict only | 1290 ns | 1273 ns | **651 ns** |
| reject, verdict only | 1695 ns | 1700 ns | **113 ns** |

`z.compile` does not fail there, but its advantage does: it runs at the speed
of uncompiled zod. ata falls back to its interpreted engine, which passes the
same official JSON Schema test suite as its compiled one.

## Raw bytes

`isValidBytes` answers from a `Buffer`, `Uint8Array` or JSON string without
`JSON.parse` and without materializing a JavaScript object, something zod has
no path for at all:

```js
const check = compile(schema)
check.isValidBytes(request.rawBody)   // boolean, straight from the bytes
```

On an `engine: 'ata'` schema with the native engine present, the verdict comes
from a SIMD walk of the buffer. The same array-of-objects schema as above,
interleaved medians of 7 rounds, first element invalid on the reject rows,
measured on zod 4.5.4 and ata-validator 1.13.1:

| payload | zod parse + safeParse | `isValidBytes` |
|---|---|---|
| 0.2 KB, accept | 0.9 us | **0.6 us** |
| 0.2 KB, reject | 1.6 us | **0.6 us** |
| 22.7 KB, accept | 79.2 us | **47.6 us** |
| 22.7 KB, reject | 81.0 us | **45.6 us** |
| 229 KB, accept | 793 us | **489 us** |
| 229 KB, reject | 791 us | **482 us** |

Bytes that are not valid JSON return `false` rather than throwing. The verdict
agrees with `safeParse` on the parsed value; the differential suite compares
the two on every JSON-representable value it generates.

Plainly: this is a verdict, not a parse. When you need the value, you still
parse and `safeParse` it, and `hybrid` and `zod` mode schemas, and installs
without the native engine, do exactly that under the hood. The API is worth
having where rejection is the common case: gateways, webhook endpoints and
queue consumers that drop bad messages before doing any further work.

## Limitations, plainly

- Accepted values in `hybrid` mode, accepted values whose shape ata cannot
  build exactly as zod does, and every value in `zod` mode run zod, so those
  paths are zod-speed.
- Value-rewriting checks such as `.trim()` and `.toLowerCase()` put a schema in
  `zod` mode. They do not reach the JSON Schema, and they can make zod accept
  what the schema rejects as well as the other way round. 0.2.1 and earlier
  missed them and could answer `isValid` wrongly; upgrade if you use them.
- `validate()` reports ata's errors for the schema-representable part, which
  are JSON Schema errors, not `ZodError` issues. Use `safeParse` when you need
  zod's error shape.
- The classifier reads `schema._zod.def`, which is zod's internal tree. The
  peer range is pinned to zod 4 and the differential suite is the tripwire for
  internals moving.
- Async refinements are not supported; `safeParse` is synchronous, as in zod.

## Standard Schema

The compiled object implements Standard Schema V1, so anything that accepts a
standard schema runs the fast path without knowing either library:

```js
const result = check['~standard'].validate(data)
```

## License

MIT
