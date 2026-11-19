import type { CaseSummary, RealtimeEvent } from '@demo/shared';
import { generateEmails, generateWorld, toCoreSeed } from '@demo/world-generator';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ACT_AS_BROKER_HEADER } from '../src/auth/principal.js';
import { RealtimeController } from '../src/realtime/realtime.controller.js';
import { RealtimeService } from '../src/realtime/realtime.service.js';
import { createTestApp } from './app.js';
import { TEST_ADMIN_TOKEN, TEST_BROKER_PASSWORD, TEST_INBOUND_TOKEN } from './test-env.js';

/**
 * V10 isolation suite: a broker never sees nor changes another brokerage's case, through the API or
 * the realtime stream; internal and admin routes refuse calls without their token.
 */
const world = generateWorld({ seed: 42, locale: 'fr' });
const emails = generateEmails(world, { seed: 42, count: 12 });
const [delorme, vasseur] = world.brokerages as [
  (typeof world.brokerages)[0],
  (typeof world.brokerages)[0],
];
const brokerOf = (brokerageId: string) =>
  world.brokers.find((broker) => broker.brokerageId === brokerageId)!;
const emailFor = (brokerage: { inboxEmail: string }) =>
  emails.find((e) => e.email.to === brokerage.inboxEmail && e.groundTruth.requestType === 'claim')!
    .email;

const admin = { authorization: `Bearer ${TEST_ADMIN_TOKEN}` };
const inbound = { authorization: `Bearer ${TEST_INBOUND_TOKEN}` };

describe('isolation between brokerages', () => {
  let app: INestApplication;
  let delormeAgent: ReturnType<typeof request.agent>;
  let vasseurAgent: ReturnType<typeof request.agent>;
  let delormeCase: string;
  let vasseurCase: string;

  beforeAll(async () => {
    ({ app } = await createTestApp());
    const http = request(app.getHttpServer());
    await http.post('/admin/seed').set(admin).send(toCoreSeed(world)).expect(200);
    delormeCase = (await http.post('/emails').set(inbound).send(emailFor(delorme)).expect(202)).body
      .caseId;
    vasseurCase = (await http.post('/emails').set(inbound).send(emailFor(vasseur)).expect(202)).body
      .caseId;
    delormeAgent = request.agent(app.getHttpServer());
    vasseurAgent = request.agent(app.getHttpServer());
    await delormeAgent
      .post('/auth/login')
      .send({ email: brokerOf(delorme.id).email, password: TEST_BROKER_PASSWORD })
      .expect(200);
    await vasseurAgent
      .post('/auth/login')
      .send({ email: brokerOf(vasseur.id).email, password: TEST_BROKER_PASSWORD })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('refuses the API without a session, and a wrong password', async () => {
    const http = request(app.getHttpServer());
    await http.get('/cases').expect(401);
    await http.get(`/cases/${delormeCase}`).expect(401);
    await http.get('/realtime').expect(401);
    await http
      .post('/auth/login')
      .send({ email: brokerOf(delorme.id).email, password: 'wrong-password' })
      .expect(401);
  });

  it("a broker only lists and reads their brokerage's cases", async () => {
    const list = (await delormeAgent.get('/cases').expect(200)).body as CaseSummary[];
    expect(list.map((kase) => kase.id)).toEqual([delormeCase]);
    await delormeAgent.get(`/cases/${delormeCase}`).expect(200);
    // Another brokerage's case does not exist for them.
    await delormeAgent.get(`/cases/${vasseurCase}`).expect(404);
    await vasseurAgent.get(`/cases/${delormeCase}`).expect(404);
    expect((await delormeAgent.get('/cases/stats').expect(200)).body.total).toBe(1);
    const brokers = (await delormeAgent.get('/brokers').expect(200)).body as {
      brokerage: { id: string };
    }[];
    expect(brokers.every((broker) => broker.brokerage.id === delorme.id)).toBe(true);
  });

  it("a broker cannot decide on nor relaunch another brokerage's case, even naming a broker", async () => {
    await delormeAgent.post(`/cases/${vasseurCase}/decision`).send({ approved: true }).expect(403);
    await delormeAgent
      .post(`/cases/${vasseurCase}/decision`)
      .set(ACT_AS_BROKER_HEADER, brokerOf(vasseur.id).id)
      .send({ approved: true })
      .expect(403);
    await delormeAgent.post(`/cases/${vasseurCase}/retry`).expect(403);
  });

  it("the realtime stream only carries the broker's brokerage events", async () => {
    const realtime = app.get(RealtimeService);
    const controller = new RealtimeController(realtime);
    const received: RealtimeEvent[] = [];
    const subscription = controller
      .stream({ kind: 'broker', brokerId: brokerOf(delorme.id).id, brokerageId: delorme.id })
      .subscribe((message) => received.push(message.data as RealtimeEvent));
    realtime.publish('case.step', delormeCase, {}, delorme.id);
    realtime.publish('case.step', vasseurCase, {}, vasseur.id);
    realtime.publish('demo.reset', null);
    subscription.unsubscribe();
    expect(received.map((event) => [event.type, event.caseId])).toEqual([
      ['case.step', delormeCase],
      ['demo.reset', null],
    ]);
  });

  it('internal, admin and inbound routes refuse calls without their own token', async () => {
    // A broker session is not a service token.
    await delormeAgent.post(`/internal/cases/${delormeCase}/steps`).send({}).expect(401);
    await delormeAgent.get('/internal/clients?email=a@b.fr&brokerCode=DLM-075').expect(401);
    await delormeAgent.post('/admin/reset').expect(401);
    await delormeAgent.post('/emails').send(emailFor(delorme)).expect(401);
    // The admin token does not open the internal routes either.
    await request(app.getHttpServer())
      .post(`/internal/cases/${delormeCase}/steps`)
      .set(admin)
      .send({})
      .expect(401);
  });

  it('signs out', async () => {
    await vasseurAgent.post('/auth/logout').expect(200);
    await vasseurAgent.get('/cases').expect(401);
  });
});

describe('outside demo mode', () => {
  it('has no /admin routes and does not accept the admin token as an identity', async () => {
    process.env.DEMO_MODE = 'false';
    const { app } = await createTestApp({ demoMode: false });
    const http = request(app.getHttpServer());
    await http.post('/admin/reset').set(admin).expect(404);
    await http.post('/admin/seed').set(admin).send({}).expect(404);
    await http.get('/auth/demo-accounts').expect(404);
    // Without demo mode, the admin token is not an identity on the public API.
    await http.get('/cases').set(admin).expect(401);
    process.env.DEMO_MODE = 'true';
    await app.close();
  });
});
