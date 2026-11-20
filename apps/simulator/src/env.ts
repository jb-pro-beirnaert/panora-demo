import { z } from 'zod';

const EnvSchema = z.object({
  SIMULATOR_PORT: z.coerce.number().int().positive().default(3003),
  MCP_EXTRANET_URL: z.url().default('http://localhost:3002'),
  CORE_API_URL: z.url().default('http://localhost:3001'),
  ADMIN_TOKEN: z.string().min(16, 'ADMIN_TOKEN (16+ characters) is required (see .env.example)'),
  /** The simulator plays the inbound e-mail gateway of Core (V10). */
  INBOUND_EMAIL_TOKEN: z
    .string()
    .min(16, 'INBOUND_EMAIL_TOKEN (16+ characters) is required (see .env.example)'),
  WORLD_SEED: z.coerce.number().int().default(42),
  /** Seconds between two e-mails of the demo script while playing (V14). */
  SIMULATOR_INTERVAL_SECONDS: z.coerce.number().int().min(3).max(600).default(20),
  /** Share of English-speaking clients in the generated world. */
  SIMULATOR_ENGLISH_SHARE: z.coerce.number().min(0).max(1).default(0.3),
  /** Origin of the web UI allowed by CORS (demo panel). */
  WEB_ORIGIN: z.string().default('http://localhost:3000'),
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
