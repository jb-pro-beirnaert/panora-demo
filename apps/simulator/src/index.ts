import express from 'express';

// Empty skeleton: world seeding and GET /emails arrive with the V1 implementation.
const port = Number(process.env.SIMULATOR_PORT ?? 3003);

const app = express();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'simulator' });
});

app.listen(port, '0.0.0.0', () => {
  console.log(`simulator listening on http://localhost:${port}`);
});
