import { z } from 'zod';
import { AlertTypeSchema, LocaleSchema, PolicyStatusSchema, VerdictSchema } from './domain.js';
import { ProposedActionSchema } from './drafting.js';
import { ProcessEmailResultSchema, RunOptionsSchema } from './process-email.js';
import { InboundEmailInputSchema } from './inbound-email.js';

/**
 * Contracts of the Core API (apps/core-api): seed payload, Mastra → Core callbacks, public API
 * payloads and realtime (SSE) events.
 */

// --- Seed (simulator → POST /admin/seed) ---

export const CoreBrokerageSchema = z.object({
  id: z.string(),
  name: z.string(),
  brokerCode: z.string(),
  locale: LocaleSchema,
  inboxEmail: z.email(),
});
export type CoreBrokerage = z.infer<typeof CoreBrokerageSchema>;

export const CoreBrokerSchema = z.object({
  id: z.string(),
  brokerageId: z.string(),
  name: z.string(),
  email: z.email(),
  preferredLocale: LocaleSchema,
});
export type CoreBroker = z.infer<typeof CoreBrokerSchema>;

export const CoreClientSchema = z.object({
  id: z.string(),
  brokerageId: z.string(),
  companyName: z.string(),
  siren: z.string().regex(/^\d{9}$/),
  email: z.email(),
  contactName: z.string(),
});
export type CoreClient = z.infer<typeof CoreClientSchema>;

export const CorePolicySchema = z.object({
  number: z.string(),
  clientId: z.string(),
  insurerName: z.string(),
  product: z.string(),
  /** What the brokerage's software believes (may differ from the insurer). */
  knownStatus: PolicyStatusSchema,
  renewalDate: z.iso.date(),
});
export type CorePolicy = z.infer<typeof CorePolicySchema>;

export const CoreSeedSchema = z.object({
  brokerages: z.array(CoreBrokerageSchema),
  brokers: z.array(CoreBrokerSchema),
  clients: z.array(CoreClientSchema),
  policies: z.array(CorePolicySchema),
});
export type CoreSeed = z.infer<typeof CoreSeedSchema>;

// --- Cases ---

export const CaseStatusSchema = z.enum([
  /** E-mail stored, `process-email` job queued. */
  'received',
  /** Workflow running (initial run or after a decision). */
  'processing',
  /** Suspended on the `approval` step: a broker must decide. */
  'awaiting_approval',
  /** Not a claim: classified, workflow finished. */
  'classified',
  /** Approved `file_claim` executed at the insurer. */
  'claim_filed',
  /** Approved e-mail ready to be sent (sending is out of scope). */
  'ready_to_send',
  /** The workflow failed. */
  'failed',
]);
export type CaseStatus = z.infer<typeof CaseStatusSchema>;

export const CLOSED_CASE_STATUSES: readonly CaseStatus[] = [
  'classified',
  'claim_filed',
  'ready_to_send',
];

export const AgentNameSchema = z.enum(['system', 'triage', 'coverage', 'drafting']);
export type AgentName = z.infer<typeof AgentNameSchema>;

/**
 * Business-level step types shown in the case timeline. Stored as `stepType` + `params` and rendered
 * by the UI's translation files (`steps.<stepType>`), so the timeline follows the UI language.
 */
export const StepTypeSchema = z.enum([
  'prepare.completed',
  'triage.client_found',
  'triage.client_not_found',
  'triage.completed',
  'triage.classified',
  'coverage.policy_checked',
  'coverage.verdict',
  'drafting.proposed',
  'execute.claim_filed',
  'execute.ready_to_send',
]);
export type StepType = z.infer<typeof StepTypeSchema>;

/** Scalar parameters only: they are interpolated into translated messages. */
export const StepParamsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]),
);
export type StepParams = z.infer<typeof StepParamsSchema>;

/** Where a step read its facts: an e-mail section, an attachment page, an MCP tool, a clause. */
export const StepSourceSchema = z.object({
  kind: z.enum(['email', 'attachment', 'mcp_tool', 'clause', 'core']),
  /** File name, tool name or clause reference. */
  ref: z.string(),
  page: z.number().int().nullable().optional(),
  /** Verbatim excerpt (clauses: original language). */
  excerpt: z.string().optional(),
});
export type StepSource = z.infer<typeof StepSourceSchema>;

