import {
  ApprovalDecisionSchema,
  CoverageVerdictSchema,
  DraftSchema,
  FileClaimResultSchema,
  ProcessEmailResultSchema,
  type Draft,
  type Locale,
  type ProcessEmailResult,
} from '@demo/shared';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { reportStepStarted, reportToolCalls } from '../core-callbacks/agent-events.js';
import { core } from '../core-callbacks/core-client.js';
import {
  addUsage,
  type Usage,
  coverageReports,
  draftReport,
  executeReport,
} from '../core-callbacks/step-reports.js';
import { env } from '../env.js';
import { modelSpecOf } from '../models.js';
import { claimActionOf, simulateCoverage, simulateDraft } from '../simulated/agents.js';
import { extranetTools } from '../mcp/extranet-client.js';
import { annotateSpan, caseContext } from './context.js';
import { actionTypeProblem, buildClaimFiling, toProposedAction } from './claim-filing.js';
import { finalReply } from './reply.js';
import {
  ApprovalSuspendSchema,
  ClaimLoopStateSchema,
  DraftedStateSchema,
  TriagedEmailSchema,
  type ClaimLoopState,
  type TriagedEmail,
} from './schemas.js';

/** Upper bound on LLM round-trips for the coverage agent (about 7 tool calls + the answer). */
const COVERAGE_MAX_STEPS = 16;

const LANGUAGE_NAMES: Record<Locale, string> = { fr: 'French', en: 'English' };

/** What the brokerage's own software knows about the sender, for the coverage agent. */
export function clientSection(claim: TriagedEmail): string {
  if (!claim.client) {
    return "Brokerage's records (find_client): the sender's address is not a known client of the brokerage.";
  }
  return `Brokerage's records for the sender (find_client; statuses as the brokerage knows them, the insurer is authoritative):\n${JSON.stringify(claim.client, null, 2)}`;
}

const analyzeCoverage = createStep({
  id: 'analyze-coverage',
  description: "coverageAgent checks the claim against the insurer's extranet through MCP.",
  inputSchema: TriagedEmailSchema,
  outputSchema: ClaimLoopStateSchema,
  execute: async ({ inputData, mastra, tracingContext }) => {
    const requestContext = caseContext(
      inputData.brokerage.brokerCode,
      inputData.caseId,
      inputData.options,
    );
    const model = modelSpecOf('coverage', requestContext);
    await reportStepStarted(inputData.caseId, 'coverage', { model });
    if (inputData.precomputed) {
      // Single-agent architecture: the verdict was produced at triage.
      for (const report of coverageReports(inputData.precomputed.coverage, {
        model,
        durationMs: 0,
      })) {
        await core.step(inputData.caseId, report);
      }
      return { claim: inputData, coverage: inputData.precomputed.coverage, rounds: [] };
    }
    annotateSpan(tracingContext, 'coverage', model, {
      emailLanguage: inputData.triage.emailLanguage,
    });
    if (env.AGENTS_MODE === 'simulated') {
      const coverage = await simulateCoverage(
        inputData,
        requestContext,
        env.SIMULATED_LLM_LATENCY_MS,
      );
      for (const report of coverageReports(coverage, { model: 'simulated', durationMs: 0 })) {
        await core.step(inputData.caseId, report);
      }
      return { claim: inputData, coverage, rounds: [] };
    }
    const prompt = [
      `The e-mail was received on ${inputData.receivedDate}.`,
      clientSection(inputData),
      `Facts extracted by the triage agent (JSON):\n${JSON.stringify(inputData.triage, null, 2)}`,
      `The e-mail:\n\n${inputData.rendered}`,
    ].join('\n\n');
    const startedAt = Date.now();
    const response = await mastra.getAgent('coverageAgent').generate(prompt, {
      maxSteps: COVERAGE_MAX_STEPS,
      structuredOutput: { schema: CoverageVerdictSchema },
      requestContext,
      tracingContext,
      onStepFinish: reportToolCalls(inputData.caseId, 'coverage'),
      abortSignal: AbortSignal.timeout(env.LLM_TIMEOUT_MS),
    });
    const coverage = CoverageVerdictSchema.parse(response.object);
    for (const report of coverageReports(coverage, {
      model,
      durationMs: Date.now() - startedAt,
      usage: response.usage,
    })) {
      await core.step(inputData.caseId, report);
    }
    return { claim: inputData, coverage, rounds: [] };
  },
});

