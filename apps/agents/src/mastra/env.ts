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
    /** Core API: `/internal/*` callbacks and the `find_client` tool. */
    CORE_API_URL: z.url().default('http://localhost:3001'),
    /** Bearer token of the Mastra → Core callbacks. */
    CORE_SERVICE_TOKEN: z
      .string()
      .min(16, 'CORE_SERVICE_TOKEN (16+ characters) is required (see .env.example)'),
    /** Signs the per-brokerage `read` / `write` tokens of the MCP extranet server. */
    MCP_TOKEN_SECRET: z
      .string()
      .min(32, 'MCP_TOKEN_SECRET (32+ characters) is required (see .env.example)'),
    /** Langfuse (self-hosted by default, or Cloud): tracing is off without the keys. */
    LANGFUSE_PUBLIC_KEY: z.string().optional(),
    LANGFUSE_SECRET_KEY: z.string().optional(),
    LANGFUSE_BASE_URL: z.url().default('http://localhost:3100'),
    LANGFUSE_ENVIRONMENT: z.string().default('local'),
    /** Set by `npm run dev:lite` (no Langfuse container): tracing off whatever the keys. */
    TRACING_DISABLED: z
      .enum(['true', 'false', ''])
      .default('false')
      .transform((value) => value === 'true'),
    /** V9 resilience: MCP request timeout and attempts per tool call. */
    MCP_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
    MCP_RETRY_ATTEMPTS: z.coerce.number().int().min(1).default(4),
    /** Timeout of one agent call (LLM loop); the step is then retried by the workflow. */
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
    /**
     * `simulated`: deterministic stand-ins instead of the LLM agents (same workflow, MCP calls,
     * suspension and resume). Load tests only: 1,000 cases without API cost.
     */
    /** Attempts of each workflow step before the run fails (1 = no retry). */
    WORKFLOW_STEP_ATTEMPTS: z.coerce.number().int().min(1).default(3),
    AGENTS_MODE: z.enum(['llm', 'simulated']).default('llm'),
    SIMULATED_LLM_LATENCY_MS: z.coerce.number().int().min(0).default(800),
    /** Bearer token Core presents on every API call (V10). Unset: the API is open (dev only). */
    MASTRA_API_TOKEN: z.string().min(16).optional(),
    /** Ollama's URL, for `ollama/<model>` specs (V8, local Qwen). */
    OLLAMA_BASE_URL: z.url().default('http://localhost:11434'),
    /** Light model: extraction only. */
    TRIAGE_MODEL: ModelIdSchema.default('openai/gpt-5-nano'),
    /** Model for multi-step tool use and reasoning over clauses. */
    COVERAGE_MODEL: ModelIdSchema.default('openai/gpt-6-luna'),
    /** Model that writes the client e-mail and the internal note (no tools). */
    DRAFTING_MODEL: ModelIdSchema.default('openai/gpt-6-luna'),
  })
  .superRefine((env, ctx) => {
    // Simulated agents call no model: no API key needed.
    if (env.AGENTS_MODE === 'simulated') return;
    for (const name of ['TRIAGE_MODEL', 'COVERAGE_MODEL', 'DRAFTING_MODEL'] as const) {
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
