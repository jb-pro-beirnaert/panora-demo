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
 * The demo has a single brokerage (V12), but the insurer's extranet serves many: the "other
 * brokerage" is a code that owns no policy of the demo world.
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
const OTHER_BROKER_CODE = 'OTHER-000';

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
    const mcp = await client(
      issueMcpToken({ scope: 'read', brokerCode: OTHER_BROKER_CODE }, SECRET),
    );
    for (const [name, args] of [
      ['get_policy', { number: delormePolicy }],
      ['list_coverages', { policyNumber: delormePolicy }],
      ['get_claim_history', { policyNumber: delormePolicy }],
    ] as const) {
      const result = await mcp.callTool({ name, arguments: args });
      assert.ok(result.isError, `${name} must fail`);
      assert.match(text(result), /access denied/i);
    }
    // Searching by holder name never returns another brokerage's policy.
    const holder = world.policies.find((p) => p.number === delormePolicy)!.holderName;
    const search = await mcp.callTool({ name: 'search_policy', arguments: { holderName: holder } });
    assert.doesNotMatch(text(search), new RegExp(delormePolicy));
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

describe('request_cancellation (V15)', () => {
  const free = world.policies.find(
    (p) => p.brokerCode === 'DLM-075' && p.status === 'active' && p.endReason === null,
  )!;
  const terminated = world.policies.find(
    (p) => p.brokerCode === 'DLM-075' && p.status === 'terminated',
  )!;
  const structured = (result: unknown) =>
    (result as { structuredContent?: Record<string, unknown> }).structuredContent;

  it('is a write tool: a read token neither sees nor calls it', async () => {
    const mcp = await client(issueMcpToken({ scope: 'read', brokerCode: 'DLM-075' }, SECRET));
    const tools = await mcp.listTools();
    assert.ok(!tools.tools.some((tool) => tool.name === 'request_cancellation'));
    await assert.rejects(
      mcp.callTool({
        name: 'request_cancellation',
        arguments: {
          policyNumber: free.number,
          effectiveDate: free.renewalDate,
          reason: 'client_request',
        },
      }),
      /write token|403/i,
    );
    await mcp.close();
  });

  it('records a cancellation at a renewal date, idempotently; get_policy shows it', async () => {
    const mcp = await client(issueMcpToken({ scope: 'write', brokerCode: 'DLM-075' }, SECRET));
    const args = {
      policyNumber: free.number,
      effectiveDate: free.renewalDate,
      reason: 'client_request',
    };
    const first = await mcp.callTool({ name: 'request_cancellation', arguments: args });
    assert.deepEqual(structured(first), {
      policyNumber: free.number,
      effectiveDate: free.renewalDate,
      alreadyRequested: false,
    });
    const again = await mcp.callTool({ name: 'request_cancellation', arguments: args });
    assert.equal(structured(again)?.alreadyRequested, true);
    const policy = await mcp.callTool({ name: 'get_policy', arguments: { number: free.number } });
    assert.match(text(policy), /client_request/);
    assert.match(text(policy), new RegExp(free.renewalDate));
    await mcp.close();
  });

  it('refuses a date that is not a renewal date, and a terminated policy', async () => {
    const mcp = await client(issueMcpToken({ scope: 'write', brokerCode: 'DLM-075' }, SECRET));
    const other = world.policies.find(
      (p) =>
        p.brokerCode === 'DLM-075' &&
        p.status === 'active' &&
        p.endReason === null &&
        p.number !== free.number,
    )!;
    const wrongDate = await mcp.callTool({
      name: 'request_cancellation',
      arguments: {
        policyNumber: other.number,
        effectiveDate: '2027-02-28',
        reason: 'client_request',
      },
    });
    assert.match(text(wrongDate), /not a renewal date|refuses/);
    const ended = await mcp.callTool({
      name: 'request_cancellation',
      arguments: {
        policyNumber: terminated.number,
        effectiveDate: terminated.renewalDate,
        reason: 'client_request',
      },
    });
    assert.match(text(ended), /already terminated/);
    await mcp.close();
  });
});

describe('broker portal (V17)', () => {
  const get = (path: string, token: string | null) =>
    fetch(new URL(`/portal${path}`, baseUrl), {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const read = issueMcpToken({ scope: 'read', brokerCode: 'DLM-075' }, SECRET);
  const other = issueMcpToken({ scope: 'read', brokerCode: OTHER_BROKER_CODE }, SECRET);

  it("lists only the calling brokerage's policies, and refuses a missing token", async () => {
    const own = (await (await get('/policies', read)).json()) as { number: string }[];
    assert.ok(own.some((policy) => policy.number === delormePolicy));
    const none = (await (await get('/policies', other)).json()) as unknown[];
    assert.equal(none.length, 0);
    assert.equal((await get('/policies', null)).status, 401);
  });

  it('opens a policy with its coverages, clauses and claims; another brokerage gets 403', async () => {
    const response = await get(`/policies/${delormePolicy}`, read);
    assert.equal(response.status, 200);
    const policy = (await response.json()) as {
      coverages: unknown[];
      generalClauses: { ref: string }[];
      claims: unknown[];
    };
    assert.ok(policy.coverages.length > 0);
    assert.ok(policy.generalClauses.length >= 4);
    assert.equal((await get(`/policies/${delormePolicy}`, other)).status, 403);
  });

  it('serves the full general conditions of a clause’s insurer, and logs portal calls', async () => {
    const policy = (await (await get(`/policies/${delormePolicy}`, read)).json()) as {
      generalClauses: { ref: string }[];
    };
    const ref = policy.generalClauses[0]!.ref;
    const conditions = (await (await get(`/clauses/${ref}`, read)).json()) as {
      clauses: { ref: string; text: string }[];
    };
    assert.ok(conditions.clauses.some((clause) => clause.ref === ref && clause.text.length > 20));
    const db = new pg.Client({ connectionString: DATABASE_URL });
    await db.connect();
    const logged = await db.query(
      `SELECT count(*)::int AS n FROM "CallLog" WHERE channel = 'portal' AND tool = 'portal:read_conditions'`,
    );
    await db.end();
    assert.ok(logged.rows[0].n >= 1);
  });
});
