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
import { core } from '../core-callbacks/core-client.js';
import { coverageReports, draftReport, executeReport } from '../core-callbacks/step-reports.js';
import { env } from '../env.js';
import { extranetTools } from '../mcp/extranet-client.js';
import { caseContext } from './context.js';
import { actionTypeProblem, buildClaimFiling, toProposedAction } from './claim-filing.js';
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
function clientSection(claim: TriagedEmail): string {
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
  execute: async ({ inputData, mastra }) => {
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
      requestContext: caseContext(inputData.brokerage.brokerCode, inputData.caseId),
    });
    const coverage = CoverageVerdictSchema.parse(response.object);
    for (const report of coverageReports(coverage, {
      model: env.COVERAGE_MODEL,
      durationMs: Date.now() - startedAt,
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
    `The inbound e-mail:\n\n${claim.rendered}`,
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
  execute: async ({ inputData, mastra }) => {
    const agent = mastra.getAgent('draftingAgent');
    const filing = buildClaimFiling(inputData.claim, inputData.coverage);
    const prompt = draftingPrompt(inputData);
    const startedAt = Date.now();

    let result: Draft = DraftSchema.parse(
      (await agent.generate(prompt, { structuredOutput: { schema: DraftSchema } })).object,
    );
    // The action type must be executable: one corrective retry, then fail the step.
    const problem = actionTypeProblem(result.actionType, filing);
    if (problem) {
      result = DraftSchema.parse(
        (
          await agent.generate(
            `${prompt}\n\nYour previous answer was invalid: ${problem} Answer again.`,
            { structuredOutput: { schema: DraftSchema } },
          )
        ).object,
      );
      const again = actionTypeProblem(result.actionType, filing);
      if (again) throw new Error(`draftingAgent proposed an invalid action: ${again}`);
    }
    const action = toProposedAction(result, inputData.rounds, filing);
    await core.step(
      inputData.claim.caseId,
      draftReport(action, { model: env.DRAFTING_MODEL, durationMs: Date.now() - startedAt }),
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
  execute: async ({ inputData }): Promise<ProcessEmailResult> => {
    const approved = inputData.rounds.at(-1);
    if (!approved?.decision.approved) throw new Error('execute reached without an approved action');
    const { action, decision } = approved;

    if (action.actionType !== 'file_claim') {
      // Sending the e-mail is out of scope of the demo.
      const result: ProcessEmailResult = {
        outcome: 'ready_to_send',
        action,
        approvedBy: decision.brokerId,
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
})
  .then(analyzeCoverage)
  .dountil(
    draftAndApprove,
    async ({ inputData }) => inputData.rounds.at(-1)?.decision.approved === true,
  )
  .then(execute)
  .commit();
