import { toRawEmail } from '@demo/documents';
import type { CaseDetail, InboundEmailInput, RawEmailInput, RealtimeEvent } from '@demo/shared';
import { generateEmails, generateWorld, toCoreSeed } from '@demo/world-generator';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { AuditService } from '../src/audit/audit.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ProcessEmailProcessor } from '../src/queues/process-email.processor.js';
import { PurgeService } from '../src/queues/purge.service.js';
import { MAX_RESTARTS, WatchdogService } from '../src/queues/watchdog.service.js';
import { PROCESS_EMAIL_QUEUE, RESUME_WORKFLOW_QUEUE } from '../src/queues/queue-names.js';
import { RealtimeService } from '../src/realtime/realtime.service.js';
import { createTestApp, type FakeMastraClient } from './app.js';
import { TEST_ADMIN_TOKEN, TEST_INBOUND_TOKEN, TEST_SERVICE_TOKEN } from './test-env.js';

const world = generateWorld({ seed: 42, locale: 'fr' });
const emails = generateEmails(world, { seed: 42, count: 10 });
/** Scenario 2: the policy the brokerage believes active is terminated at the insurer. */
const terminatedText = emails.find((e) => e.groundTruth.scenario === 'policy_terminated')!.email;
/** V14: the e-mail as it arrives, with real PDFs (set in `beforeAll`). */
let terminated: RawEmailInput;
/** Every generated e-mail with its real PDFs, by message id. */
const rawById = new Map<string, RawEmailInput>();
const delorme = world.brokerages.find((b) => b.brokerCode === 'DLM-075')!;
const delormeBroker = world.brokers.find((b) => b.brokerageId === delorme.id)!;

const admin = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };
const service = { authorization: `Bearer ${TEST_SERVICE_TOKEN}` };
const inbound = { authorization: `Bearer ${TEST_INBOUND_TOKEN}` };

const proposal = (revision: number, actionType = 'notify_denial') => ({
  workflowRunId: 'run-1',
  verdict: 'not_covered',
  alerts: ['policy_terminated'],
  draftLanguage: 'fr',
  noteLanguage: 'fr',
  action: {
    revision,
    actionType,
    clientEmailDraft: { subject: 'Votre sinistre', body: `Bonjour, version ${revision}.` },
    internalNote: 'Contrat résilié côté assureur : à vérifier en priorité.',
    claimFiling: null,
  },
});

