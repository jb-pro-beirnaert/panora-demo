import { BullModule } from '@nestjs/bullmq';
import { Module, type DynamicModule } from '@nestjs/common';
import { InboundTokenGuard } from './emails/inbound-token.guard.js';
import { AdminModule } from './admin/admin.module.js';
import { CasesController } from './cases/cases.controller.js';
import { CasesService } from './cases/cases.service.js';
import { EmailsController } from './emails/emails.controller.js';
import { EmailsService } from './emails/emails.service.js';
import { ENV, type Env } from './env.js';
import { HealthController } from './health.controller.js';
import { InfraModule } from './infra.module.js';
import { InternalController } from './internal/internal.controller.js';
import { InternalService } from './internal/internal.service.js';
import { PortalController } from './portal/portal.controller.js';
import { PortalService } from './portal/portal.service.js';
import { ServiceTokenGuard } from './internal/service-token.guard.js';
import { MaintenanceProcessor } from './queues/maintenance.processor.js';
import { ProcessEmailProcessor } from './queues/process-email.processor.js';
import { PurgeService } from './queues/purge.service.js';
import { WatchdogService } from './queues/watchdog.service.js';
import { QueuesModule } from './queues/queues.module.js';
import { ResumeWorkflowProcessor } from './queues/resume-workflow.processor.js';
import { RealtimeController } from './realtime/realtime.controller.js';

export interface AppModuleOptions {
  /** `/admin/*` exists only in demo mode. */
  demoMode: boolean;
  /** False in tests that drive the processors by hand. */
  workers?: boolean;
}

@Module({})
export class AppModule {
  static register({ demoMode, workers = true }: AppModuleOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [
        InfraModule,
        BullModule.forRootAsync({
          inject: [ENV],
          useFactory: (env: Env) => ({
            connection: { url: env.REDIS_URL, maxRetriesPerRequest: null },
            prefix: 'core',
          }),
        }),
        QueuesModule,
        ...(demoMode ? [AdminModule] : []),
      ],
      controllers: [
        HealthController,
        EmailsController,
        CasesController,
        InternalController,
        RealtimeController,
        PortalController,
      ],
      providers: [
        EmailsService,
        CasesService,
        InternalService,
        PortalService,
        ServiceTokenGuard,
        InboundTokenGuard,
        WatchdogService,
        PurgeService,
        ...(workers ? [ProcessEmailProcessor, ResumeWorkflowProcessor, MaintenanceProcessor] : []),
      ],
    };
  }
}
