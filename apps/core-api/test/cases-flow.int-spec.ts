import type { CaseDetail, InboundEmailInput, RealtimeEvent } from '@demo/shared';
import { generateEmails, generateWorld, toCoreSeed } from '@demo/world-generator';
import { getQueueToken } from '@nestjs/bullmq';
import type { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { AuditService } from '../src/audit/audit.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { ProcessEmailProcessor } from '../src/queues/process-email.processor.js';
import { PROCESS_EMAIL_QUEUE, RESUME_WORKFLOW_QUEUE } from '../src/queues/queue-names.js';
import { RealtimeService } from '../src/realtime/realtime.service.js';
import { createTestApp, type FakeMastraClient } from './app.js';
import { TEST_ADMIN_TOKEN, TEST_SERVICE_TOKEN } from './test-env.js';

const world = generateWorld({ seed: 42, locale: 'fr' });
const emails = generateEmails(world, { seed: 42, count: 10 });
/** Scenario 2: the policy the brokerage believes active is terminated at the insurer. */
const terminated = emails.find((e) => e.groundTruth.scenario === 'policy_terminated')!.email;
const delorme = world.brokerages.find((b) => b.brokerCode === 'DLM-075')!;
const delormeBroker = world.brokers.find((b) => b.brokerageId === delorme.id)!;
const otherBroker = world.brokers.find((b) => b.brokerageId !== delorme.id)!;

const admin = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };
const service = { authorization: `Bearer ${TEST_SERVICE_TOKEN}` };

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
  let http: ReturnType<typeof request>;
  const events: RealtimeEvent[] = [];

  beforeAll(async () => {
    ({ app, mastra } = await createTestApp());
    http = request(app.getHttpServer());
    app
      .get(RealtimeService)
      .stream()
      .subscribe((event) => events.push(event));
    await http.post('/admin/seed').set(admin).send(toCoreSeed(world)).expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  const receive = (email: InboundEmailInput) => http.post('/emails').send(email);
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
    expect(view.auditLogs.map((log) => log.action)).toEqual(['email_received']);
  });

  it('creates a single case when the same e-mail arrives twice', async () => {
    const response = await receive(terminated).expect(202);
    expect(response.body).toEqual({ caseId, reference: 'CASE-0001', created: false });
  });

  it('rejects an e-mail sent to an unknown inbox and an invalid payload', async () => {
    await receive({ ...terminated, messageId: '<x@y>', to: 'nobody@nowhere.fr' }).expect(422);
    await http.post('/emails').send({ subject: 'no sender' }).expect(400);
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
    // Another brokerage does not see this client.
    await http
      .get('/internal/clients')
      .query({ email: terminated.from, brokerCode: 'VSR-069' })
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
    expect(view.verdict).toBe('not_covered');
    expect(view.proposedActions).toHaveLength(1);
    expect(events.map((event) => event.type)).toContain('case.action_proposed');
    expect((await http.get('/cases/stats').expect(200)).body.awaitingApproval).toBe(1);
  });

  it('checks who decides', async () => {
    await http.post(`/cases/${caseId}/decision`).send({ approved: true }).expect(401);
    await http
      .post(`/cases/${caseId}/decision`)
      .set('x-broker-id', otherBroker.id)
      .send({ approved: true })
      .expect(403);
  });

  it('a rejection with a comment queues the resume with the comment', async () => {
    await http
      .post(`/cases/${caseId}/decision`)
      .set('x-broker-id', delormeBroker.id)
      .send({ approved: false, comment: 'Ajoute le numéro de contrat.' })
      .expect(202);
    await http
      .post(`/cases/${caseId}/decision`)
      .set('x-broker-id', delormeBroker.id)
      .send({ approved: true })
      .expect(409);
    const job = await app.get<Queue>(getQueueToken(RESUME_WORKFLOW_QUEUE)).getJob(`${caseId}-r1`);
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
    await http
      .post(`/cases/${caseId}/decision`)
      .set('x-broker-id', delormeBroker.id)
      .send({ approved: true })
      .expect(202);
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
  });

  it('ignores callbacks for a case that no longer exists', async () => {
    await http
      .post('/internal/cases/00000000-0000-0000-0000-000000000000/steps')
      .set(service)
      .send({ agent: 'triage', stepType: 'triage.completed', params: {} })
      .expect(200, { status: 'ignored', reason: 'unknown case (reset?)' });
  });

  it('has no route that modifies the audit trail', async () => {
    for (const method of ['put', 'patch', 'delete'] as const) {
      await http[method](`/cases/${caseId}/audit`).expect(404);
    }
  });

  it('reset empties the tables, restarts numbering and tells the UI', async () => {
    await http.post('/admin/reset').expect(401);
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
