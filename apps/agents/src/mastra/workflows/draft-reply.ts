import { detectLanguage, DraftReplyInputSchema } from '@demo/shared';
import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { env } from '../env.js';
import { caseContext } from './context.js';
import { renderEmail } from './process-email.js';
import { standaloneReply } from './reply.js';

const draft = createStep({
  id: 'draft-reply',
  description: 'draftingAgent writes a standalone reply (case status, acknowledgement).',
  inputSchema: DraftReplyInputSchema,
  outputSchema: z.object({ proposed: z.boolean() }),
  execute: async ({ inputData, mastra, tracingContext, runId }) => {
    await standaloneReply({
      mastra,
      caseId: inputData.caseId,
      workflowRunId: runId,
      kind: inputData.kind,
      context: inputData.caseContext,
      emailText: renderEmail(inputData.email),
      emailLanguage: detectLanguage(`${inputData.email.subject}\n${inputData.email.body}`),
      noteLanguage: inputData.brokerage.locale,
      ...(inputData.previous ? { previous: inputData.previous } : {}),
      requestContext: caseContext(inputData.brokerage.brokerCode, inputData.caseId),
      tracingContext,
    });
    return { proposed: true };
  },
});

/**
 * V15, started by Core: a reply no workflow waits for — the status of a case after a follow-up,
 * or the re-draft of a rejected acknowledgement or status reply. The broker approves it in the UI;
 * nothing is executed.
 */
export const draftReplyWorkflow = createWorkflow({
  id: 'draft-reply',
  description:
    'A standalone reply to the client (case status after a follow-up, acknowledgement), proposed to the broker.',
  inputSchema: DraftReplyInputSchema,
  outputSchema: z.object({ proposed: z.boolean() }),
  retryConfig: { attempts: env.WORKFLOW_STEP_ATTEMPTS, delay: 2_000 },
})
  .then(draft)
  .commit();