/** `POST /internal/cases/:id/steps` (Mastra → Core). */
export const AgentStepCallbackSchema = z.object({
  agent: AgentNameSchema,
  stepType: StepTypeSchema,
  params: StepParamsSchema,
  sources: z.array(StepSourceSchema).default([]),
  model: z.string().nullable().default(null),
  durationMs: z.number().int().nonnegative().nullable().default(null),
  inputTokens: z.number().int().nonnegative().nullable().default(null),
  outputTokens: z.number().int().nonnegative().nullable().default(null),
  costUsd: z.number().nonnegative().nullable().default(null),
});
export type AgentStepCallback = z.input<typeof AgentStepCallbackSchema>;

/** `POST /internal/cases/:id/proposed-action` (Mastra → Core), sent right before `suspend()`. */
export const ProposedActionCallbackSchema = z.object({
  workflowRunId: z.string().min(1),
  action: ProposedActionSchema,
  /** Language of `clientEmailDraft` (the inbound e-mail's language). */
  draftLanguage: LocaleSchema,
  /** Language of `internalNote` (`Brokerage.locale`). */
  noteLanguage: LocaleSchema,
  verdict: VerdictSchema,
  alerts: z.array(AlertTypeSchema),
});
export type ProposedActionCallback = z.infer<typeof ProposedActionCallbackSchema>;

/** `POST /internal/cases/:id/executed-action` (Mastra → Core): the workflow's final result. */
export const ExecutedActionCallbackSchema = z.object({
  workflowRunId: z.string().min(1),
  result: ProcessEmailResultSchema,
});
export type ExecutedActionCallback = z.infer<typeof ExecutedActionCallbackSchema>;

/** `POST /internal/cases/:id/failed` (Mastra → Core). */
export const WorkflowFailedCallbackSchema = z.object({
  workflowRunId: z.string().min(1),
  error: z.string(),
});
export type WorkflowFailedCallback = z.infer<typeof WorkflowFailedCallbackSchema>;

/** `GET /internal/clients?email=&brokerCode=` (tool `find_client` of `triageAgent`). */
export const ClientLookupQuerySchema = z.object({
  email: z.email(),
  brokerCode: z.string().min(1),
});
export type ClientLookupQuery = z.infer<typeof ClientLookupQuerySchema>;

export const ClientLookupResultSchema = z.object({
  client: z.object({
    id: z.string(),
    companyName: z.string(),
    siren: z.string(),
    contactName: z.string(),
  }),
  policies: z.array(
    z.object({
      number: z.string(),
      insurerName: z.string(),
      product: z.string(),
      knownStatus: PolicyStatusSchema,
    }),
  ),
});
export type ClientLookupResult = z.infer<typeof ClientLookupResultSchema>;

/** `POST /cases/:id/decision` (UI → Core). The broker comes from the session. */
export const DecisionRequestSchema = z.object({
  approved: z.boolean(),
  comment: z.string().trim().min(1).max(2_000).optional(),
});
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;

/** Body of `POST /emails`: the e-mail, plus run options for evals (demo mode only). */
export const ReceiveEmailRequestSchema = InboundEmailInputSchema.extend({
  runOptions: RunOptionsSchema.optional(),
});
export type ReceiveEmailRequest = z.infer<typeof ReceiveEmailRequestSchema>;

/** Response of `POST /emails`. */
export const EmailAcceptedSchema = z.object({
  caseId: z.string(),
  reference: z.string(),
  /** False when the same `messageId` was already received (no new case). */
  created: z.boolean(),
});
export type EmailAccepted = z.infer<typeof EmailAcceptedSchema>;

// --- Audit ---

export const AuditActorSchema = z.enum(['system', 'agent', 'broker']);
export type AuditActor = z.infer<typeof AuditActorSchema>;

