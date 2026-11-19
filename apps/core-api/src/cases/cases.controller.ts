import {
  DecisionRequestSchema,
  type BrokerView,
  type CaseDetail,
  type CaseMetrics,
  type CaseStats,
  type CaseSummary,
  type DecisionRequest,
} from '@demo/shared';
import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { ACT_AS_BROKER_HEADER, CurrentPrincipal, type Principal } from '../auth/principal.js';
import { CasesService } from './cases.service.js';

/** Public API of the broker UI: every route is limited to the caller's brokerage (V10). */
@Controller()
export class CasesController {
  constructor(private readonly cases: CasesService) {}

  @Get('brokers')
  brokers(@CurrentPrincipal() principal: Principal): Promise<BrokerView[]> {
    return this.cases.listBrokers(principal);
  }

  @Get('cases')
  list(@CurrentPrincipal() principal: Principal): Promise<CaseSummary[]> {
    return this.cases.list(principal);
  }

  @Get('cases/stats')
  stats(@CurrentPrincipal() principal: Principal): Promise<CaseStats> {
    return this.cases.stats(principal);
  }

  /** Platform-wide load metrics (demo panel, load tests). */
  @Get('cases/metrics')
  metrics(): Promise<CaseMetrics> {
    return this.cases.metrics();
  }

  @Get('cases/:id')
  detail(@Param('id') id: string, @CurrentPrincipal() principal: Principal): Promise<CaseDetail> {
    return this.cases.detail(id, principal);
  }

  @Post('cases/:id/retry')
  @HttpCode(202)
  async retry(
    @Param('id') id: string,
    @CurrentPrincipal() principal: Principal,
    @Headers(ACT_AS_BROKER_HEADER) actAs: string | undefined,
  ): Promise<{ status: 'accepted' }> {
    await this.cases.retry(id, this.cases.actor(principal, actAs));
    return { status: 'accepted' };
  }

  @Post('cases/:id/decision')
  @HttpCode(202)
  async decide(
    @Param('id') id: string,
    @CurrentPrincipal() principal: Principal,
    @Headers(ACT_AS_BROKER_HEADER) actAs: string | undefined,
    @Body({ schema: DecisionRequestSchema }) request: DecisionRequest,
  ): Promise<{ status: 'accepted' }> {
    await this.cases.decide(id, this.cases.actor(principal, actAs), request);
    return { status: 'accepted' };
  }
}
