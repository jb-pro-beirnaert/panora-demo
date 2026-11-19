/** Best-effort Langfuse API client: evals never fail because Langfuse is missing or down. */
export interface LangfuseConfig {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
}

export function langfuseFromEnv(env: NodeJS.ProcessEnv = process.env): LangfuseConfig | null {
  const { LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY } = env;
  if (!LANGFUSE_PUBLIC_KEY || !LANGFUSE_SECRET_KEY) return null;
  return {
    baseUrl: env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
    publicKey: LANGFUSE_PUBLIC_KEY,
    secretKey: LANGFUSE_SECRET_KEY,
  };
}

const auth = (config: LangfuseConfig) =>
  `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')}`;

/** Attaches a score to the case's trace (Langfuse "Scores"). */
export async function pushScore(
  config: LangfuseConfig,
  score: { traceId: string; name: string; value: number; comment?: string | undefined },
): Promise<void> {
  try {
    const response = await fetch(new URL('/api/public/scores', config.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth(config) },
      body: JSON.stringify({ ...score, dataType: 'NUMERIC' }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) console.error(`langfuse score ${score.name}: ${response.status}`);
  } catch (error) {
    console.error(`langfuse score ${score.name}: ${String(error)}`);
  }
}

/** Total LLM cost of a trace in USD (sum of its generations), or null when unknown. */
export async function traceCost(config: LangfuseConfig, traceId: string): Promise<number | null> {
  try {
    const url = new URL('/api/public/v2/observations', config.baseUrl);
    url.searchParams.set('traceId', traceId);
    url.searchParams.set('limit', '200');
    url.searchParams.set('fields', 'core,usage');
    const response = await fetch(url, {
      headers: { authorization: auth(config) },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      data: { type: string; costDetails?: { total?: number } }[];
    };
    const generations = body.data.filter((observation) => observation.type === 'GENERATION');
    if (generations.length === 0) return null;
    return generations.reduce((sum, g) => sum + (g.costDetails?.total ?? 0), 0);
  } catch {
    return null;
  }
}
