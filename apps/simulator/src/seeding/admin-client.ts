const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function isHealthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL('/health', baseUrl), {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function waitForHealth(name: string, baseUrl: string): Promise<void> {
  for (let attempt = 1; !(await isHealthy(baseUrl)); attempt++) {
    if (attempt === 1 || attempt % 10 === 0) console.log(`waiting for ${name} at ${baseUrl}…`);
    await sleep(Math.min(500 * attempt, 3_000));
  }
}

/** POST to a service's `/admin/*` route with the admin token. Throws on failure. */
export async function adminPost(
  baseUrl: string,
  path: string,
  adminToken: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(new URL(path, baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` },
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`${path} on ${baseUrl} failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

/** Waits for the service, then seeds it, retrying until it succeeds. */
export async function seedWhenReady(
  name: string,
  baseUrl: string,
  adminToken: string,
  payload: unknown,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    await waitForHealth(name, baseUrl);
    try {
      const result = await adminPost(baseUrl, '/admin/seed', adminToken, payload);
      console.log(`${name} seeded:`, JSON.stringify(result));
      return;
    } catch (error) {
      console.error(`${name} seed failed (attempt ${attempt}):`, error);
      await sleep(Math.min(1_000 * attempt, 5_000));
    }
  }
}
