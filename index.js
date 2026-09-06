'use strict'

// Run zod schemas on the ata engine.
//
//   const { compile } = require('@ata-project/zod')
//   const check = compile(userSchema)   // a zod schema
//   check.isValid(data)                 // ata answers
//
// zod 4 already turns a schema into JSON Schema (`z.toJSONSchema`), and ata
// executes JSON Schema. The catch is that the conversion is lossy in both
// directions: refinements and transforms are dropped silently, which makes
// the emitted schema LOOSER than zod, and coercion is dropped too, which
// makes it STRICTER than zod. A wrong answer in either direction is not
// acceptable, so every schema is classified before anything is compiled:
//
//   'ata'    — the conversion is exact; ata answers alone.
//   'hybrid' — the conversion is provably looser (refine, transform, Date and
//              friends). ata rejecting is final and fast; ata accepting hands
//              the value to zod for the residue it alone can check.
//   'zod'    — a feature makes zod accept what the emitted schema rejects
//              (coerce, catch, preprocess) or the node is unknown to this
//              classifier. zod answers; nothing is pretended.
//
// The classification is over zod's def tree and is deliberately conservative:
// an unrecognised node type lands in 'zod' mode, so a new zod feature can
// slow this package down but never make it wrong.

const { Validator } = require('ata-validator')

// ---------------------------------------------------------------------------
// classification

// Nodes whose emitted schema equals zod's acceptance, given their children do.
const EXACT = new Set([
  'string', 'number', 'int', 'boolean', 'null', 'undefined', 'void',
  'object', 'interface', 'array', 'tuple', 'union', 'intersection',
  'record', 'literal', 'enum', 'readonly', 'optional', 'nullable',
  'nonoptional', 'any', 'unknown', 'never', 'default', 'prefault',
  'templateLiteral', 'lazy', 'nan',
])

// Nodes zod checks but JSON Schema cannot express: the emitted schema is `{}`
// for them, strictly looser, so ata's rejections stay sound and zod owns the
// acceptance. `pipe` covers .transform() and .pipe(): the input side is
// emitted, anything the output side adds only makes zod stricter. A bare
// transform emits `{}` and can only throw, stricter again. The one transform
// that loosens zod is the input side of a pipe (z.preprocess), handled below.
const RESIDUE = new Set(['date', 'bigint', 'map', 'set', 'file', 'symbol', 'custom', 'pipe', 'promise', 'transform'])

// Nodes that let zod accept input the emitted schema turns away. A fast
// rejection would be a wrong rejection, so these hand the whole schema to zod.
const UNSOUND = new Set(['catch', 'success'])

const CHILD_KEYS = ['innerType', 'element', 'in', 'out', 'left', 'right', 'valueType', 'keyType']

function analyze (schema) {
  const seen = new Set()
  const reasons = []
  let mode = 'ata'
  let producesValue = false

  const escalate = (to, why) => {
    if (to === 'zod') mode = 'zod'
    else if (to === 'hybrid' && mode === 'ata') mode = 'hybrid'
    if (reasons.length < 8) reasons.push(why)
  }

  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    const def = node._zod && node._zod.def
    if (!def) { escalate('zod', 'node without a zod def'); return }
    const type = def.type

    if (def.coerce) escalate('zod', 'coerce at ' + type)
    if (UNSOUND.has(type)) escalate('zod', type)
    else if (type === 'pipe') {
      // z.preprocess() is a pipe whose input side is a transform: it rewrites
      // the value before checking, so zod can accept what the emitted input
      // schema rejects. A plain .transform()/.pipe() has a structural input
      // side and stays a sound residue.
      const inDef = def.in && def.in._zod && def.in._zod.def
      if (inDef && inDef.type === 'transform') escalate('zod', 'preprocess')
      else escalate('hybrid', 'pipe')
    } else if (RESIDUE.has(type)) escalate('hybrid', type)
    else if (!EXACT.has(type)) escalate('zod', 'unrecognised node ' + type)

    if (type === 'default' || type === 'prefault' || type === 'pipe' || type === 'catch') producesValue = true

    if (def.checks) {
      for (const c of def.checks) {
        const cd = c._zod && c._zod.def
        const kind = cd && (cd.check || cd.type)
        // Custom checks (.refine, .superRefine, .check) never reach the JSON
        // Schema; everything else zod emits as a constraint.
        if (kind === 'custom') escalate('hybrid', 'refine at ' + type)
      }
    }

    if (def.shape) for (const k of Object.keys(def.shape)) walk(def.shape[k])
    if (Array.isArray(def.items)) for (const it of def.items) walk(it)
    if (def.rest) walk(def.rest)
    if (Array.isArray(def.options)) for (const o of def.options) walk(o)
    for (const k of CHILD_KEYS) if (def[k] && def[k]._zod) walk(def[k])
    if (def.getter) {
      try { walk(def.getter()) } catch { escalate('zod', 'lazy getter threw') }
    }
  }

  walk(schema)
  return { mode, reasons, producesValue }
}

