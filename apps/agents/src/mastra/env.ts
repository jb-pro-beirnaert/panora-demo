import type { ModelRouterModelId } from '@mastra/core/llm';
import { z } from 'zod';

const ModelIdSchema = z
  .string()
  .regex(/^[a-z0-9-]+\/.+$/, 'expected a Mastra model id such as "openai/gpt-6-luna"')
  .transform((id) => id as ModelRouterModelId);

/**
 * API key variable per model provider. Keys are never passed explicitly: Mastra's model router
 * reads them from process.env. They are validated here so a missing key fails at startup, not on
 * the first LLM call. Providers without a key (e.g. a local Ollama in V8) are not listed.
 */
const PROVIDER_API_KEYS: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

const EnvSchema = z
  .object({
    MASTRA_PORT: z.coerce.number().int().positive().default(4111),
    MASTRA_HOST: z.string().default('localhost'),
    AGENTS_DATABASE_URL: z.string().min(1, 'AGENTS_DATABASE_URL is required (see .env.example)'),
    MCP_EXTRANET_URL: z.url().default('http://localhost:3002'),
    /** Light model: extraction only. */
    TRIAGE_MODEL: ModelIdSchema.default('openai/gpt-5-nano'),
    /** Model for multi-step tool use and reasoning over clauses. */
    COVERAGE_MODEL: ModelIdSchema.default('openai/gpt-6-luna'),
  })
  .superRefine((env, ctx) => {
    for (const name of ['TRIAGE_MODEL', 'COVERAGE_MODEL'] as const) {
      const provider = env[name].split('/')[0] ?? '';
      const keyVar = PROVIDER_API_KEYS[provider];
      if (keyVar && !process.env[keyVar]?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: [keyVar],
          message: `${keyVar} is required because ${name} is "${env[name]}"`,
        });
      }
    }
  });

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment for apps/agents:\n${z.prettifyError(parsed.error)}`);
}

export const env = parsed.data;
