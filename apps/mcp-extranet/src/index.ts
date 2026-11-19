import { createApp } from './app.js';
import { createDb } from './db.js';
import { loadEnv } from './env.js';

// Prisma migrations are applied by `prisma migrate deploy` before this process starts (see package.json).
const env = loadEnv();
const app = createApp(createDb(env.EXTRANET_DATABASE_URL), env);

app.listen(env.MCP_EXTRANET_PORT, '0.0.0.0', () => {
  console.log(
    `mcp-extranet listening on http://localhost:${env.MCP_EXTRANET_PORT}/mcp (demo mode: ${env.DEMO_MODE})`,
  );
});