/** Rendered by the UI (`audit.<action>`). */
export const AuditActionSchema = z.enum([
  'email_received',
  'workflow_started',
  'agent_step',
  'action_proposed',
  'action_approved',
  'action_rejected',
  'workflow_resumed',
  'case_classified',
  'claim_filed',
  'ready_to_send',
  'workflow_failed',
  /** V9: the watchdog restarted a stuck run, or a broker relaunched a failed case. */
  'workflow_restarted',
  'workflow_retried',
  /** V10 retention: the workflow snapshot and the trace of a closed case were deleted. */
  'data_purged',
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

// --- Realtime (GET /realtime, SSE) ---

export const RealtimeEventTypeSchema = z.enum([
  'case.created',
  'case.updated',
  'case.step',
  'case.action_proposed',
  'case.agent_event',
  'case.closed',
  'demo.reset',
]);
export type RealtimeEventType = z.infer<typeof RealtimeEventTypeSchema>;

export const RealtimeEventSchema = z.object({
  type: RealtimeEventTypeSchema,
  caseId: z.string().nullable(),
  /** Brokerage of the case: a broker only receives their brokerage's events (null: everyone). */
  brokerageId: z.string().nullable().default(null),
  /** Small payload: the UI refetches the case when it needs more. */
  data: z.record(z.string(), z.unknown()).default({}),
});
export type RealtimeEvent = z.infer<typeof RealtimeEventSchema>;

/** Load metrics (`GET /cases/metrics`, V9): throughput, durations, queues. */
export const CaseMetricsSchema = z.object({
  total: z.number().int(),
  byStatus: z.record(z.string(), z.number().int()),
  /** Cases closed during the last minute. */
  closedLastMinute: z.number().int(),
  /** From reception to closing, for closed cases. */
  durationMs: z.object({ p50: z.number(), p95: z.number() }).nullable(),
  queues: z.record(
    z.string(),
    z.object({
      waiting: z.number().int(),
      active: z.number().int(),
      delayed: z.number().int(),
      failed: z.number().int(),
      completed: z.number().int(),
    }),
  ),
  /** Watchdog restarts and broker relaunches. */
  restarts: z.number().int(),
});
export type CaseMetrics = z.infer<typeof CaseMetricsSchema>;

/** Workflow steps announced by a `step_started` agent event (V13). */
export const WorkStepSchema = z.enum(['triage', 'coverage', 'drafting', 'execute']);
export type WorkStep = z.infer<typeof WorkStepSchema>;

/**
 * Where a case stands, for the UI (V13): waiting in the queue, one of the agents (or the execution)
 * running, waiting for the broker, closed or failed.
 */
export const CaseStageSchema = z.enum([
  'queued',
  'triage',
  'coverage',
  'drafting',
  'awaiting_approval',
  'execute',
  'done',
  'failed',
]);
export type CaseStage = z.infer<typeof CaseStageSchema>;

/** `GET /agents/activity` (V13): what each agent is working on, for the live agents panel. */
export const AgentsActivitySchema = z.object({
  queued: z.number().int(),
  awaitingApproval: z.number().int(),
  executing: z.number().int(),
  agents: z.array(
    z.object({
      agent: z.enum(['triage', 'coverage', 'drafting']),
      running: z.number().int(),
      /** Model of the agent's latest step (`provider/model`). */
      model: z.string().nullable(),
      /** The case it touched most recently, and the tool it called last. */
      current: z
        .object({ caseId: z.string(), reference: z.string(), tool: z.string().nullable() })
        .nullable(),
    }),
  ),
});
export type AgentsActivity = z.infer<typeof AgentsActivitySchema>;

/** Counters of the demo panel (`GET /cases/stats`). */
export const CaseStatsSchema = z.object({
  total: z.number().int(),
  inProgress: z.number().int(),
  awaitingApproval: z.number().int(),
  closed: z.number().int(),
  failed: z.number().int(),
});
export type CaseStats = z.infer<typeof CaseStatsSchema>;

// --- Live agent events (V5) ---

/**
 * What an agent is doing right now, rendered by the UI (`events.<eventType>`): a tool call, or the
 * start of a workflow step (V13, `params.step` is a `WorkStep`).
 */
export const AgentEventTypeSchema = z.enum(['tool_call', 'step_started']);
export type AgentEventType = z.infer<typeof AgentEventTypeSchema>;

/** `POST /internal/cases/:id/agent-events` (Mastra → Core), sent from the agents' loop. */
export const AgentEventCallbackSchema = z.object({
  agent: AgentNameSchema,
  eventType: AgentEventTypeSchema,
  /** `tool` plus the few arguments worth showing (policy number, clause ref…). */
  params: z.record(z.string(), z.string()),
});
export type AgentEventCallback = z.infer<typeof AgentEventCallbackSchema>;

export const AgentEventViewSchema = AgentEventCallbackSchema.extend({
  id: z.string(),
  createdAt: z.string(),
});
export type AgentEventView = z.infer<typeof AgentEventViewSchema>;

// --- Public API views (Core → Web) ---

export const BrokerViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  preferredLocale: LocaleSchema,
  brokerage: z.object({ id: z.string(), name: z.string(), brokerCode: z.string() }),
});
export type BrokerView = z.infer<typeof BrokerViewSchema>;

