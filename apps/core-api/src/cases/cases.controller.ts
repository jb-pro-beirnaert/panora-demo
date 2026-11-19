import {
  DecisionRequestSchema,
  type AgentsActivity,
  type BrokerView,
  type CaseDetail,
  type CaseMetrics,
  type CaseStats,
  type CaseSummary,
  type DecisionRequest,
} from '@demo/shared';
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { hasBearer } from '../auth/bearer-token.guard.js';
import { ENV, type Env } from '../env.js';
import { CasesService } from './cases.service.js';

/**
 * Public API of the broker UI (V12): no sign-in. The demo has a single brokerage and a single
 * broker, who is the implicit author of every decision.
 */
@Controller()
export class CasesController {
  constructor(
    private readonly cases: CasesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** The demo's broker, shown in the UI header. */
  @Get('broker')
  broker(): Promise<BrokerView> {
    return this.cases.currentBroker();
  }

  /** What each agent is working on (V13 live agents panel). */
  @Get('agents/activity')
  agentsActivity(): Promise<AgentsActivity> {
    return this.cases.agentsActivity();
  }

  @Get('cases')
  list(): Promise<CaseSummary[]> {
    return this.cases.list();
  }

  @Get('cases/stats')
  stats(): Promise<CaseStats> {
    return this.cases.stats();
  }

  /** Platform-wide load metrics (demo panel, load tests). */
  @Get('cases/metrics')
  metrics(): Promise<CaseMetrics> {
    return this.cases.metrics();
  }

  @Get('cases/:id')
  detail(@Param('id') id: string): Promise<CaseDetail> {
    return this.cases.detail(id);
  }

  @Post('cases/:id/retry')
  @HttpCode(202)
  async retry(@Param('id') id: string): Promise<{ status: 'accepted' }> {
    await this.cases.retry(id);
    return { status: 'accepted' };
  }

  @Post('cases/:id/decision')
  @HttpCode(202)
  async decide(
    @Param('id') id: string,
    @Req() http: Request,
    @Body({ schema: DecisionRequestSchema }) request: DecisionRequest,
  ): Promise<{ status: 'accepted' }> {
    await this.cases.decide(id, request, { auto: this.isSimulator(http) });
    return { status: 'accepted' };
  }

  /** The simulated broker (auto-validation) calls with the demo admin token. */
  private isSimulator(http: Request): boolean {
    return Boolean(
      this.env.DEMO_MODE && this.env.ADMIN_TOKEN && hasBearer(http, this.env.ADMIN_TOKEN),
    );
  }
}
