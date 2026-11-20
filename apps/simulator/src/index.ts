import { extractEmail, toRawEmail } from '@demo/documents';
import {
  CaseStatsSchema,
  type InboundEmailInput,
  type ProcessEmailInput,
  type RawEmailInput,
} from '@demo/shared';
import { generateDemoScript, generateWorld } from '@demo/world-generator';
import express, { type ErrorRequestHandler } from 'express';
import { controlRouter } from './control/routes.js';
import { loadEnv } from './env.js';
import { resetAll, seedAll, type SeedTargets } from './seeding/seeder.js';
import { DemoPlayer, type ScriptEmail } from './stream/demo-player.js';

const env = loadEnv();

// Same seed → same world, same demo script and same PDFs on every start.
const world = generateWorld({
  seed: env.WORLD_SEED,
  locales: ['fr', 'en'],
  mix: { en: env.SIMULATOR_ENGLISH_SHARE },
});
const generated = generateDemoScript(world, env.WORLD_SEED);
// V14: the e-mails carry real files; the PDFs are laid out once, at startup.
const script: ScriptEmail[] = await Promise.all(
  generated.map(async ({ email, groundTruth }) => ({
    email: await toRawEmail(email),
    scenario: groundTruth.scenario,
    requestType: groundTruth.requestType,
    language: groundTruth.emailLanguage,
  })),
);
const targets: SeedTargets = {
  coreUrl: env.CORE_API_URL,
  extranetUrl: env.MCP_EXTRANET_URL,
  adminToken: env.ADMIN_TOKEN,
};
let seeding: 'pending' | 'done' = 'pending';

/** Input of the `process-email` workflow: the e-mail and the brokerage whose inbox received it. */
function workflowInput(email: InboundEmailInput): ProcessEmailInput {
  const brokerage = world.brokerages.find((candidate) => candidate.inboxEmail === email.to);
  if (!brokerage) throw new Error(`No brokerage has the inbox ${email.to}`);
  return { email, brokerage: { brokerCode: brokerage.brokerCode, locale: brokerage.locale } };
}

async function deliver(email: RawEmailInput): Promise<void> {
  const response = await fetch(new URL('/emails', env.CORE_API_URL), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${env.INBOUND_EMAIL_TOKEN}`,
    },
    body: JSON.stringify(email),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`POST /emails failed (${response.status}): ${await response.text()}`);
  }
}

const player = new DemoPlayer(script, deliver, env.SIMULATOR_INTERVAL_SECONDS);

const app = express();
app.use(express.json());
// The demo panel (web UI) calls this API from the browser.
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && env.WEB_ORIGIN.split(',').includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Headers', 'content-type');
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'simulator', seed: env.WORLD_SEED, seeding });
});

/** The demo script with its ground truth. `index` is 1-based. */
app.get('/emails', (_req, res) => {
  res.json(
    generated.map(({ email, groundTruth }, index) => ({
      index: index + 1,
      scenario: groundTruth.scenario,
      language: groundTruth.emailLanguage,
      subject: email.subject,
      from: email.from,
      groundTruth,
    })),
  );
});

/**
 * A single e-mail of the script, shaped as the input of the `process-email` workflow (paste it
 * into Mastra Studio): its PDFs are extracted exactly as Core does it.
 */
app.get('/emails/:index', async (req, res) => {
  const item = script[Number(req.params.index) - 1];
  if (!item) {
    res
      .status(404)
      .json({ error: `No e-mail ${req.params.index}: valid indexes are 1 to ${script.length}.` });
    return;
  }
  res.json(workflowInput(await extractEmail(item.email)));
});

app.use(
  controlRouter({
    player,
    seeding: () => seeding,
    reset: async () => {
      seeding = 'pending';
      await resetAll(world, targets);
      seeding = 'done';
    },
  }),
);

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  console.error(error);
  if (!res.headersSent) res.status(500).json({ error: String(error) });
};
app.use(errorHandler);

app.listen(env.SIMULATOR_PORT, '0.0.0.0', () => {
  console.log(
    `simulator listening on http://localhost:${env.SIMULATOR_PORT} (seed ${env.WORLD_SEED}, demo script of ${script.length} e-mails)`,
  );
});

void seedAll(world, targets).then(async () => {
  seeding = 'done';
  // Restarted without a reset (e.g. watch mode): do not send the e-mails Core already has again.
  try {
    const response = await fetch(new URL('/cases/stats', env.CORE_API_URL));
    if (response.ok) player.resumeFrom(CaseStatsSchema.parse(await response.json()).total);
  } catch {
    // Core not reachable: start from 0/X.
  }
});