export const CaseSummarySchema = z.object({
  id: z.string(),
  reference: z.string(),
  status: CaseStatusSchema,
  brokerageName: z.string(),
  clientName: z.string().nullable(),
  from: z.string(),
  subject: z.string(),
  language: LocaleSchema,
  requestType: z.string().nullable(),
  verdict: VerdictSchema.nullable(),
  alerts: z.array(AlertTypeSchema),
  receivedAt: z.string(),
  updatedAt: z.string(),
  /** V13: live stage, the tool the running agent called last, number of proposals so far. */
  stage: CaseStageSchema,
  currentTool: z.string().nullable(),
  revision: z.number().int(),
});
export type CaseSummary = z.infer<typeof CaseSummarySchema>;

export const AgentStepViewSchema = z.object({
  id: z.string(),
  agent: AgentNameSchema,
  stepType: StepTypeSchema,
  params: StepParamsSchema,
  sources: z.array(StepSourceSchema),
  model: z.string().nullable(),
  durationMs: z.number().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  costUsd: z.number().nullable(),
  createdAt: z.string(),
});
export type AgentStepView = z.infer<typeof AgentStepViewSchema>;

export const ProposedActionViewSchema = z.object({
  id: z.string(),
  revision: z.number().int(),
  actionType: z.enum(['request_documents', 'file_claim', 'notify_denial']),
  draftSubject: z.string(),
  draftBody: z.string(),
  draftLanguage: LocaleSchema,
  internalNote: z.string(),
  noteLanguage: LocaleSchema,
  claimFiling: z.record(z.string(), z.unknown()).nullable(),
  status: z.enum(['pending', 'approved', 'rejected']),
  decidedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  comment: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ProposedActionView = z.infer<typeof ProposedActionViewSchema>;

export const AuditLogViewSchema = z.object({
  id: z.string(),
  actor: AuditActorSchema,
  actorId: z.string(),
  /** Broker's name for broker entries. */
  actorName: z.string().nullable(),
  action: AuditActionSchema,
  params: z.record(z.string(), z.unknown()),
  source: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditLogView = z.infer<typeof AuditLogViewSchema>;

export const CaseDetailSchema = CaseSummarySchema.extend({
  brokerage: z.object({
    id: z.string(),
    name: z.string(),
    brokerCode: z.string(),
    locale: LocaleSchema,
  }),
  client: z.object({ id: z.string(), companyName: z.string() }).nullable(),
  policyNumber: z.string().nullable(),
  /** What the brokerage believes about `policyNumber` (compared with the insurer's status). */
  knownPolicyStatus: PolicyStatusSchema.nullable(),
  claimNumber: z.string().nullable(),
  failureReason: z.string().nullable(),
  workflowRunId: z.string().nullable(),
  /** Langfuse trace of the case (one trace per case: initial run and resumes). */
  traceId: z.string().nullable(),
  email: z.object({
    from: z.string(),
    to: z.string(),
    subject: z.string(),
    body: z.string(),
    receivedAt: z.string(),
    language: LocaleSchema,
    attachments: z.array(
      z.object({ fileName: z.string(), type: z.string(), extractedText: z.string() }),
    ),
  }),
  steps: z.array(AgentStepViewSchema),
  agentEvents: z.array(AgentEventViewSchema),
  proposedActions: z.array(ProposedActionViewSchema),
  auditLogs: z.array(AuditLogViewSchema),
});
export type CaseDetail = z.infer<typeof CaseDetailSchema>;
