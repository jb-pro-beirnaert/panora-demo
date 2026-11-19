import type { InboundEmailInput, ProcessEmailInput } from '@demo/shared';
import { generateEmails, generateWorld } from '@demo/world-generator';
import express, { type ErrorRequestHandler } from 'express';
import { AutoValidator } from './auto-validation/auto-validator.js';
import { controlRouter } from './control/routes.js';
import { loadEnv } from './env.js';
import { resetAll, seedAll, type SeedTargets } from './seeding/seeder.js';
import { Burst } from './stream/burst.js';
import { EmailStream } from './stream/email-stream.js';

const env = loadEnv();

// Same seed → same world and same e-mails on every start.
const world = generateWorld({
  seed: env.WORLD_SEED,
  locales: ['fr', 'en'],
  mix: { en: env.SIMULATOR_ENGLISH_SHARE },
});
const emails = generateEmails(world, { seed: env.WORLD_SEED, count: env.SIMULATOR_EMAIL_COUNT });
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

async function deliver(email: InboundEmailInput): Promise<void> {
  const response = await fetch(new URL('/emails', env.CORE_API_URL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(email),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`POST /emails failed (${response.status}): ${await response.text()}`);
  }
}

const stream = new EmailStream(
  emails.map(({ email, groundTruth }) => ({ email, language: groundTruth.emailLanguage })),
  deliver,
  { emailsPerMinute: env.SIMULATOR_EMAILS_PER_MINUTE, englishShare: env.SIMULATOR_ENGLISH_SHARE },
);
const burst = new Burst(
  emails.map(({ email }) => email),
  deliver,
);
const brokersByBrokerage = new Map<string, string[]>();
for (const broker of world.brokers) {
  brokersByBrokerage.set(broker.brokerageId, [
    ...(brokersByBrokerage.get(broker.brokerageId) ?? []),
    broker.id,
  ]);
}
const autoValidator = new AutoValidator(env.CORE_API_URL, brokersByBrokerage);

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

/** Every generated e-mail with its ground truth. `index` is 1-based. */
app.get('/emails', (_req, res) => {
  res.json(
    emails.map(({ email, groundTruth }, index) => ({
      index: index + 1,
      scenario: groundTruth.scenario,
      language: groundTruth.emailLanguage,
      subject: email.subject,
      from: email.from,
      input: workflowInput(email),
      groundTruth,
    })),
  );
});

/** A single e-mail, shaped as the input of the `process-email` workflow (paste it into Mastra Studio). */
app.get('/emails/:index', (req, res) => {
  const generated = emails[Number(req.params.index) - 1];
  if (!generated) {
    res
      .status(404)
      .json({ error: `No e-mail ${req.params.index}: valid indexes are 1 to ${emails.length}.` });
    return;
  }
  res.json(workflowInput(generated.email));
});

app.use(
  controlRouter({
    stream,
    burst,
    autoValidator,
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
    `simulator listening on http://localhost:${env.SIMULATOR_PORT} (seed ${env.WORLD_SEED}, ${emails.length} e-mails)`,
  );
});

autoValidator.listen();
void seedAll(world, targets).then(() => {
  seeding = 'done';
});
