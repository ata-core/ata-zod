// Types must carry from the zod schema through the compiled surface.
import { z } from 'zod';
import { compile, analyze } from './index.js';

const user = z.object({
  id: z.number().int(),
  name: z.string(),
  role: z.enum(['admin', 'user']).default('user'),
});

const check = compile(user);

const b: boolean = check.isValid({});
const r = check.safeParse({});
if (r.success) {
  // output type: default applied, role narrowed to the enum
  const role: 'admin' | 'user' = r.data.role;
  const id: number = r.data.id;
  void role; void id;
} else {
  const msg: string = r.error.issues[0]!.message;
  void msg;
}

const p = check.parse({});
const name: string = p.name;
void name; void b;

const a = analyze(user);
const mode: 'ata' | 'hybrid' | 'zod' = a.mode;
void mode;

// @ts-expect-error a compiled schema is not itself a zod schema
user.and(check);

const std = check['~standard'].validate({});
if ('value' in std) {
  const role2: 'admin' | 'user' = std.value.role;
  void role2;
}
