import {
  AgentEventCallbackSchema,
  AgentStepCallbackSchema,
  ClientCasesQuerySchema,
  ClientLookupQuerySchema,
  ExecutedActionCallbackSchema,
  ProposedActionCallbackSchema,
  WorkflowFailedCallbackSchema,
  type AgentEventCallback,
  type AgentStepCallback,
  type ClientCase,
  type ClientCasesQuery,
  type ClientLookupQuery,
  type ClientLookupResult,
  type ExecutedActionCallback,
  type ProposedActionCallback,
  type WorkflowFailedCallback,
} from '@demo/shared';
import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { InternalService, type CallbackOutcome } from './internal.service.js';
import { ServiceTokenGuard } from './service-token.guard.js';

/** Routes called by the Mastra server only (service token). */
@Controller('internal')
@UseGuards(ServiceTokenGuard)
export class InternalController {
  constructor(private readonly internal: InternalService) {}

  @Post('cases/:id/steps')
  @HttpCode(200)
  step(
    @Param('id') id: string,
    @Body({ schema: AgentStepCallbackSchema }) body: AgentStepCallback,
  ): Promise<CallbackOutcome> {
    return this.internal.recordStep(id, body);
  }

  @Post('cases/:id/agent-events')
  @HttpCode(200)
  agentEvent(
    @Param('id') id: string,
    @Body({ schema: AgentEventCallbackSchema }) body: AgentEventCallback,
  ): Promise<CallbackOutcome> {
    return this.internal.recordAgentEvent(id, body);
  }

  @Post('cases/:id/proposed-action')
  @HttpCode(200)
  proposedAction(
    @Param('id') id: string,
    @Body({ schema: ProposedActionCallbackSchema }) body: ProposedActionCallback,
  ): Promise<CallbackOutcome> {
    return this.internal.recordProposedAction(id, body);
  }

  @Post('cases/:id/executed-action')
  @HttpCode(200)
  executedAction(
    @Param('id') id: string,
    @Body({ schema: ExecutedActionCallbackSchema }) body: ExecutedActionCallback,
  ): Promise<CallbackOutcome> {
    return this.internal.recordExecutedAction(id, body);
  }

  @Post('cases/:id/failed')
  @HttpCode(200)
  failed(
    @Param('id') id: string,
    @Body({ schema: WorkflowFailedCallbackSchema }) body: WorkflowFailedCallback,
  ): Promise<CallbackOutcome> {
    return this.internal.recordFailure(id, body);
  }

  /** V15 tool `find_client_cases` (declared before `clients` so the path is not shadowed). */
  @Get('clients/cases')
  findClientCases(
    @Query({ schema: ClientCasesQuerySchema }) query: ClientCasesQuery,
  ): Promise<ClientCase[]> {
    return this.internal.findClientCases(query);
  }

  @Get('clients')
  findClient(
    @Query({ schema: ClientLookupQuerySchema }) query: ClientLookupQuery,
  ): Promise<ClientLookupResult> {
    return this.internal.findClient(query);
  }
}
