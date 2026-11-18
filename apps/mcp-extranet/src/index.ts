import express from 'express';

// Empty skeleton: MCP tools, Prisma and admin routes arrive with the V1 implementation.
const port = Number(process.env.MCP_EXTRANET_PORT ?? 3002);

const app = express();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'mcp-extranet' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`mcp-extranet listening on http://localhost:${port}`);
});
