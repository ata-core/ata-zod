# @ata-project/zod

Run zod schemas on the [ata](https://github.com/ata-core/ata-validator) engine.
The schema stays zod. The verdict comes from compiled JSON Schema validation
where that is provably safe, and from zod itself everywhere it is not.

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
check.safeParse(data)    // zod-shaped result, zod-produced value
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
13,000 generated values across all three modes, including recursive schemas,
and runs the whole suite a second time with code generation blocked.

`compiled.engine` tells you which mode you got, `compiled.reasons` says why.

## What it costs, measured

One representative API-boundary object schema (nine fields, nested arrays of
objects, enum, union), interleaved medians of 7 rounds on an M-series Mac,
Node 25, zod 4.5.4, ata-validator 1.13.1:

| | zod `safeParse` | `z.compile` | this package |
|---|---|---|---|
| accept, verdict only | 526 ns | 45 ns | **21 ns** |
| reject, verdict only | 1419 ns | 1429 ns | **5 ns** |
| reject, `safeParse` | 1419 ns | 1429 ns | **6.7 ns** |
| accept, `safeParse` | 526 ns | 45 ns | 542 ns |

The last row is by design, not a gap: an accepted value's output is zod's to
make. Plain `z.object` strips unknown keys, defaults fill, transforms rewrite,
so `safeParse` hands every accepted value to zod and returns exactly what zod
returns. What this package owns is the verdict and the rejection: `isValid`
never runs zod in `ata` mode, and a rejected `safeParse` builds its `ZodError`
only when somebody reads it, by running zod once at that moment.

With code generation blocked, the way a strict CSP or a locked-down edge
runtime blocks it (`node --disallow-code-generation-from-strings`):

| | zod `safeParse` | `z.compile` | this package |
|---|---|---|---|
| accept, verdict only | 1269 ns | 1281 ns | **641 ns** |
| reject, verdict only | 2267 ns | 2250 ns | **112 ns** |

`z.compile` does not fail there, but its advantage does: it runs at the speed
of uncompiled zod. ata falls back to its interpreted engine, which passes the
same official JSON Schema test suite as its compiled one.

## Limitations, plainly

- Accepted values in `hybrid` mode and every value in `zod` mode run zod, so
  those paths are zod-speed. The win is the rejection and the pure-schema case.
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
