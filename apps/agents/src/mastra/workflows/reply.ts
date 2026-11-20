import {
  DraftSchema,
  type ActionType,
  type Draft,
  type FinalDraft,
  type Locale,
  type ProposedAction,
} from '@demo/shared';
import type { Mastra } from '@mastra/core/mastra';
import type { TracingContext } from '@mastra/core/observability';
import type { RequestContext } from '@mastra/core/request-context';
import { reportStepStarted } from '../core-callbacks/agent-events.js';
import { core } from '../core-callbacks/core-client.js';
import type { Usage } from '../core-callbacks/step-reports.js';
import { env } from '../env.js';
import { modelSpecOf } from '../models.js';
import { simulateDraft } from '../simulated/agents.js';

/** V15: replies to the client — placeholders, the broker's approval comment, standalone replies. */

export const LANGUAGE_NAMES: Record<Locale, string> = { fr: 'French', en: 'English' };

export function languagesSection(emailLanguage: Locale, noteLanguage: Locale): string {
  return [
    'Languages:',
    `- clientEmailDraft (subject and body): ${LANGUAGE_NAMES[emailLanguage]} (the language of the inbound e-mail, "${emailLanguage}").`,
    `- internalNote: ${LANGUAGE_NAMES[noteLanguage]} (brokerage locale "${noteLanguage}").`,
  ].join('\n');
}

/** `{{claimNumber}}` → `S-2026-0413`. Unknown placeholders are left as they are. */
export function fillPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name: string) => values[name] ?? match);
}

/** `2027-12-27` → `27/12/2027` (fr) or `27 December 2027` (en), for the reply to the client. */
export function formatDate(date: string, language: Locale): string {
  const value = new Date(`${date}T00:00:00Z`);
  return language === 'fr'
    ? value.toLocaleDateString('fr-FR', { timeZone: 'UTC' })
    : value.toLocaleDateString('en-GB', { timeZone: 'UTC', dateStyle: 'long' });
}

/** Calls `draftingAgent` (or its simulated stand-in) and forces the action type when given. */
export async function generateDraft(options: {
  mastra: Mastra;
  prompt: string;
  requestContext: RequestContext;
  tracingContext?: TracingContext;
  actionType: ActionType;
  emailLanguage: Locale;
  noteLanguage: Locale;
}): Promise<{ draft: Draft; usage: Usage | undefined }> {
  if (env.AGENTS_MODE === 'simulated') {
    const draft = await simulateDraft(
      options.actionType,
      options.emailLanguage,
      options.noteLanguage,
      env.SIMULATED_LLM_LATENCY_MS,
    );
    return { draft, usage: undefined };
  }
  const response = await options.mastra.getAgent('draftingAgent').generate(options.prompt, {
    structuredOutput: { schema: DraftSchema },
    requestContext: options.requestContext,
    tracingContext: options.tracingContext,
    abortSignal: AbortSignal.timeout(env.LLM_TIMEOUT_MS),
  });
  const draft = DraftSchema.parse(response.object);
  // The action is decided by code for every request but a claim: the agent only writes.
  return { draft: { ...draft, actionType: options.actionType }, usage: response.usage };
}

/**
 * The reply as it will be sent (V15): the broker's approval comment applied by `draftingAgent`
 * (client e-mail only), then the placeholders filled with the insurer's answer.
 */
export async function finalReply(options: {
  mastra: Mastra;
  caseId: string | null;
  action: ProposedAction;
  comment: string | undefined;
  values: Record<string, string>;
  requestContext: RequestContext;
  tracingContext?: TracingContext;
  emailLanguage: Locale;
  noteLanguage: Locale;
}): Promise<FinalDraft> {
  let subject = options.action.clientEmailDraft.subject;
  let body = options.action.clientEmailDraft.body;
  if (options.comment) {
    const model = modelSpecOf('drafting', options.requestContext);
    await reportStepStarted(options.caseId, 'drafting', { model, polish: 'true' });
    const startedAt = Date.now();
    const { draft, usage } = await generateDraft({
      mastra: options.mastra,
      prompt: [
        languagesSection(options.emailLanguage, options.noteLanguage),
        'Polish: the broker approved this proposal with a comment. Rewrite clientEmailDraft only, applying the comment; keep the facts and the {{placeholders}} exactly.',
        `The approved proposal (JSON):\n${JSON.stringify({ actionType: options.action.actionType, clientEmailDraft: options.action.clientEmailDraft, internalNote: options.action.internalNote }, null, 2)}`,
        `Broker's comment: ${options.comment}`,
      ].join('\n\n'),
      requestContext: options.requestContext,
      tracingContext: options.tracingContext,
      actionType: options.action.actionType,
      emailLanguage: options.emailLanguage,
      noteLanguage: options.noteLanguage,
    });
    subject = draft.clientEmailDraft.subject;
    body = draft.clientEmailDraft.body;
    await core.step(options.caseId, {
      agent: 'drafting',
      stepType: 'drafting.polished',
      params: { comment: options.comment },
      model,
      durationMs: Date.now() - startedAt,
      inputTokens: usage?.inputTokens ?? null,
      outputTokens: usage?.outputTokens ?? null,
    });
  }
  return {
    subject: fillPlaceholders(subject, options.values),
    body: fillPlaceholders(body, options.values),
  };
}

/**
 * A reply no workflow waits for (V15): an acknowledgement when the broker must handle the case, or
 * the status of a case after a follow-up. Proposed to the broker; approving it makes it ready to
 * send, nothing else.
 */
export async function standaloneReply(options: {
  mastra: Mastra;
  caseId: string | null;
  workflowRunId: string;
  kind: 'acknowledge' | 'send_status';
  context: string;
  emailText: string;
  emailLanguage: Locale;
  noteLanguage: Locale;
  previous?: { subject: string; body: string; comment: string | null };
  requestContext: RequestContext;
  tracingContext?: TracingContext;
}): Promise<void> {
  const model = modelSpecOf('drafting', options.requestContext);
  await reportStepStarted(options.caseId, 'drafting', { model });
  const startedAt = Date.now();
  const sections = [
    languagesSection(options.emailLanguage, options.noteLanguage),
    `Use actionType "${options.kind}".`,
    `What the brokerage knows (JSON):\n${options.context}`,
    `The inbound e-mail:\n\n${options.emailText}`,
  ];
  if (options.previous) {
    sections.push(
      `Previous reply (rejected by the broker):\n${JSON.stringify({ subject: options.previous.subject, body: options.previous.body }, null, 2)}`,
      `Broker's comment: ${options.previous.comment ?? '(no comment)'}`,
      'Write a new reply, applying the comment.',
    );
  }
  const { draft, usage } = await generateDraft({
    mastra: options.mastra,
    prompt: sections.join('\n\n'),
    requestContext: options.requestContext,
    tracingContext: options.tracingContext,
    actionType: options.kind,
    emailLanguage: options.emailLanguage,
    noteLanguage: options.noteLanguage,
  });
  const action: ProposedAction = {
    ...draft,
    revision: 1,
    claimFiling: null,
    cancellation: null,
  };
  await core.step(options.caseId, {
    agent: 'drafting',
    stepType: 'drafting.proposed',
    params: { actionType: action.actionType, revision: action.revision },
    model,
    durationMs: Date.now() - startedAt,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
  });
  await core.proposedAction(options.caseId, {
    workflowRunId: options.workflowRunId,
    action,
    draftLanguage: options.emailLanguage,
    noteLanguage: options.noteLanguage,
    verdict: null,
    alerts: [],
    awaitsWorkflow: false,
  });
}
