import {
  ApprovalDecisionSchema,
  ProcessEmailResultSchema,
  ProposedActionSchema,
  RequestCancellationResultSchema,
  ServiceAnalysisSchema,
  type ActionType,
  type AgentStepCallback,
  type ProcessEmailResult,
  type ProposedAction,
  type ServiceAnalysis,
} from '@demo/shared';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { reportStepStarted, reportToolCalls } from '../core-callbacks/agent-events.js';
import { core } from '../core-callbacks/core-client.js';
import type { Timing } from '../core-callbacks/step-reports.js';
import { env } from '../env.js';
import { extranetTools } from '../mcp/extranet-client.js';
import { modelSpecOf } from '../models.js';
import { simulateService } from '../simulated/agents.js';
import { annotateSpan, caseContext } from './context.js';
import { clientSection } from './handle-claim.js';
import {
  finalReply,
  formatDate,
  generateDraft,
  languagesSection,
  standaloneReply,
} from './reply.js';
import { ApprovalRoundSchema, TriagedEmailSchema, type TriagedEmail } from './schemas.js';

/**
 * V15: requests about an existing policy that are not claims — a cancellation, a question about
 * the cover. policyServiceAgent checks them (read-only tools); a proposal goes through the same
 * human approval loop as a claim; the cancellation is written at the insurer only after approval.
 */

const SERVICE_MAX_STEPS = 12;

const ServiceStateSchema = z.object({
  request: TriagedEmailSchema,
  analysis: ServiceAnalysisSchema,
  rounds: z.array(ApprovalRoundSchema),
});
const DraftedServiceSchema = ServiceStateSchema.extend({ action: ProposedActionSchema });

function serviceReports(analysis: ServiceAnalysis, timing: Timing): AgentStepCallback[] {
  const reports: AgentStepCallback[] = [];
  if (analysis.policyNumber && analysis.policyStatus) {
    reports.push({
      agent: 'service',
      stepType: 'service.policy_checked',
      params: {
        policyNumber: analysis.policyNumber,
        status: analysis.policyStatus,
        renewalDate: analysis.renewalDate,
      },
      sources: [
        {
          kind: 'mcp_tool',
          ref: 'get_policy',
          link: { type: 'policy', policyNumber: analysis.policyNumber },
        },
      ],
    });
  }
  reports.push({
    agent: 'service',
    stepType: 'service.analysis',
    params: {
      outcome: analysis.outcome,
      handoverReason: analysis.handoverReason,
      policyNumber: analysis.policyNumber,
      effectiveDate: analysis.effectiveDate,
      alerts: analysis.alerts,
    },
    sources: analysis.citations.map((citation) => ({
      kind: 'clause',
      ref: citation.clauseRef,
      excerpt: citation.excerpt,
      link: { type: 'clause', clauseRef: citation.clauseRef },
    })),
    model: timing.model,
    durationMs: timing.durationMs,
    inputTokens: timing.usage?.inputTokens ?? null,
    outputTokens: timing.usage?.outputTokens ?? null,
  });
  return reports;
}

