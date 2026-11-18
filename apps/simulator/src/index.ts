import { generateEmails, generateWorld } from '@demo/world-generator';
import express from 'express';
import { loadEnv } from './env.js';
import { seedExtranet } from './seeding/seed-extranet.js';

const env = loadEnv();

// Same seed → same world and same e-mails on every start.
const world = generateWorld({ seed: env.WORLD_SEED, locale: 'fr' });
const emails = generateEmails(world, { seed: env.WORLD_SEED, count: env.SIMULATOR_EMAIL_COUNT });
let seeding: 'pending' | 'done' = 'pending';

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
      email,
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
  res.json(generated.email);
});

app.listen(env.SIMULATOR_PORT, '0.0.0.0', () => {
  console.log(
    `simulator listening on http://localhost:${env.SIMULATOR_PORT} (seed ${env.WORLD_SEED}, ${emails.length} e-mails)`,
  );
});

void seedExtranet(world, env.MCP_EXTRANET_URL, env.ADMIN_TOKEN).then(() => {
  seeding = 'done';
});
