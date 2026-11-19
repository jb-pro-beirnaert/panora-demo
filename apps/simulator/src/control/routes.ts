import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { InboundEmailInput } from '@demo/shared';
import type { AutoValidator } from '../auto-validation/auto-validator.js';
import type { Burst } from '../stream/burst.js';
import type { EmailStream } from '../stream/email-stream.js';

export interface ControlDeps {
  stream: EmailStream;
  burst: Burst;
  autoValidator: AutoValidator;
  /** Wipes Core and the extranet, then seeds them again. */
  reset: () => Promise<void>;
  seeding: () => 'pending' | 'done';
  /** The flagship e-mail (scenario 2: a policy the brokerage believes active was terminated). */
  showcase: InboundEmailInput;
}

const SpeedSchema = z.object({ emailsPerMinute: z.number().positive().max(600) });
const BurstSchema = z.object({
  count: z.number().int().positive().max(5_000),
  concurrency: z.number().int().positive().max(100).optional(),
});
const LanguageMixSchema = z.object({ en: z.number().min(0).max(1) });
const AutoValidationSchema = z.object({
  enabled: z.boolean().optional(),
  delayMs: z.number().int().min(0).max(120_000).optional(),
  rejectionRate: z.number().min(0).max(1).optional(),
});

function parse<T>(schema: z.ZodType<T>, req: Request, res: Response): T | null {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid body', details: z.treeifyError(parsed.error) });
    return null;
  }
  return parsed.data;
}

/** Control API of the demo panel. */
export function controlRouter(deps: ControlDeps): Router {
  const router = Router();
  const state = () => ({
    ...deps.stream.state(),
    seeding: deps.seeding(),
    autoValidation: deps.autoValidator.settings,
    decisions: deps.autoValidator.decisions,
    burst: deps.burst.state,
  });

  router.get('/state', (_req, res) => {
    res.json(state());
  });
  router.post('/start', (_req, res) => {
    deps.stream.start();
    res.json(state());
  });
  router.post('/pause', (_req, res) => {
    deps.stream.pause();
    res.json(state());
  });
  router.post('/resume', (_req, res) => {
    deps.stream.resume();
    res.json(state());
  });
  router.post('/speed', (req, res) => {
    const body = parse(SpeedSchema, req, res);
    if (!body) return;
    deps.stream.setSpeed(body.emailsPerMinute);
    res.json(state());
  });
  router.post('/burst', (req, res) => {
    const body = parse(BurstSchema, req, res);
    if (!body) return;
    deps.burst.start(body.count, body.concurrency);
    res.status(202).json(state());
  });
  router.post('/language-mix', (req, res) => {
    const body = parse(LanguageMixSchema, req, res);
    if (!body) return;
    deps.stream.setEnglishShare(body.en);
    res.json(state());
  });
  router.post('/send-one', async (_req, res) => {
    const email = await deps.stream.sendOne();
    res.json({ ...state(), lastSent: { messageId: email.messageId, subject: email.subject } });
  });
  router.post('/send-showcase', async (_req, res) => {
    const email = await deps.stream.sendCopy(deps.showcase);
    res.json({ ...state(), lastSent: { messageId: email.messageId, subject: email.subject } });
  });
  router.post('/auto-validation', (req, res) => {
    const body = parse(AutoValidationSchema, req, res);
    if (!body) return;
    deps.autoValidator.update(
      Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined)),
    );
    res.json(state());
  });
  router.post('/reset', async (_req, res) => {
    deps.stream.stop();
    deps.autoValidator.reset();
    await deps.reset();
    res.json(state());
  });
  return router;
}
