import { timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';

export function requireAdminToken(adminToken: string): RequestHandler {
  const expected = Buffer.from(`Bearer ${adminToken}`);
  return (req, res, next) => {
    const received = Buffer.from(req.get('authorization') ?? '');
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    next();
  };
}
