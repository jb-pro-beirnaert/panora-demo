import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type ErrorRequestHandler, type Express } from 'express';
import { adminRouter } from './admin/routes.js';
import { authenticate } from './auth/authenticate.js';
import { writeToolCalls } from './auth/write-tools.js';
import { chaosEnabled, chaosMiddleware, type ChaosConfig } from './chaos/chaos.js';
import type { Db } from './db.js';
import type { Env } from './env.js';
import { createMcpServer } from './mcp-server.js';
import { logCall } from './tools/define-tool.js';

/** The HTTP app of the MCP extranet server (separate from `listen` so tests can start it). */
export function createApp(db: Db, env: Env): Express {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  const chaosConfig: ChaosConfig = {
    latencyMinMs: env.CHAOS_LATENCY_MIN_MS,
    latencyMaxMs: env.CHAOS_LATENCY_MAX_MS,
    errorRate: env.CHAOS_ERROR_RATE,
    rateLimitPerSecond: env.CHAOS_RATE_LIMIT_PER_SECOND,
  };
  const chaos = chaosMiddleware(chaosConfig);

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'mcp-extranet',
      chaos: chaosEnabled(chaosConfig) ? { ...chaosConfig, ...chaos.stats } : null,
    });
  });

  if (chaosEnabled(chaosConfig)) {
    console.log('flaky extranet mode on:', chaosConfig);
    app.use('/mcp', chaos.middleware);
  }

  function jsonRpcError(id: string | number | null, code: number, message: string) {
    return { jsonrpc: '2.0', error: { code, message }, id };
  }

  app.post('/mcp', async (req, res) => {
    const claims = authenticate(req, env.MCP_TOKEN_SECRET);
    if (!claims) {
      res
        .status(401)
        .set('WWW-Authenticate', 'Bearer')
        .json(jsonRpcError(null, -32001, 'Unauthorized: a valid Bearer token is required.'));
      return;
    }

    // A read token never sees `file_claim` in tools/list; an explicit call is refused (and logged)
    // instead of failing with a generic "unknown tool".
    const deniedCalls = claims.scope === 'write' ? [] : writeToolCalls(req.body);
    if (deniedCalls.length > 0) {
      const message = 'Access denied: this tool requires a write token. Your token is read-only.';
      for (const call of deniedCalls) {
        await logCall(
          { db, brokerCode: claims.brokerCode, scope: claims.scope },
          call.tool,
          call.args,
          { error: message },
          0,
        );
      }
      res.status(403).json(jsonRpcError(deniedCalls[0]?.id ?? null, -32003, message));
      return;
    }

    const server = createMcpServer(db, claims);
    // No `sessionIdGenerator`: stateless mode, every request is self-contained.
    const transport = new StreamableHTTPServerTransport({});
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Stateless server: no server-initiated stream, no session to delete.
  app.all('/mcp', (_req, res) => {
    res
      .status(405)
      .set('Allow', 'POST')
      .json({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      });
  });

  if (env.DEMO_MODE && env.ADMIN_TOKEN) {
    app.use('/admin', adminRouter(db, env.ADMIN_TOKEN));
  }

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error(error);
    if (!res.headersSent) res.status(500).json({ error: 'internal error' });
  };
  app.use(errorHandler);
  return app;
}
