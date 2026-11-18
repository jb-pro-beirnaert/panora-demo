import { z } from 'zod';

const EnvSchema = z.object({
  SIMULATOR_PORT: z.coerce.number().int().positive().default(3003),
  MCP_EXTRANET_URL: z.url().default('http://localhost:3002'),
  ADMIN_TOKEN: z.string().min(16, 'ADMIN_TOKEN (16+ characters) is required (see .env.example)'),
  WORLD_SEED: z.coerce.number().int().default(42),
  SIMULATOR_EMAIL_COUNT: z.coerce.number().int().positive().max(1_000).default(10),
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