describe('case lifecycle (Postgres + Redis)', () => {
  let app: INestApplication;
  let mastra: FakeMastraClient;
  // The UI (V12): no sign-in, no cookie.
  let http: ReturnType<typeof request.agent>;
  const events: RealtimeEvent[] = [];

  beforeAll(async () => {
    ({ app, mastra } = await createTestApp());
    terminated = await toRawEmail(terminatedText);
    for (const { email } of emails) rawById.set(email.messageId, await toRawEmail(email));
    http = request.agent(app.getHttpServer());
    app
      .get(RealtimeService)
      .stream()
      .subscribe((event) => events.push(event));
    await http.post('/admin/seed').set(admin).send(toCoreSeed(world)).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Generated e-mails (attachments as text) are sent with their real PDFs, as the simulator does. */
  const receive = (email: RawEmailInput | InboundEmailInput) => {
    const asText = email.attachments.some((attachment) => 'extractedText' in attachment);
    const raw = asText
      ? { ...email, attachments: rawById.get(email.messageId)?.attachments ?? [] }
      : email;
    return http.post('/emails').set(inbound).send(raw);
  };
  const detail = async (caseId: string) =>
    (await http.get(`/cases/${caseId}`).expect(200)).body as CaseDetail;

  let caseId: string;

  it('opens a case for an inbound e-mail and queues its processing', async () => {
    const response = await receive(terminated).expect(202);
    expect(response.body).toMatchObject({ reference: 'CASE-0001', created: true });
    caseId = response.body.caseId;

    const queue = app.get<Queue>(getQueueToken(PROCESS_EMAIL_QUEUE));
    const kase = await app.get(PrismaService).case.findUniqueOrThrow({ where: { id: caseId } });
    const job = await queue.getJob(kase.emailId);
    expect(job?.data).toEqual({ caseId });
    expect(events.map((event) => event.type)).toContain('case.created');

    const view = await detail(caseId);
    expect(view.status).toBe('received');
    expect(view.client?.companyName).toBe('Boulangerie Martin SARL');
    expect(view.email.attachments.map((a) => a.fileName)).toEqual([
      'constat.pdf',
      'facture_plombier.pdf',
    ]);
    // V14: Core keeps the file and extracts its text for the agents.
    const [constat] = view.email.attachments;
    expect(constat!.extractionStatus).toBe('ok');
    expect(constat!.pageCount).toBeGreaterThan(0);
    expect(constat!.extractedText).toMatch(/^--- page 1 ---\n.*CONSTAT/s);
    const file = await http.get(`/cases/${caseId}/attachments/${constat!.id}/file`).expect(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(
      Buffer.from(file.body as Buffer)
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
    expect(view.auditLogs.map((log) => log.action)).toEqual(['email_received']);
  });

  it('creates a single case when the same e-mail arrives twice', async () => {
    const response = await receive(terminated).expect(202);
    expect(response.body).toEqual({ caseId, reference: 'CASE-0001', created: false });
  });

  it('rejects an e-mail sent to an unknown inbox and an invalid payload', async () => {
    await receive({ ...terminated, messageId: '<x@y>', to: 'nobody@nowhere.fr' }).expect(422);
    await http.post('/emails').set(inbound).send({ subject: 'no sender' }).expect(400);
    // Only the inbound gateway may post e-mails.
    await request(app.getHttpServer()).post('/emails').send(terminated).expect(401);
  });

  it('the worker starts the workflow and stores the run id without waiting', async () => {
    const processor = new ProcessEmailProcessor(
      app.get(PrismaService),
      mastra as never,
      app.get(AuditService),
      app.get(RealtimeService),
    );
    const started = performance.now();
    await processor.process({ data: { caseId } } as never);
    expect(performance.now() - started).toBeLessThan(500);
    expect(mastra.started).toHaveLength(1);
    expect(mastra.started[0]?.input).toMatchObject({
      caseId,
      brokerage: { brokerCode: 'DLM-075', locale: 'fr' },
    });
    // One Langfuse trace and session per case, stored on the case.
    const traceId = caseId.replace(/-/g, '');
    expect(mastra.started[0]?.tracing).toEqual({
      traceId,
      metadata: { sessionId: caseId, caseId, brokerCode: 'DLM-075', emailLanguage: 'fr' },
    });
    expect((await detail(caseId)).traceId).toBe(traceId);
    // A retried job does not start a second run.
    await processor.process({ data: { caseId } } as never);
    expect(mastra.started).toHaveLength(1);
    expect((await detail(caseId)).status).toBe('processing');
  });

  it('refuses internal callbacks without the service token', async () => {
    await http.post(`/internal/cases/${caseId}/steps`).send({}).expect(401);
    await http.get('/internal/clients?email=a@b.fr&brokerCode=DLM-075').expect(401);
  });

  it('find_client returns the client and their policies, or a 404 an LLM can act on', async () => {
    const found = await http
      .get('/internal/clients')
      .query({ email: terminated.from, brokerCode: 'DLM-075' })
      .set(service)
      .expect(200);
    expect(found.body.policies).toContainEqual(
      expect.objectContaining({ number: 'C-48213', knownStatus: 'active' }),
    );
    const missing = await http
      .get('/internal/clients')
      .query({ email: 'stranger@example.fr', brokerCode: 'DLM-075' })
      .set(service)
      .expect(404);
    expect(missing.body.message).toMatch(/search_policy/);
    // The lookup is still scoped by brokerage code.
    await http
      .get('/internal/clients')
      .query({ email: terminated.from, brokerCode: 'OTHER-000' })
      .set(service)
      .expect(404);
  });

  it('records steps, adds what the brokerage believes next to the insurer status', async () => {
    await http
      .post(`/internal/cases/${caseId}/steps`)
      .set(service)
      .send({
        agent: 'coverage',
        stepType: 'coverage.policy_checked',
        params: { policyNumber: 'C-48213', status: 'terminated' },
        sources: [{ kind: 'mcp_tool', ref: 'get_policy' }],
      })
      .expect(200, { status: 'recorded' });
    await http
      .post(`/internal/cases/${caseId}/steps`)
      .set(service)
      .send({ agent: 'coverage', stepType: 'not.a.step', params: {} })
      .expect(400);
    const view = await detail(caseId);
    expect(view.steps[0]?.params).toEqual({
      policyNumber: 'C-48213',
      status: 'terminated',
      knownStatus: 'active',
    });
    expect(view.auditLogs.at(-1)).toMatchObject({ actor: 'agent', action: 'agent_step' });
  });

  it("pushes the agents' tool calls live to the timeline", async () => {
    await http
      .post(`/internal/cases/${caseId}/agent-events`)
      .set(service)
      .send({
        agent: 'coverage',
        eventType: 'tool_call',
        params: { tool: 'get_policy', number: 'C-48213' },
      })
      .expect(200, { status: 'recorded' });
    await http
      .post(`/internal/cases/${caseId}/agent-events`)
      .set(service)
      .send({ agent: 'coverage', eventType: 'unknown', params: {} })
      .expect(400);
    const view = await detail(caseId);
    expect(view.agentEvents).toEqual([
      expect.objectContaining({
        agent: 'coverage',
        eventType: 'tool_call',
        params: { tool: 'get_policy', number: 'C-48213' },
      }),
    ]);
    expect(events.at(-1)).toMatchObject({ type: 'case.agent_event', caseId });
    // Live events are not business steps: no audit row.
    expect(view.auditLogs.at(-1)?.action).toBe('agent_step');
  });

  it('follows the running step and the last tool call live (V13)', async () => {
    const event = (body: object) =>
      http.post(`/internal/cases/${caseId}/agent-events`).set(service).send(body).expect(200);
    await event({ agent: 'coverage', eventType: 'step_started', params: { step: 'coverage' } });
    await event({
      agent: 'coverage',
      eventType: 'tool_call',
      params: { tool: 'read_clause', ref: 'CG-HZ-12.1' },
    });
    const [summary] = (await http.get('/cases').expect(200)).body;
    expect(summary).toMatchObject({
      stage: 'coverage',
      currentTool: 'read_clause CG-HZ-12.1',
      revision: 0,
    });
    const activity = (await http.get('/agents/activity').expect(200)).body;
    expect(activity.agents).toContainEqual(
      expect.objectContaining({
        agent: 'coverage',
        running: 1,
        current: { caseId, reference: 'CASE-0001', tool: 'read_clause CG-HZ-12.1' },
      }),
    );
    expect(activity.queued).toBe(0);
  });

  it('a proposed action puts the case on hold for the broker', async () => {
    await http
      .post(`/internal/cases/${caseId}/proposed-action`)
      .set(service)
      .send(proposal(1))
      .expect(200);
    // A retried callback does not duplicate the proposal.
    await http
      .post(`/internal/cases/${caseId}/proposed-action`)
      .set(service)
      .send(proposal(1))
      .expect(200);
    const view = await detail(caseId);
    expect(view.status).toBe('awaiting_approval');
    expect(view).toMatchObject({ stage: 'awaiting_approval', currentTool: null, revision: 1 });
    expect(view.verdict).toBe('not_covered');
    expect(view.proposedActions).toHaveLength(1);
    expect(events.map((event) => event.type)).toContain('case.action_proposed');
    expect((await http.get('/cases/stats').expect(200)).body.awaitingApproval).toBe(1);
  });

  it("serves the demo's single broker without any sign-in", async () => {
    const broker = (await http.get('/broker').expect(200)).body;
    expect(broker).toMatchObject({
      id: delormeBroker.id,
      name: 'Sophie Marchal',
      brokerage: { brokerCode: 'DLM-075' },
    });
    expect((await http.get('/cases').expect(200)).body).toHaveLength(1);
  });

  it('a rejection with a comment queues the resume with the comment', async () => {
    await http
      .post(`/cases/${caseId}/decision`)
      .send({ approved: false, comment: 'Ajoute le numéro de contrat.' })
      .expect(202);
    await http.post(`/cases/${caseId}/decision`).send({ approved: true }).expect(409);
    const rejected = (await detail(caseId)).proposedActions[0]!;
    const job = await app
      .get<Queue>(getQueueToken(RESUME_WORKFLOW_QUEUE))
      .getJob(`${caseId}-${rejected.id}`);
    expect(job?.data).toEqual({
      caseId,
      workflowRunId: 'run-1',
      decision: {
        approved: false,
        comment: 'Ajoute le numéro de contrat.',
        brokerId: delormeBroker.id,
      },
    });
    const view = await detail(caseId);
    expect(view.proposedActions[0]).toMatchObject({
      status: 'rejected',
      comment: 'Ajoute le numéro de contrat.',
      decidedBy: { id: delormeBroker.id, name: delormeBroker.name },
    });
    expect(view.auditLogs.at(-1)).toMatchObject({
      actor: 'broker',
      actorName: delormeBroker.name,
      action: 'action_rejected',
    });
  });

  it('the approved second proposal is executed and closes the case', async () => {
    await http
      .post(`/internal/cases/${caseId}/proposed-action`)
      .set(service)
      .send(proposal(2))
      .expect(200);
    await http.post(`/cases/${caseId}/decision`).send({ approved: true }).expect(202);
    const decided = await detail(caseId);
    expect(decided.auditLogs.at(-1)).toMatchObject({
      action: 'action_approved',
      actorName: delormeBroker.name,
      params: { revision: 2 },
    });
    await http
      .post(`/internal/cases/${caseId}/executed-action`)
      .set(service)
      .send({
        workflowRunId: 'run-1',
        result: {
          outcome: 'ready_to_send',
          approvedBy: delormeBroker.id,
          action: proposal(2).action,
        },
      })
      .expect(200);
    const view = await detail(caseId);
    expect(view.status).toBe('ready_to_send');
    expect(view.proposedActions.map((action) => action.status)).toEqual(['rejected', 'approved']);
    expect(view.auditLogs.map((log) => log.action)).toEqual([
      'email_received',
      'workflow_started',
      'agent_step',
      'action_proposed',
      'action_rejected',
      'action_proposed',
      'action_approved',
      'ready_to_send',
    ]);
    expect(events.map((event) => event.type)).toContain('case.closed');
  });

  it('records a workflow failure', async () => {
    const other = emails.find((e) => e.groundTruth.scenario === 'covered')!.email;
    const { body } = await receive(other).expect(202);
    await http
      .post(`/internal/cases/${body.caseId}/failed`)
      .set(service)
      .send({ workflowRunId: 'run-9', error: 'LLM unavailable' })
      .expect(200);
    const view = await detail(body.caseId);
    expect(view.status).toBe('failed');
    expect(view.failureReason).toBe('LLM unavailable');

    // The broker relaunches it: a new run is queued, the history is kept.
    await http.post(`/cases/${body.caseId}/retry`).expect(202);
    await http.post(`/cases/${body.caseId}/retry`).expect(409);
    const relaunched = await detail(body.caseId);
    expect(relaunched).toMatchObject({
      status: 'received',
      workflowRunId: null,
      failureReason: null,
    });
    expect(relaunched.auditLogs.at(-1)).toMatchObject({
      actor: 'broker',
      action: 'workflow_retried',
    });
  });

  it('the watchdog restarts a run that stopped progressing, then gives up', async () => {
    const stuck = emails.find((e) => e.groundTruth.scenario === 'deductible')!.email;
    const { body } = await receive(stuck).expect(202);
    const prisma = app.get(PrismaService);
    await prisma.case.update({
      where: { id: body.caseId },
      data: { status: 'processing', workflowRunId: 'run-stuck' },
    });
    const watchdog = app.get(WatchdogService);
    const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);
    // Still recent: nothing to do.
    expect((await watchdog.run(new Date())).restarted).toBe(0);
    for (let attempt = 1; attempt <= MAX_RESTARTS; attempt++) {
      expect((await watchdog.run(later(10 * attempt))).restarted).toBe(1);
    }
    expect(mastra.restarted.filter((id) => id === 'run-stuck')).toHaveLength(MAX_RESTARTS);
    expect((await watchdog.run(later(50))).failed).toBe(1);
    expect((await detail(body.caseId)).status).toBe('failed');
  });

  it('the watchdog requeues a case that never started, but not one still waiting in the queue', async () => {
    const waiting = emails.find((e) => e.groundTruth.scenario === 'late_declaration')!.email;
    const { body } = await receive(waiting).expect(202);
    const watchdog = app.get(WatchdogService);
    const later = new Date(Date.now() + 10 * 60_000);
    // Its process-email job is still waiting (no worker in tests): nothing to do.
    expect((await watchdog.run(later)).requeued).toBe(0);
    // The job is gone (exhausted attempts): the case is queued again.
    const queue = app.get<Queue>(getQueueToken(PROCESS_EMAIL_QUEUE));
    const kase = await app
      .get(PrismaService)
      .case.findUniqueOrThrow({ where: { id: body.caseId } });
    await (await queue.getJob(kase.emailId))?.remove();
    expect((await watchdog.run(later)).requeued).toBe(1);
  });

  it('two jobs for the same case start a single run', async () => {
    const twice = emails.find((e) => e.groundTruth.scenario === 'unreadable_field')!.email;
    const { body } = await receive(twice).expect(202);
    const processor = new ProcessEmailProcessor(
      app.get(PrismaService),
      mastra as never,
      app.get(AuditService),
      app.get(RealtimeService),
    );
    const before = mastra.started.length;
    await Promise.all([
      processor.process({ data: { caseId: body.caseId } } as never),
      processor.process({ data: { caseId: body.caseId } } as never),
    ]);
    expect(mastra.started.length - before).toBe(1);
  });

  it('exposes load metrics', async () => {
    const metrics = (await http.get('/cases/metrics').expect(200)).body;
    expect(metrics.total).toBeGreaterThanOrEqual(3);
    expect(metrics.byStatus.ready_to_send).toBe(1);
    expect(metrics.durationMs.p50).toBeGreaterThanOrEqual(0);
    expect(Object.keys(metrics.queues)).toEqual(['process-email', 'resume-workflow']);
    expect(metrics.restarts).toBeGreaterThanOrEqual(MAX_RESTARTS + 1);
  });

  it('forwards eval run options to the workflow (demo mode)', async () => {
    const other = emails.find((e) => e.groundTruth.scenario === 'exclusion')!.email;
    const runOptions = { models: { drafting: 'openai/gpt-5-nano' }, context: 'reduced' };
    const { body } = await receive({ ...other, runOptions } as never).expect(202);
    const processor = new ProcessEmailProcessor(
      app.get(PrismaService),
      mastra as never,
      app.get(AuditService),
      app.get(RealtimeService),
    );
    await processor.process({ data: { caseId: body.caseId } } as never);
    expect(mastra.started.at(-1)?.input.options).toEqual(runOptions);
    await receive({
      ...other,
      messageId: '<bad-options@x>',
      runOptions: { models: { triage: 'no' } },
    } as never).expect(400);
  });

  // --- V15: requests, replies, "À traiter par vous", follow-ups ---

  /** A new case from a copy of a generated e-mail. */
  const newCase = async (messageId: string): Promise<string> => {
    const response = await receive({ ...terminatedText, messageId }).expect(202);
    return response.body.caseId as string;
  };
  const replyJobs = async () =>
    (await app.get<Queue>(getQueueToken(PROCESS_EMAIL_QUEUE)).getJobs(['waiting', 'delayed']))
      .filter((job) => job.name === 'draft-reply')
      .map((job) => job.data as { caseId: string; kind: string });

  it('V15: a follow-up with In-Reply-To joins its case and queues a status reply', async () => {
    const response = await receive({
      ...terminatedText,
      messageId: '<follow-up-1@client>',
      subject: 'Re: Dégât des eaux dans le fournil',
      inReplyTo: terminated.messageId,
      attachments: [],
    }).expect(202);
    expect(response.body).toMatchObject({ caseId, created: false });
    const view = await detail(caseId);
    expect(view.followUps.map((email) => email.subject)).toEqual([
      'Re: Dégât des eaux dans le fournil',
    ]);
    expect(view.followUps).toHaveLength(1);
    expect(view.auditLogs.at(-1)?.action).toBe('follow_up_received');
    expect(await replyJobs()).toContainEqual(
      expect.objectContaining({ caseId, kind: 'send_status' }),
    );
    // The same follow-up received twice stays a single e-mail.
    await receive({
      ...terminatedText,
      messageId: '<follow-up-1@client>',
      inReplyTo: terminated.messageId,
      attachments: [],
    }).expect(202);
    expect((await detail(caseId)).followUps).toHaveLength(1);
  });

  it('V15: a standalone reply waits for no workflow and is ready once approved', async () => {
    const before = await detail(caseId);
    await http
      .post(`/internal/cases/${caseId}/proposed-action`)
      .set(service)
      .send({
        ...proposal(1, 'send_status'),
        workflowRunId: 'reply-run-1',
        verdict: null,
        alerts: [],
        awaitsWorkflow: false,
      })
      .expect(200);
    const pending = await detail(caseId);
    expect(pending.status).toBe(before.status);
    expect(pending).toMatchObject({ stage: 'awaiting_approval', pendingProposals: 1 });
    const reply = pending.proposedActions.find((action) => !action.awaitsWorkflow)!;
    await http
      .post(`/cases/${caseId}/decision`)
      .send({ approved: true, actionId: reply.id })
      .expect(202);
    const decided = await detail(caseId);
    expect(decided.status).toBe(before.status);
    expect(decided.proposedActions.find((action) => action.id === reply.id)).toMatchObject({
      status: 'approved',
      finalDraftBody: reply.draftBody,
    });
    expect(decided.auditLogs.at(-1)?.action).toBe('reply_ready');
  });

  it('V15: a hand-over leaves the case to the broker until marked as handled', async () => {
    const id = await newCase('<v15-handover@client>');
    await http
      .post(`/internal/cases/${id}/executed-action`)
      .set(service)
      .send({ workflowRunId: 'run-h', result: { outcome: 'handover', reason: 'quote_request' } })
      .expect(200);
    const view = await detail(id);
    expect(view).toMatchObject({
      status: 'needs_broker',
      stage: 'needs_broker',
      handover: { reason: 'quote_request' },
    });
    const stats = (await http.get('/cases/stats').expect(200)).body as { needsBroker: number };
    expect(stats.needsBroker).toBeGreaterThan(0);
    await http.post(`/cases/${id}/handled`).send({ comment: 'Devis envoyé.' }).expect(202);
    const handled = await detail(id);
    expect(handled.status).toBe('handled_manually');
    expect(handled.auditLogs.at(-1)).toMatchObject({
      action: 'case_handled_manually',
      params: { comment: 'Devis envoyé.' },
    });
    await http.post(`/cases/${id}/handled`).send({}).expect(409);
  });

  it("V15: an approved cancellation is recorded on the brokerage's policy", async () => {
    const id = await newCase('<v15-cancel@client>');
    const policyNumber = world.brokeragePolicies[0]!.number;
    const cancel = {
      ...proposal(1, 'cancel_policy'),
      workflowRunId: 'run-c',
      verdict: null,
      alerts: [],
    };
    cancel.action = {
      ...cancel.action,
      cancellation: { policyNumber, effectiveDate: '2027-06-30', reason: 'client_request' },
    } as typeof cancel.action;
    await http.post(`/internal/cases/${id}/proposed-action`).set(service).send(cancel).expect(200);
    await http
      .post(`/internal/cases/${id}/executed-action`)
      .set(service)
      .send({
        workflowRunId: 'run-c',
        result: {
          outcome: 'cancellation_filed',
          effectiveDate: '2027-06-30',
          action: cancel.action,
          approvedBy: delormeBroker.id,
          finalDraft: { subject: 'Résiliation', body: 'Effet le 30/06/2027.' },
        },
      })
      .expect(200);
    const view = await detail(id);
    expect(view.status).toBe('cancellation_filed');
    expect(view.proposedActions[0]).toMatchObject({ finalDraftBody: 'Effet le 30/06/2027.' });
    const policy = await app
      .get(PrismaService)
      .policy.findUniqueOrThrow({ where: { number: policyNumber } });
    expect(policy.cancellationEffectiveDate?.toISOString().slice(0, 10)).toBe('2027-06-30');
  });

  it("V15: find_client_cases lists the sender's cases; a merged follow-up joins its case", async () => {
    const found = await http
      .get('/internal/clients/cases')
      .query({ email: terminatedText.from })
      .set(service)
      .expect(200);
    expect((found.body as { caseId: string }[]).map((kase) => kase.caseId)).toContain(caseId);

    const id = await newCase('<v15-merge@client>');
    await http
      .post(`/internal/cases/${id}/executed-action`)
      .set(service)
      .send({ workflowRunId: 'run-m', result: { outcome: 'merged', targetCaseId: caseId } })
      .expect(200);
    const merged = await detail(id);
    expect(merged).toMatchObject({ status: 'merged', mergedInto: { id: caseId } });
    expect((await detail(caseId)).followUps).toHaveLength(2);
    expect(await replyJobs()).toContainEqual(
      expect.objectContaining({ caseId, kind: 'send_status' }),
    );
  });

  it('ignores callbacks for a case that no longer exists', async () => {
    await http
      .post('/internal/cases/00000000-0000-0000-0000-000000000000/steps')
      .set(service)
      .send({ agent: 'triage', stepType: 'triage.completed', params: {} })
      .expect(200, { status: 'ignored', reason: 'unknown case (reset?)' });
  });

  it('purges the snapshot and the trace of cases closed for longer than the retention delay', async () => {
    const purge = app.get(PurgeService);
    // Closed today: kept.
    expect((await purge.run(new Date())).cases).toBe(0);
    const later = new Date(Date.now() + 31 * 86_400_000);
    const result = await purge.run(later);
    expect(result.cases).toBe(1);
    expect(mastra.purged.at(-1)).toEqual({
      runIds: ['run-1'],
      traceIds: [caseId.replace(/-/g, '')],
    });
    const view = await detail(caseId);
    expect(view.auditLogs.at(-1)).toMatchObject({ actor: 'system', action: 'data_purged' });
    // The case and its audit trail stay; a second run has nothing left to purge.
    expect(view.status).toBe('ready_to_send');
    expect((await purge.run(later)).cases).toBe(0);
  });

  it('has no route that modifies the audit trail', async () => {
    for (const method of ['put', 'patch', 'delete'] as const) {
      await http[method](`/cases/${caseId}/audit`).expect(404);
    }
  });

  it('reset empties the tables, restarts numbering and tells the UI', async () => {
    await request(app.getHttpServer()).post('/admin/reset').expect(401);
    await http.post('/admin/reset').set(admin).expect(200);
    expect(events.at(-1)?.type).toBe('demo.reset');
    expect((await http.get('/cases').expect(200)).body).toEqual([]);
    await http.post('/admin/seed').set(admin).send(toCoreSeed(world)).expect(200);
    const { body } = await receive(terminated).expect(202);
    expect(body.reference).toBe('CASE-0001');
  });
});

describe('without DEMO_MODE', () => {
  it('has no /admin routes', async () => {
    const { app } = await createTestApp({ demoMode: false });
    await request(app.getHttpServer()).post('/admin/reset').set(admin).expect(404);
    await app.close();
  });
});