const analyzeService = createStep({
  id: 'analyze-service',
  description:
    "policyServiceAgent checks a cancellation or a question against the brokerage's records and the insurer's extranet.",
  inputSchema: TriagedEmailSchema,
  outputSchema: ServiceStateSchema,
  execute: async ({ inputData, mastra, tracingContext }) => {
    const requestContext = caseContext(
      inputData.brokerage.brokerCode,
      inputData.caseId,
      inputData.options,
    );
    const model = modelSpecOf('coverage', requestContext);
    annotateSpan(tracingContext, 'service', model, {
      emailLanguage: inputData.triage.emailLanguage,
    });
    await reportStepStarted(inputData.caseId, 'service', { model });
    const startedAt = Date.now();
    let analysis: ServiceAnalysis;
    let usage;
    if (env.AGENTS_MODE === 'simulated') {
      analysis = await simulateService(inputData, env.SIMULATED_LLM_LATENCY_MS);
    } else {
      const response = await mastra
        .getAgent('policyServiceAgent')
        .generate(
          [
            `Request: ${inputData.triage.requestType}${inputData.triage.subtype ? ` (${inputData.triage.subtype})` : ''}.`,
            `The e-mail was received on ${inputData.receivedDate}.`,
            clientSection(inputData),
            `Facts extracted by the triage agent (JSON):\n${JSON.stringify(inputData.triage, null, 2)}`,
            `The e-mail:\n\n${inputData.rendered}`,
          ].join('\n\n'),
          {
            maxSteps: SERVICE_MAX_STEPS,
            structuredOutput: { schema: ServiceAnalysisSchema },
            requestContext,
            tracingContext,
            onStepFinish: reportToolCalls(inputData.caseId, 'service'),
            abortSignal: AbortSignal.timeout(env.LLM_TIMEOUT_MS),
          },
        );
      analysis = ServiceAnalysisSchema.parse(response.object);
      usage = response.usage;
    }
    for (const report of serviceReports(analysis, {
      model: env.AGENTS_MODE === 'simulated' ? 'simulated' : model,
      durationMs: Date.now() - startedAt,
      usage,
    })) {
      await core.step(inputData.caseId, report);
    }
    return { request: inputData, analysis, rounds: [] };
  },
});

/** The action is decided by code from the analysis; the agent writes the reply. */
export function serviceActionOf(request: TriagedEmail, analysis: ServiceAnalysis): ActionType {
  if (request.triage.requestType === 'information') return 'answer_question';
  const nothingToDo = analysis.alerts.some(
    (alert) => alert === 'already_terminated' || alert === 'cancellation_already_requested',
  );
  return nothingToDo || !analysis.effectiveDate ? 'send_status' : 'cancel_policy';
}

const draftService = createStep({
  id: 'draft-service',
  description:
    "draftingAgent writes the reply and the note for the broker (and applies the broker's comment after a rejection).",
  inputSchema: ServiceStateSchema,
  outputSchema: DraftedServiceSchema,
  execute: async ({ inputData, mastra, tracingContext }) => {
    const { request, analysis, rounds } = inputData;
    const requestContext = caseContext(
      request.brokerage.brokerCode,
      request.caseId,
      request.options,
    );
    const model = modelSpecOf('drafting', requestContext);
    const revision = rounds.length + 1;
    annotateSpan(tracingContext, 'drafting', model, {
      emailLanguage: request.triage.emailLanguage,
      revision,
    });
    await reportStepStarted(request.caseId, 'drafting', { model, revision: String(revision) });
    const actionType = serviceActionOf(request, analysis);
    const sections = [
      languagesSection(request.triage.emailLanguage, request.brokerage.locale),
      `The e-mail was received on ${request.receivedDate}.`,
      `Use actionType "${actionType}".`,
      `Analysis of the request from the brokerage's records and the insurer's extranet (JSON):\n${JSON.stringify(analysis, null, 2)}`,
      `The inbound e-mail:\n\n${request.rendered}`,
    ];
    for (const { action, decision } of rounds) {
      sections.push(
        `### Revision ${action.revision} (rejected by the broker)\n${JSON.stringify({ clientEmailDraft: action.clientEmailDraft, internalNote: action.internalNote }, null, 2)}\nBroker's comment: ${decision.comment ?? '(no comment)'}`,
      );
    }
    sections.push(
      rounds.length > 0
        ? `Write revision ${revision}, applying the broker's latest comment.`
        : 'Write the first proposal.',
    );
    const startedAt = Date.now();
    const { draft, usage } = await generateDraft({
      mastra,
      prompt: sections.join('\n\n'),
      requestContext,
      tracingContext,
      actionType,
      emailLanguage: request.triage.emailLanguage,
      noteLanguage: request.brokerage.locale,
    });
    const action: ProposedAction = {
      ...draft,
      revision,
      claimFiling: null,
      // Built by code, never by the LLM.
      cancellation:
        actionType === 'cancel_policy' && analysis.policyNumber && analysis.effectiveDate
          ? {
              policyNumber: analysis.policyNumber,
              effectiveDate: analysis.effectiveDate,
              reason: 'client_request',
            }
          : null,
    };
    await core.step(request.caseId, {
      agent: 'drafting',
      stepType: 'drafting.proposed',
      params: { actionType: action.actionType, revision },
      model,
      durationMs: Date.now() - startedAt,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });
    return { ...inputData, action };
  },
});

