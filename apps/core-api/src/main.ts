import { StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { loadEnv } from './env.js';

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule.register({ demoMode: env.DEMO_MODE }),
    // Open SSE streams (browsers, simulator) must not keep a stopping server alive (watch reloads).
    { forceCloseConnections: true },
  );
  app.useBodyParser('json', { limit: '10mb' });
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.enableCors({ origin: env.WEB_ORIGIN.split(','), credentials: true });
  app.enableShutdownHooks();
  await app.listen(env.CORE_API_PORT, '0.0.0.0');
  console.log(
    `core-api listening on http://localhost:${env.CORE_API_PORT} (demo mode: ${env.DEMO_MODE})`,
  );
}
await bootstrap();
