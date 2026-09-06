import type { ZodError, ZodType, input, output } from 'zod'

/** How a schema was classified, and why. */
export interface Analysis {
  /**
   * 'ata': the JSON Schema conversion is exact and ata answers alone.
   * 'hybrid': the conversion is provably looser (refine, transform, Date and
   * friends), so ata's rejections are final and zod confirms acceptances.
   * 'zod': a feature makes zod accept what the converted schema rejects
   * (coerce, catch, preprocess) or a node is unknown; zod answers.
   */
  mode: 'ata' | 'hybrid' | 'zod'
  /** The nodes that forced the mode, first eight. */
  reasons: string[]
  /** Whether parsing produces a value different from the input. */
  producesValue: boolean
}

export type SafeParseResult<S extends ZodType> =
  | { success: true; data: output<S> }
  | { success: false; error: ZodError<input<S>> }

export interface CompiledZod<S extends ZodType> {
  /** The verdict, at ata speed where the classification allows it. */
  isValid(data: unknown): boolean
  /** zod-shaped result. Accepted values run zod, so `data` is exactly what
   * zod returns (unknown keys stripped, defaults filled, transforms applied).
   * Rejections are decided by ata; the ZodError is built on first read. */
  safeParse(data: unknown): SafeParseResult<S>
  /** Like safeParse but throwing the ZodError. */
  parse(data: unknown): output<S>
  /** ata's error report for the schema-representable part, zod's issues for
   * the residue only zod can explain. */
  validate(data: unknown): { valid: true; data: output<S> } | { valid: false; errors: unknown[] }
  /** The emitted JSON Schema, or null in 'zod' mode. */
  schema: object | null
  /** The zod schema this was compiled from. */
  zodSchema: S
  engine: Analysis['mode']
  reasons: string[]
  '~standard': {
    version: 1
    vendor: 'ata-zod'
    validate(value: unknown):
      | { value: output<S> }
      | { issues: Array<{ message: string; path: Array<PropertyKey> }> }
  }
}

export declare function compile<S extends ZodType>(
  schema: S,
  opts?: { validator?: object },
): CompiledZod<S>

export declare function analyze(schema: ZodType): Analysis

/** The JSON Schema zod emits for the schema, as this package requests it
 * (draft 2020-12, input side, unrepresentable nodes as `{}`). */
export declare function toJSONSchema(schema: ZodType): object