const approveService = createStep({
  id: 'approve-service',
  description: "Waits for the broker's decision on the proposal.",
  inputSchema: DraftedServiceSchema,
  outputSchema: ServiceStateSchema,
  suspendSchema: z.object({ action: ProposedActionSchema }),
  resumeSchema: ApprovalDecisionSchema,
  execute: async ({ inputData, resumeData, suspendData, suspend, runId }) => {
    const { action, ...state } = inputData;
    if (!resumeData || suspendData?.action.revision !== action.revision) {
      const { request, analysis } = state;
      await core.proposedAction(request.caseId, {
        workflowRunId: runId,
        action,
        draftLanguage: request.triage.emailLanguage,
        noteLanguage: request.brokerage.locale,
        verdict: null,
        alerts: analysis.alerts,
        awaitsWorkflow: true,
      });
      return await suspend({ action });
    }
    return { ...state, rounds: [...state.rounds, { action, decision: resumeData }] };
  },
});

const draftAndApproveService = createWorkflow({
  id: 'draft-and-approve-service',
  description: 'A proposal, then the broker approves or rejects it.',
  inputSchema: ServiceStateSchema,
  outputSchema: ServiceStateSchema,
})
  .then(draftService)
  .then(approveService)
  .commit();

const executeService = createStep({
  id: 'execute-service',
  description:
    'Runs the approved action: request_cancellation through the MCP write token, otherwise ready_to_send.',
  inputSchema: ServiceStateSchema,
  outputSchema: ProcessEmailResultSchema,
  execute: async ({ inputData, mastra, tracingContext }): Promise<ProcessEmailResult> => {
    const approved = inputData.rounds.at(-1);
    if (!approved?.decision.approved) throw new Error('execute reached without an approved action');
    const { action, decision } = approved;
    const { request } = inputData;
    const language = request.triage.emailLanguage;
    await reportStepStarted(request.caseId, 'execute', { actionType: action.actionType });
    const reply = (values: Record<string, string>) =>
      finalReply({
        mastra,
        caseId: request.caseId,
        action,
        comment: decision.comment,
        values,
        requestContext: caseContext(request.brokerage.brokerCode, request.caseId, request.options),
        tracingContext,
        emailLanguage: language,
        noteLanguage: request.brokerage.locale,
      });

    if (action.actionType !== 'cancel_policy') {
      const result: ProcessEmailResult = {
        outcome: 'ready_to_send',
        action,
        approvedBy: decision.brokerId,
        finalDraft: await reply({}),
      };
      await core.step(request.caseId, {
        agent: 'system',
        stepType: 'execute.ready_to_send',
        params: { actionType: action.actionType },
      });
      return result;
    }
    if (!action.cancellation) throw new Error('approved cancel_policy action without cancellation');
    const tools = await extranetTools('write', request.brokerage.brokerCode);
    const cancel = tools.request_cancellation;
    if (!cancel?.execute) {
      throw new Error('the MCP write token does not expose request_cancellation');
    }
    const recorded = RequestCancellationResultSchema.parse(
      await cancel.execute(action.cancellation, {}),
    );
    await core.step(request.caseId, {
      agent: 'system',
      stepType: 'execute.cancellation_filed',
      params: {
        policyNumber: recorded.policyNumber,
        effectiveDate: recorded.effectiveDate,
        alreadyRequested: recorded.alreadyRequested,
      },
      sources: [{ kind: 'mcp_tool', ref: 'request_cancellation' }],
    });
    return {
      outcome: 'cancellation_filed',
      effectiveDate: recorded.effectiveDate,
      action,
      approvedBy: decision.brokerId,
      finalDraft: await reply({ effectiveDate: formatDate(recorded.effectiveDate, language) }),
    };
  },
});

