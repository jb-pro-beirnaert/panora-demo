import type {
  ClientDetail,
  ClientSummary,
  InsurerClauses,
  InsurerPolicySummary,
  InsurerPolicyView,
} from '@demo/shared';
import { Controller, Get, Param, Query } from '@nestjs/common';
import { PortalService } from './portal.service.js';

/** V17, read-only: the insurer's extranet and the brokerage's clients, for the broker's UI. */
@Controller()
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  @Get('insurer/policies')
  policies(@Query('q') query?: string): Promise<InsurerPolicySummary[]> {
    return this.portal.policies(query);
  }

  @Get('insurer/policies/:number')
  policy(@Param('number') number: string): Promise<InsurerPolicyView> {
    return this.portal.policy(number);
  }

  /** The general conditions of the insurer that wrote this clause. */
  @Get('insurer/clauses/:ref')
  conditions(@Param('ref') ref: string): Promise<InsurerClauses> {
    return this.portal.conditions(ref);
  }

  @Get('clients')
  clients(@Query('q') query?: string): Promise<ClientSummary[]> {
    return this.portal.clients(query);
  }

  @Get('clients/:id')
  client(@Param('id') id: string): Promise<ClientDetail> {
    return this.portal.client(id);
  }
}