function draftingPrompt(state: ClaimLoopState): string {
  const { claim, coverage, rounds } = state;
  const sections = [
    [
      'Languages:',
      `- clientEmailDraft (subject and body): ${LANGUAGE_NAMES[claim.triage.emailLanguage]} (the language of the inbound e-mail, "${claim.triage.emailLanguage}").`,
      `- internalNote: ${LANGUAGE_NAMES[claim.brokerage.locale]} (brokerage locale "${claim.brokerage.locale}").`,
    ].join('\n'),
    `The e-mail was received on ${claim.receivedDate}.`,
    `Coverage verdict from the insurer's extranet (JSON):\n${JSON.stringify(coverage, null, 2)}`,
    `Facts extracted by the triage agent (JSON):\n${JSON.stringify(claim.triage, null, 2)}`,
    // Reduced context (V8): the drafting agent works from the facts and the verdict; it only needs
    // the e-mail itself (greeting, tone), not the attachments.
    claim.options?.context === 'reduced'
      ? `The inbound e-mail (attachments omitted):\n\nFrom: ${claim.email.from}\nSubject: ${claim.email.subject}\n\n${claim.email.body}`
      : `The inbound e-mail:\n\n${claim.rendered}`,
  ];
  if (rounds.length > 0) {
    const history = rounds.map(({ action, decision }) =>
      [
        `### Revision ${action.revision} (rejected by the broker)`,
        JSON.stringify(
          {
            actionType: action.actionType,
            clientEmailDraft: action.clientEmailDraft,
            internalNote: action.internalNote,
          },
          null,
          2,
        ),
        `Broker's comment: ${decision.comment ?? '(no comment)'}`,
      ].join('\n'),
    );
    sections.push(
      `Previous proposals:\n\n${history.join('\n\n')}`,
      `Write revision ${rounds.length + 1}, applying the broker's latest comment.`,
    );
  } else {
    sections.push('Write the first proposal.');
  }
  return sections.join('\n\n');
}

const draft = createStep({
  id: 'draft',
  description:
    "draftingAgent proposes an action, an e-mail to the client and a note for the broker (and takes the broker's comment into account after a rejection).",
  inputSchema: ClaimLoopStateSchema,
  outputSchema: DraftedStateSchema,
  execute: async ({ inputData, mastra, tracingContext }) => {
    const { claim } = inputData;
    const requestContext = caseContext(claim.brokerage.brokerCode, claim.caseId, claim.options);
    const model = modelSpecOf('drafting', requestContext);
    annotateSpan(tracingContext, 'drafting', model, {
      emailLanguage: claim.triage.emailLanguage,
      revision: inputData.rounds.length + 1,
    });
    await reportStepStarted(claim.caseId, 'drafting', {
      model,
      revision: String(inputData.rounds.length + 1),
    });
    const agent = mastra.getAgent('draftingAgent');
    const filing = buildClaimFiling(claim, inputData.coverage);
    const prompt = draftingPrompt(inputData);
    const startedAt = Date.now();
    let usage: Usage | undefined;
    let result: Draft;
    if (env.AGENTS_MODE === 'simulated') {
      result = await simulateDraft(
        claimActionOf(inputData.coverage),
        claim.triage.emailLanguage,
        claim.brokerage.locale,
        env.SIMULATED_LLM_LATENCY_MS,
      );
    } else if (claim.precomputed && inputData.rounds.length === 0) {
      // Single-agent architecture: the first draft was produced at triage.
      result = claim.precomputed.draft;
    } else {
      const first = await agent.generate(prompt, {
        structuredOutput: { schema: DraftSchema },
        requestContext,
        tracingContext,
        abortSignal: AbortSignal.timeout(env.LLM_TIMEOUT_MS),
      });
      usage = first.usage;
      result = DraftSchema.parse(first.object);
    }
    // The action type must be executable: one corrective retry, then fail the step.
    const problem = actionTypeProblem(result.actionType, filing);
    if (problem) {
      const retry = await agent.generate(
        `${prompt}\n\nYour previous answer was invalid: ${problem} Answer again.`,
        { structuredOutput: { schema: DraftSchema }, requestContext, tracingContext },
      );
      usage = addUsage(usage, retry.usage);
      result = DraftSchema.parse(retry.object);
      const again = actionTypeProblem(result.actionType, filing);
      if (again) throw new Error(`draftingAgent proposed an invalid action: ${again}`);
    }
    const action = toProposedAction(result, inputData.rounds, filing);
    await core.step(
      inputData.claim.caseId,
      draftReport(action, {
        model,
        durationMs: Date.now() - startedAt,
        usage,
      }),
    );
    return { ...inputData, action };
  },
});

