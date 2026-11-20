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
import { Body, Controller, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CasesService } from './cases.service.js';

/**
 * Public API of the broker UI (V12): no sign-in. The demo has a single brokerage and a single
 * broker, who is the implicit author of every decision.
 */
@Controller()
export class CasesController {
  constructor(private readonly cases: CasesService) {}

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
    @Body({ schema: DecisionRequestSchema }) request: DecisionRequest,
  ): Promise<{ status: 'accepted' }> {
    await this.cases.decide(id, request);
    return { status: 'accepted' };
  }

  /** The real file of an attachment (V14): a PDF opens in the browser. */
  @Get('cases/:id/attachments/:attachmentId/file')
  async attachmentFile(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.cases.attachmentFile(id, attachmentId);
    response
      .type(file.type)
      .set('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`)
      .set('X-Content-Type-Options', 'nosniff')
      .send(Buffer.from(file.content));
  }
}
