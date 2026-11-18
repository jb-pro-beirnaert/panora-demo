import { toExtranetSeed, type World } from '@demo/world-generator';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function isHealthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL('/health', baseUrl), {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Waits for the MCP server, then replaces its database with the insurer side of `world`. */
export async function seedExtranet(
  world: World,
  baseUrl: string,
  adminToken: string,
): Promise<void> {
  const payload = JSON.stringify(toExtranetSeed(world));
  for (let attempt = 1; ; attempt++) {
    if (await isHealthy(baseUrl)) {
      try {
        const response = await fetch(new URL('/admin/seed', baseUrl), {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
          body: payload,
          signal: AbortSignal.timeout(30_000),
        });
        if (response.ok) {
          console.log('extranet seeded:', JSON.stringify((await response.json()) as unknown));
          return;
        }
        console.error(`extranet seed failed (${response.status}): ${await response.text()}`);
      } catch (error) {
        console.error('extranet seed failed:', error);
      }
    } else if (attempt === 1 || attempt % 10 === 0) {
      console.log(`waiting for mcp-extranet at ${baseUrl}…`);
    }
    await sleep(Math.min(1_000 * attempt, 5_000));
  }
}
