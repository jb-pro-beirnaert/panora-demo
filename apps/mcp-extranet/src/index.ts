import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { type ErrorRequestHandler } from 'express';
import { adminRouter } from './admin/routes.js';
import { createDb } from './db.js';
import { loadEnv } from './env.js';
import { createMcpServer } from './mcp-server.js';

// Prisma migrations are applied by `prisma migrate deploy` before this process starts (see package.json).
const env = loadEnv();
const db = createDb(env.EXTRANET_DATABASE_URL);

const app = express();
app.use(express.json({ limit: '10mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'mcp-extranet' });
});

app.post('/mcp', async (req, res) => {
  const server = createMcpServer(db);
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

app.listen(env.MCP_EXTRANET_PORT, '0.0.0.0', () => {
  console.log(
    `mcp-extranet listening on http://localhost:${env.MCP_EXTRANET_PORT}/mcp (demo mode: ${env.DEMO_MODE})`,
  );
});
