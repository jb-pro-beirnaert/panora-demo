import type { InboundEmailInput, ProcessEmailInput } from '@demo/shared';
import { generateEmails, generateWorld } from '@demo/world-generator';
import express from 'express';
import { loadEnv } from './env.js';
import { seedExtranet } from './seeding/seed-extranet.js';

const env = loadEnv();

// Same seed → same world and same e-mails on every start.
const world = generateWorld({ seed: env.WORLD_SEED, locale: 'fr' });
const emails = generateEmails(world, { seed: env.WORLD_SEED, count: env.SIMULATOR_EMAIL_COUNT });
let seeding: 'pending' | 'done' = 'pending';

/** Input of the `process-email` workflow: the e-mail and the brokerage whose inbox received it. */
function workflowInput(email: InboundEmailInput): ProcessEmailInput {
  const brokerage = world.brokerages.find((candidate) => candidate.inboxEmail === email.to);
  if (!brokerage) throw new Error(`No brokerage has the inbox ${email.to}`);
  return { email, brokerage: { brokerCode: brokerage.brokerCode, locale: brokerage.locale } };
}

const app = express();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'simulator', seed: env.WORLD_SEED, seeding });
});

/** Every generated e-mail with its ground truth. `index` is 1-based. */
app.get('/emails', (_req, res) => {
  res.json(
    emails.map(({ email, groundTruth }, index) => ({
      index: index + 1,
      scenario: groundTruth.scenario,
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

app.listen(env.SIMULATOR_PORT, '0.0.0.0', () => {
  console.log(
    `simulator listening on http://localhost:${env.SIMULATOR_PORT} (seed ${env.WORLD_SEED}, ${emails.length} e-mails)`,
  );
});

void seedExtranet(world, env.MCP_EXTRANET_URL, env.ADMIN_TOKEN).then(() => {
  seeding = 'done';
});
