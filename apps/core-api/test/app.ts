import type { ApprovalDecision, ProcessEmailInput } from '@demo/shared';
import { StandardSchemaValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { MastraClient, type CaseTracing } from '../src/mastra-client/mastra-client.service.js';

/** Records the calls Core makes to Mastra instead of sending them. */
export class FakeMastraClient {
  runs = 0;
  started: { runId: string; input: ProcessEmailInput; tracing: CaseTracing }[] = [];
  resumed: { runId: string; decision: ApprovalDecision; tracing: CaseTracing }[] = [];

  async createRun(): Promise<string> {
    this.runs += 1;
    return `run-${this.runs}`;
  }
  async start(runId: string, input: ProcessEmailInput, tracing: CaseTracing): Promise<void> {
    this.started.push({ runId, input, tracing });
  }
  restarted: string[] = [];
  purged: { runIds: string[]; traceIds: string[] }[] = [];
  async purge(runIds: string[], traceIds: string[]): Promise<{ runs: number; traces: number }> {
    this.purged.push({ runIds, traceIds });
    return { runs: runIds.length, traces: traceIds.length };
  }
  async restart(runId: string): Promise<void> {
    this.restarted.push(runId);
  }
  async resume(runId: string, decision: ApprovalDecision, tracing: CaseTracing): Promise<void> {
    this.resumed.push({ runId, decision, tracing });
  }
}

export async function createTestApp(
  options: { demoMode?: boolean } = {},
): Promise<{ app: INestApplication; mastra: FakeMastraClient }> {
  const mastra = new FakeMastraClient();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.register({ demoMode: options.demoMode ?? true, workers: false })],
  })
    .overrideProvider(MastraClient)
    .useValue(mastra)
    .compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  await app.init();
  return { app, mastra };
}
