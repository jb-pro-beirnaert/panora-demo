import { Mastra } from '@mastra/core/mastra';

// Scaffolded by `npm create mastra@latest --empty`. Storage, MCP clients, agents and the
// process-email workflow arrive with the V1 implementation.
export const mastra = new Mastra({
  server: {
    port: Number(process.env.MASTRA_PORT ?? 4111),
    host: process.env.MASTRA_HOST ?? 'localhost',
  },
});
