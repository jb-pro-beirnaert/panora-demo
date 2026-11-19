import {
  DecisionRequestSchema,
  type BrokerView,
  type CaseDetail,
  type CaseMetrics,
  type CaseStats,
  type CaseSummary,
  type DecisionRequest,
} from '@demo/shared';
import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CurrentBrokerId } from '../auth/current-broker.js';
import { CasesService } from './cases.service.js';

@Controller()
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  /** Brokers of the seed, for the UI's broker selector (V3). */
  @Get('brokers')
  brokers(): Promise<BrokerView[]> {
    return this.cases.listBrokers();
  }

  @Get('cases')
  list(): Promise<CaseSummary[]> {
    return this.cases.list();
  }

  @Get('cases/stats')
  stats(): Promise<CaseStats> {
    return this.cases.stats();
  }

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
  async retry(
    @Param('id') id: string,
    @CurrentBrokerId() brokerId: string,
  ): Promise<{ status: 'accepted' }> {
    await this.cases.retry(id, brokerId);
    return { status: 'accepted' };
  }

  @Post('cases/:id/decision')
  @HttpCode(202)
  async decide(
    @Param('id') id: string,
    @CurrentBrokerId() brokerId: string,
    @Body({ schema: DecisionRequestSchema }) request: DecisionRequest,
  ): Promise<{ status: 'accepted' }> {
    await this.cases.decide(id, brokerId, request);
    return { status: 'accepted' };
  }
}
