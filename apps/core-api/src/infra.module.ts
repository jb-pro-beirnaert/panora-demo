import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service.js';
import { ENV, loadEnv } from './env.js';
import { MastraClient } from './mastra-client/mastra-client.service.js';
import { PrismaService } from './prisma/prisma.service.js';
import { RealtimeService } from './realtime/realtime.service.js';

/** Shared singletons: environment, database, audit trail, realtime bus, Mastra client. */
@Global()
@Module({
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    PrismaService,
    AuditService,
    RealtimeService,
    MastraClient,
  ],
  exports: [ENV, PrismaService, AuditService, RealtimeService, MastraClient],
})
export class InfraModule {}
