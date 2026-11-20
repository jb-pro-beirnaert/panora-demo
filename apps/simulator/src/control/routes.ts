import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { DemoPlayer } from '../stream/demo-player.js';

export interface ControlDeps {
  player: DemoPlayer;
  /** Wipes Core and the extranet, then seeds them again. */
  reset: () => Promise<void>;
  seeding: () => 'pending' | 'done';
}

const SpeedSchema = z.object({ intervalSeconds: z.number().int().min(3).max(600) });

function parse<T>(schema: z.ZodType<T>, req: Request, res: Response): T | null {
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid body', details: z.treeifyError(parsed.error) });
    return null;
  }
  return parsed.data;
}

/** Control API of the demo panel (V14: a finite demo script, played in order). */
export function controlRouter(deps: ControlDeps): Router {
  const router = Router();
  const state = () => ({ ...deps.player.state(), seeding: deps.seeding() });

  router.get('/state', (_req, res) => {
    res.json(state());
  });
  router.post('/start', (_req, res) => {
    deps.player.play();
    res.json(state());
  });
  router.post('/pause', (_req, res) => {
    deps.player.pause();
    res.json(state());
  });
  router.post('/resume', (_req, res) => {
    deps.player.play();
    res.json(state());
  });
  router.post('/speed', (req, res) => {
    const body = parse(SpeedSchema, req, res);
    if (!body) return;
    deps.player.setInterval(body.intervalSeconds);
    res.json(state());
  });
  router.post('/send-one', async (_req, res) => {
    const email = await deps.player.sendNext();
    res.json({
      ...state(),
      lastSent: email ? { messageId: email.messageId, subject: email.subject } : null,
    });
  });
  router.post('/reset', async (_req, res) => {
    deps.player.reset();
    await deps.reset();
    res.json(state());
  });
  return router;
}
