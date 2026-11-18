import { z } from 'zod';

const EnvSchema = z
  .object({
    MCP_EXTRANET_PORT: z.coerce.number().int().positive().default(3002),
    EXTRANET_DATABASE_URL: z
      .string()
      .min(1, 'EXTRANET_DATABASE_URL is required (see .env.example)'),
    DEMO_MODE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    ADMIN_TOKEN: z.string().optional(),
  })
  .refine((env) => !env.DEMO_MODE || (env.ADMIN_TOKEN?.length ?? 0) >= 16, {
    message: 'ADMIN_TOKEN (16+ characters) is required when DEMO_MODE=true',
    path: ['ADMIN_TOKEN'],
  });

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
    process.exit(1);
  }
  return parsed.data;
}