/** The broker must handle the request: an acknowledgement is proposed, the case is handed over. */
const serviceHandover = createStep({
  id: 'service-handover',
  description:
    'The agents cannot handle the request: an acknowledgement for the client, then the broker takes over.',
  inputSchema: ServiceStateSchema,
  outputSchema: ProcessEmailResultSchema,
  execute: async ({ inputData, mastra, tracingContext, runId }): Promise<ProcessEmailResult> => {
    const { request, analysis } = inputData;
    const reason = analysis.handoverReason ?? 'unclassified';
    await handOver({ request, reason, details: analysis, mastra, tracingContext, runId });
    return { outcome: 'handover', reason };
  },
});

/** Shared by every hand-over (service analysis, certificate, quote, unmatched follow-up). */
export async function handOver(options: {
  request: TriagedEmail;
  reason: NonNullable<ServiceAnalysis['handoverReason']>;
  details?: unknown;
  mastra: Parameters<typeof standaloneReply>[0]['mastra'];
  tracingContext: Parameters<typeof standaloneReply>[0]['tracingContext'];
  runId: string;
}): Promise<void> {
  const { request } = options;
  await core.step(request.caseId, {
    agent: 'system',
    stepType: 'handover',
    params: { reason: options.reason },
  });
  await standaloneReply({
    mastra: options.mastra,
    caseId: request.caseId,
    workflowRunId: options.runId,
    kind: 'acknowledge',
    context: JSON.stringify(
      {
        requestType: request.triage.requestType,
        subtype: request.triage.subtype,
        handoverReason: options.reason,
        client: request.client?.client ?? null,
        policies: request.client?.policies ?? [],
        details: options.details ?? null,
      },
      null,
      2,
    ),
    emailText: request.rendered,
    emailLanguage: request.triage.emailLanguage,
    noteLanguage: request.brokerage.locale,
    requestContext: caseContext(request.brokerage.brokerCode, request.caseId, request.options),
    tracingContext: options.tracingContext,
  });
}

const serviceProposal = createWorkflow({
  id: 'service-proposal',
  description: 'Proposals submitted to the broker until one is approved, then execution.',
  inputSchema: ServiceStateSchema,
  outputSchema: ProcessEmailResultSchema,
})
  .dountil(
    draftAndApproveService,
    async ({ inputData }) => inputData.rounds.at(-1)?.decision.approved === true,
  )
  .then(executeService)
  .commit();

const collectService = createStep({
  id: 'collect-service',
  description: 'Returns the result of the branch that ran.',
  inputSchema: z.object({
    'service-handover': ProcessEmailResultSchema.optional(),
    'service-proposal': ProcessEmailResultSchema.optional(),
  }),
  outputSchema: ProcessEmailResultSchema,
  execute: async ({ inputData }) => {
    const result = inputData['service-handover'] ?? inputData['service-proposal'];
    if (!result) throw new Error('no branch produced a result');
    return result;
  },
});

/** analyze-service → handover | (draft → approval) until approved → execute. */
export const handleServiceWorkflow = createWorkflow({
  id: 'handle-service',
  description:
    'Cancellation or question about a policy: analysis, then a proposal approved by the broker and its execution, or a hand-over to the broker.',
  inputSchema: TriagedEmailSchema,
  outputSchema: ProcessEmailResultSchema,
  retryConfig: { attempts: env.WORKFLOW_STEP_ATTEMPTS, delay: 2_000 },
})
  .then(analyzeService)
  .branch([
    [async ({ inputData }) => inputData.analysis.outcome === 'handover', serviceHandover],
    [async ({ inputData }) => inputData.analysis.outcome === 'proposal', serviceProposal],
  ])
  .then(collectService)
  .commit();
