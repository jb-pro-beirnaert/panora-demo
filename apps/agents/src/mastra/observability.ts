import { LangfuseExporter } from '@mastra/langfuse';
import { Observability } from '@mastra/observability';
import { env } from './env.js';

/**
 * Traces go to Langfuse (Cloud or self-hosted: only the URL and keys change). Without keys,
 * tracing is off. Export is asynchronous and batched: an unreachable Langfuse only logs errors,
 * it never fails a workflow.
 */
export function buildObservability(): Observability | undefined {
  if (!env.LANGFUSE_PUBLIC_KEY || !env.LANGFUSE_SECRET_KEY) {
    console.warn('LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY not set: tracing disabled.');
    return undefined;
  }
  return new Observability({
    configs: {
      langfuse: {
        serviceName: 'panora-demo-agents',
        exporters: [
          new LangfuseExporter({
            publicKey: env.LANGFUSE_PUBLIC_KEY,
            secretKey: env.LANGFUSE_SECRET_KEY,
            baseUrl: env.LANGFUSE_BASE_URL,
            environment: env.LANGFUSE_ENVIRONMENT,
          }),
        ],
      },
    },
  });
}