const approval = createStep({
  id: 'approval',
  description:
    "Waits for the broker's decision on the proposed action (suspended until resumed with { approved, comment?, brokerId }).",
  inputSchema: DraftedStateSchema,
  outputSchema: ClaimLoopStateSchema,
  suspendSchema: ApprovalSuspendSchema,
  resumeSchema: ApprovalDecisionSchema,
  execute: async ({ inputData, resumeData, suspendData, suspend, runId }) => {
    const { action, ...state } = inputData;
    // A decision only counts for the proposal it was given on: in a new loop iteration, a new
    // revision always waits for its own decision.
    if (!resumeData || suspendData?.action.revision !== action.revision) {
      const { claim, coverage } = state;
      await core.proposedAction(claim.caseId, {
        workflowRunId: runId,
        action,
        draftLanguage: claim.triage.emailLanguage,
        noteLanguage: claim.brokerage.locale,
        verdict: coverage.verdict,
        alerts: coverage.alerts,
        awaitsWorkflow: true,
      });
      return await suspend({ action });
    }
    return { ...state, rounds: [...state.rounds, { action, decision: resumeData }] };
  },
});

/** One iteration of the loop: a proposal, then the broker's decision. */
const draftAndApprove = createWorkflow({
  id: 'draft-and-approve',
  description: 'draftingAgent writes a proposal, then the broker approves or rejects it.',
  inputSchema: ClaimLoopStateSchema,
  outputSchema: ClaimLoopStateSchema,
})
  .then(draft)
  .then(approval)
  .commit();

async function reportExecution(caseId: string | null, result: ProcessEmailResult): Promise<void> {
  const report = executeReport(result);
  if (report) await core.step(caseId, report);
}

const execute = createStep({
  id: 'execute',
  description:
    'Runs the approved action: file_claim through the MCP write token, otherwise ready_to_send.',
  inputSchema: ClaimLoopStateSchema,
  outputSchema: ProcessEmailResultSchema,
  execute: async ({ inputData, mastra, tracingContext }): Promise<ProcessEmailResult> => {
    const approved = inputData.rounds.at(-1);
    if (!approved?.decision.approved) throw new Error('execute reached without an approved action');
    const { action, decision } = approved;
    const { claim } = inputData;
    // V15: the reply as it will be sent — the approval comment applied, placeholders filled.
    const reply = (values: Record<string, string>) =>
      finalReply({
        mastra,
        caseId: claim.caseId,
        action,
        comment: decision.comment,
        values,
        requestContext: caseContext(claim.brokerage.brokerCode, claim.caseId, claim.options),
        tracingContext,
        emailLanguage: claim.triage.emailLanguage,
        noteLanguage: claim.brokerage.locale,
      });
    await reportStepStarted(inputData.claim.caseId, 'execute', { actionType: action.actionType });

    if (action.actionType !== 'file_claim') {
      // Sending the e-mail is out of scope of the demo.
      const result: ProcessEmailResult = {
        outcome: 'ready_to_send',
        action,
        approvedBy: decision.brokerId,
        finalDraft: await reply({}),
      };
      await reportExecution(inputData.claim.caseId, result);
      return result;
    }
    if (!action.claimFiling) throw new Error('approved file_claim action without claimFiling');
    const tools = await extranetTools('write', inputData.claim.brokerage.brokerCode);
    const fileClaim = tools.file_claim;
    if (!fileClaim?.execute) throw new Error('the MCP write token does not expose file_claim');
    const filed = FileClaimResultSchema.parse(await fileClaim.execute(action.claimFiling, {}));
    const result: ProcessEmailResult = {
      outcome: 'claim_filed',
      claimNumber: filed.claimNumber,
      action,
      approvedBy: decision.brokerId,
      finalDraft: await reply({ claimNumber: filed.claimNumber }),
    };
    await reportExecution(inputData.claim.caseId, result);
    return result;
  },
});

/** analyze-coverage → (draft → approval) until approved → execute. */
export const handleClaimWorkflow = createWorkflow({
  id: 'handle-claim',
  description:
    'Coverage analysis, then proposals submitted to the broker until one is approved, then execution.',
  inputSchema: TriagedEmailSchema,
  outputSchema: ProcessEmailResultSchema,
  retryConfig: { attempts: env.WORKFLOW_STEP_ATTEMPTS, delay: 2_000 },
})
  .then(analyzeCoverage)
  .dountil(
    draftAndApprove,
    async ({ inputData }) => inputData.rounds.at(-1)?.decision.approved === true,
  )
  .then(execute)
  .commit();
