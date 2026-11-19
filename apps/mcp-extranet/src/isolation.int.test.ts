import { issueMcpToken } from '@demo/shared/mcp-token';
import { generateWorld, toExtranetSeed } from '@demo/world-generator';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { execFileSync } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import pg from 'pg';
import { createApp } from './app.js';
import { createDb } from './db.js';

/**
 * V10 isolation suite (real Postgres, `extranet_test`): an MCP token of one brokerage reads no
 * policy of another, a read token cannot file a claim, and /mcp refuses calls without a token.
 */
const ADMIN_URL =
  process.env.EXTRANET_TEST_ADMIN_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/postgres';
const DATABASE_URL =
  process.env.EXTRANET_TEST_DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/extranet_test';
const SECRET = 'test-mcp-token-secret-0123456789-0123456789';
const ADMIN_TOKEN = 'test-admin-token-0123456789';

const world = generateWorld({ seed: 42, locale: 'fr' });
const delormePolicy = world.policies.find((p) => p.brokerCode === 'DLM-075')!.number;
const vasseurPolicy = world.policies.find((p) => p.brokerCode === 'VSR-069')!.number;

let baseUrl: string;
let close: () => Promise<void>;

async function client(token: string | null): Promise<Client> {
  const mcp = new Client({ name: 'isolation-test', version: '1.0.0' });
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL('/mcp', baseUrl), {
      requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : {},
    }),
  );
  return mcp;
}

const text = (result: unknown) =>
  JSON.stringify((result as { content?: unknown }).content ?? result);

before(async () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const name = new URL(DATABASE_URL).pathname.slice(1);
  if ((await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name])).rowCount === 0) {
    await admin.query(`CREATE DATABASE "${name}"`);
  }
  await admin.end();
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, EXTRANET_DATABASE_URL: DATABASE_URL },
    stdio: 'ignore',
  });
  const db = createDb(DATABASE_URL);
  const app = createApp(db, {
    MCP_EXTRANET_PORT: 0,
    EXTRANET_DATABASE_URL: DATABASE_URL,
    MCP_TOKEN_SECRET: SECRET,
    DEMO_MODE: true,
    ADMIN_TOKEN,
    CHAOS_LATENCY_MIN_MS: 0,
    CHAOS_LATENCY_MAX_MS: 0,
    CHAOS_ERROR_RATE: 0,
    CHAOS_RATE_LIMIT_PER_SECOND: 0,
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = async () => {
    server.close();
    await db.$disconnect();
  };
  const seeded = await fetch(new URL('/admin/seed', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN_TOKEN}` },
    body: JSON.stringify(toExtranetSeed(world)),
  });
  assert.equal(seeded.status, 200);
});

after(async () => {
  await close();
});

describe('MCP isolation between brokerages', () => {
  it('a brokerage reads its own policies', async () => {
    const mcp = await client(issueMcpToken({ scope: 'read', brokerCode: 'DLM-075' }, SECRET));
    const result = await mcp.callTool({ name: 'get_policy', arguments: { number: delormePolicy } });
    assert.ok(!result.isError);
    assert.match(text(result), new RegExp(delormePolicy));
    await mcp.close();
  });

  it('a token of one brokerage reads no policy of another', async () => {
    const mcp = await client(issueMcpToken({ scope: 'read', brokerCode: 'DLM-075' }, SECRET));
    for (const [name, args] of [
      ['get_policy', { number: vasseurPolicy }],
      ['list_coverages', { policyNumber: vasseurPolicy }],
      ['get_claim_history', { policyNumber: vasseurPolicy }],
    ] as const) {
      const result = await mcp.callTool({ name, arguments: args });
      assert.ok(result.isError, `${name} must fail`);
      assert.match(text(result), /access denied/i);
    }
    // Searching by holder name never returns another brokerage's policy.
    const holder = world.policies.find((p) => p.number === vasseurPolicy)!.holderName;
    const search = await mcp.callTool({ name: 'search_policy', arguments: { holderName: holder } });
    assert.doesNotMatch(text(search), new RegExp(vasseurPolicy));
    await mcp.close();
  });

  it('a read token cannot see nor call file_claim', async () => {
    const mcp = await client(issueMcpToken({ scope: 'read', brokerCode: 'DLM-075' }, SECRET));
    const tools = await mcp.listTools();
    assert.ok(!tools.tools.some((tool) => tool.name === 'file_claim'));
    await assert.rejects(
      mcp.callTool({
        name: 'file_claim',
        arguments: {
          policyNumber: delormePolicy,
          date: '2026-11-17',
          nature: 'water_damage',
          amount: 1000,
          documents: [],
        },
      }),
      /write token|403/i,
    );
    await mcp.close();
  });

  it('refuses a missing or forged token', async () => {
    await assert.rejects(client(null), /401|Unauthorized/i);
    const forged = issueMcpToken(
      { scope: 'write', brokerCode: 'DLM-075' },
      'another-secret-0123456789-0123456789',
    );
    await assert.rejects(client(forged), /401|Unauthorized/i);
  });
});