// ---------------------------------------------------------------------------
// compile

function requireZod () {
  // Resolved lazily from the peer so this package never pins its own copy.
  return require('zod')
}

function toJSONSchema (schema) {
  const z = requireZod()
  return z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' })
}

// A rejection whose ZodError is built on first read, by running zod once at
// that moment. The getter lives on the prototype: an object-literal accessor
// per rejection costs about a hundred nanoseconds, which is the whole budget
// of the fast path. The classifier proves ata only rejects what zod rejects;
// were that ever broken, the getter hands back what ata saw rather than
// nothing, and the differential suite is the place that fails.
class LazyRejection {
  constructor (schema, engine, data) {
    this.success = false
    this._schema = schema
    this._engine = engine
    this._data = data
    this._error = null
  }
}
Object.defineProperty(LazyRejection.prototype, 'error', {
  enumerable: true,
  configurable: true,
  get () {
    if (this._error === null) {
      const r = this._schema.safeParse(this._data)
      this._error = r.success ? new (requireZod().ZodError)(
        this._engine.validate(this._data).errors.map((e) => ({ code: 'custom', message: e.message, path: [], input: this._data }))
      ) : r.error
    }
    return this._error
  },
})

function compile (schema, opts) {
  const options = opts || {}
  const analysis = analyze(schema)
  const jsonSchema = analysis.mode === 'zod' ? null : toJSONSchema(schema)
  const engine = jsonSchema ? new Validator(jsonSchema, options.validator) : null
  const fast = engine ? (d) => engine.isValidObject(d) : null

  let isValid
  if (analysis.mode === 'ata') {
    isValid = fast
  } else if (analysis.mode === 'hybrid') {
    // ata turning a value down is final; ata letting it through hands it to
    // zod for the refinements and native types the JSON Schema cannot carry.
    isValid = (d) => fast(d) && schema.safeParse(d).success
  } else {
    isValid = (d) => schema.safeParse(d).success
  }

  // Raw bytes: an engine:'ata' schema is decided without JSON.parse, straight
  // off the buffer by the native walker when it is present. The other modes
  // need the materialized value for zod, and so does a pure-JS install, so
  // they parse and take the object path. Bytes that are not JSON are a
  // rejection, not an exception.
  let isValidBytes
  if (analysis.mode === 'ata' && engine && typeof engine.isValid === 'function') {
    isValidBytes = (input) => engine.isValid(input)
  } else {
    const td = new TextDecoder()
    isValidBytes = (input) => {
      let value
      try {
        value = JSON.parse(typeof input === 'string' ? input : td.decode(input))
      } catch {
        return false
      }
      return isValid(value)
    }
  }

  // The parsed value is zod's to make: plain z.object strips unknown keys,
  // defaults fill, transforms rewrite, so an accepted value always runs zod
  // and comes back exactly as zod would return it. What ata owns is the
  // rejection: it is decided at ata speed, and the ZodError is built only if
  // somebody reads it, by running zod once at that moment.
  const safeParse = (d) => {
    if (fast && !fast(d)) return new LazyRejection(schema, engine, d)
    return schema.safeParse(d)
  }

  // ata's error report for the schema-representable part; zod's issues where
  // only zod knows why.
  const validate = (d) => {
    if (engine) {
      const r = engine.validate(d)
      if (!r.valid) return { valid: false, errors: r.errors }
    }
    if (analysis.mode !== 'ata') {
      const zr = schema.safeParse(d)
      if (!zr.success) return { valid: false, errors: zr.error.issues }
    }
    return { valid: true, data: d }
  }

  const compiled = {
    isValid,
    isValidBytes,
    safeParse,
    parse: (d) => {
      const r = safeParse(d)
      if (r.success) return r.data
      throw r.error
    },
    validate,
    schema: jsonSchema,
    zodSchema: schema,
    engine: analysis.mode,
    reasons: analysis.reasons,
  }

  compiled['~standard'] = {
    version: 1,
    vendor: 'ata-zod',
    validate (value) {
      const r = safeParse(value)
      if (r.success) return { value: r.data }
      return { issues: r.error.issues.map((i) => ({ message: i.message, path: i.path })) }
    },
  }

  return compiled
}

module.exports = { compile, analyze, toJSONSchema }
