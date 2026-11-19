import type { ApprovalDecision, ProcessEmailInput } from '@demo/shared';
import { StandardSchemaValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { MastraClient } from '../src/mastra-client/mastra-client.service.js';

/** Records the calls Core makes to Mastra instead of sending them. */
export class FakeMastraClient {
  runs = 0;
  started: { runId: string; input: ProcessEmailInput }[] = [];
  resumed: { runId: string; decision: ApprovalDecision }[] = [];

  async createRun(): Promise<string> {
    this.runs += 1;
    return `run-${this.runs}`;
  }
  async start(runId: string, input: ProcessEmailInput): Promise<void> {
    this.started.push({ runId, input });
  }
  async resume(runId: string, decision: ApprovalDecision): Promise<void> {
    this.resumed.push({ runId, decision });
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
