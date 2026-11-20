import { detectLanguage, GroundTruthSchema, InboundEmailInputSchema } from '@demo/shared';
import assert from 'node:assert/strict';
import { describe, it, test } from 'node:test';
import { DEMO_SCRIPT, SCENARIO_ORDER, generateDemoScript, generateEmails } from './emails.js';
import { toCoreSeed } from './core.js';
import { toExtranetSeed } from './extranet.js';
import { SHOWCASE, WORLD_SIZE, generateWorld } from './world.js';

const world = generateWorld({ seed: 42, locale: 'fr' });
const emails = generateEmails(world, { seed: 42, count: 60 });

describe('generateWorld', () => {
  it('is reproducible for a given seed', () => {
    assert.deepEqual(generateWorld({ seed: 42, locale: 'fr' }), world);
    assert.notDeepEqual(generateWorld({ seed: 7, locale: 'fr' }).clients, world.clients);
  });

  it('has the expected size', () => {
    assert.equal(world.brokerages.length, 1);
    assert.equal(world.brokers.length, 1);
    assert.equal(world.insurers.length, 3);
    assert.equal(world.clients.length, WORLD_SIZE.clients);
    assert.equal(world.policies.length, WORLD_SIZE.policies);
  });

  it('contains the showcase terminated policy the brokerage believes active', () => {
    const atInsurer = world.policies.find((policy) => policy.number === 'C-48213');
    const atBrokerage = world.brokeragePolicies.find((policy) => policy.number === 'C-48213');
    assert.equal(atInsurer?.status, 'terminated');
    assert.equal(atInsurer?.endReason, 'non_payment');
    assert.equal(atBrokerage?.knownStatus, 'active');
  });

  it('produces a valid extranet seed whose coverage clauses all exist', () => {
    const seed = toExtranetSeed(world);
    const refs = new Set(seed.clauses.map((clause) => clause.ref));
    for (const policy of seed.policies) {
      for (const coverage of policy.coverages) assert.ok(refs.has(coverage.clauseRef));
    }
    assert.equal(new Set(seed.policies.map((policy) => policy.number)).size, seed.policies.length);
  });
});

describe('toCoreSeed', () => {
  it('produces a valid Core seed whose references all resolve', () => {
    const seed = toCoreSeed(world);
    const brokerageIds = new Set(seed.brokerages.map((brokerage) => brokerage.id));
    const clientIds = new Set(seed.clients.map((client) => client.id));
    assert.ok(seed.brokers.every((broker) => brokerageIds.has(broker.brokerageId)));
    assert.ok(seed.clients.every((client) => brokerageIds.has(client.brokerageId)));
    assert.ok(seed.policies.every((policy) => clientIds.has(policy.clientId)));
    assert.equal(seed.policies.length, world.brokeragePolicies.length);
  });
});

describe('generateEmails', () => {
  it('is reproducible for a given seed', () => {
    assert.deepEqual(generateEmails(world, { seed: 42, count: 60 }), emails);
  });

  it('covers every scenario within the first e-mails', () => {
    const first = emails.slice(0, SCENARIO_ORDER.length).map((email) => email.groundTruth.scenario);
    assert.deepEqual(first, SCENARIO_ORDER);
  });

  it('produces schema-valid e-mails and ground truth consistent with the world', () => {
    for (const { email, groundTruth } of emails) {
      InboundEmailInputSchema.parse(email);
      GroundTruthSchema.parse(groundTruth);
      assert.ok(email.receivedAt.slice(0, 10) <= world.referenceDate);
      const brokerage = world.brokerages.find((b) => b.brokerCode === groundTruth.brokerCode);
      assert.equal(email.to, brokerage?.inboxEmail);

      if (groundTruth.requestType !== 'claim') {
        // V15 requests: the policy they are about is written in the e-mail.
        if (groundTruth.policyNumber) {
          assert.ok(email.body.includes(groundTruth.policyNumber));
          assert.ok(world.policies.some((p) => p.number === groundTruth.policyNumber));
        }
        assert.equal(
          groundTruth.expectedAction === null,
          groundTruth.expectedOutcome === 'classified',
        );
        assert.equal(
          groundTruth.handoverReason !== null,
          groundTruth.expectedOutcome === 'needs_broker',
        );
        if (groundTruth.requestType === 'cancellation') {
          const policy = world.policies.find((p) => p.number === groundTruth.policyNumber)!;
          if (groundTruth.scenario === 'cancellation_already_terminated') {
            assert.equal(policy.status, 'terminated');
          } else if (groundTruth.scenario === 'cancellation_already_requested') {
            assert.equal(policy.endReason, 'client_request');
            assert.equal(groundTruth.effectiveDate, policy.endDate);
          } else {
            assert.ok(groundTruth.effectiveDate! >= policy.renewalDate);
          }
        }
        continue;
      }

      if (groundTruth.scenario === 'unknown_client') {
        assert.ok(!world.clients.some((client) => client.email === email.from));
        assert.ok(!world.policies.some((policy) => policy.holderName === groundTruth.holderName));
        continue;
      }

      const policy = world.policies.find(
        (candidate) => candidate.number === groundTruth.policyNumber,
      );
      assert.ok(policy, `policy ${groundTruth.policyNumber} exists`);
      assert.ok(world.clauses.some((clause) => clause.ref === groundTruth.clauseRef));
      assert.ok(groundTruth.incidentDate <= email.receivedAt.slice(0, 10));
      const text = [email.body, ...email.attachments.map((a) => a.extractedText)].join('\n');
      assert.equal(text.includes(groundTruth.policyNumber), groundTruth.policyNumberInEmail);

      switch (groundTruth.scenario) {
        case 'policy_terminated':
          assert.equal(policy.status, 'terminated');
          assert.ok((policy.endDate ?? '') < groundTruth.incidentDate);
          break;
        case 'limit_exceeded':
          assert.ok((groundTruth.amount ?? 0) > groundTruth.limit);
          break;
        case 'missing_document':
          assert.equal(email.attachments.length, 0);
          assert.ok(groundTruth.documentsMissing.length > 0);
          break;
        case 'duplicate_claim':
          assert.ok(
            world.claims.some(
              (claim) =>
                claim.policyNumber === policy.number &&
                claim.date === groundTruth.incidentDate &&
                claim.amount === groundTruth.amount,
            ),
          );
          break;
        case 'unreadable_field':
          assert.ok(groundTruth.amount === null || !groundTruth.incidentDateReadable);
          break;
        case 'partial_documents':
          assert.equal(email.attachments.length, 1);
          assert.ok(groundTruth.documentsMissing.length > 0);
          break;
        default:
          assert.equal(policy.status, 'active');
          assert.equal(groundTruth.documentsMissing.length, 0);
      }
    }
  });
});

describe('multilingual world (V4)', () => {
  const multi = generateWorld({ seed: 42, locales: ['fr', 'en'], mix: { en: 0.3 } });
  const multiEmails = generateEmails(multi, { seed: 42, count: 80 });

  it('keeps the French world identical and appends the English part', () => {
    const french = generateWorld({ seed: 42, locale: 'fr' });
    assert.deepEqual(multi.clients.slice(0, french.clients.length), french.clients);
    assert.deepEqual(multi.policies.slice(0, french.policies.length), french.policies);
    assert.deepEqual(
      multi.brokerages.map((brokerage) => brokerage.locale),
      ['fr'],
    );
    assert.equal(multi.brokers.length, 1);
    assert.ok(multi.insurers.some((insurer) => insurer.locale === 'en'));
    assert.ok(multi.clients.some((client) => client.language === 'en'));
  });

  it("writes the English insurer's clauses in English", () => {
    const clause = multi.clauses.find((candidate) => candidate.ref === 'CG-NB-12.1');
    assert.match(clause?.text ?? '', /No cover is provided/);
    const policy = multi.policies.find((candidate) => candidate.insurerId === 'ins-northbridge');
    assert.equal(policy?.product, 'Commercial multi-risk');
  });

  it('contains the scenario 13 showcase: English e-mail, French clauses, French brokerage', () => {
    const showcase = multiEmails.find(
      (email) => email.email.from === 'facilities@brightwave-solutions.com',
    );
    assert.ok(showcase);
    assert.equal(showcase.email.subject, 'Water damage in our Lyon office');
    assert.equal(showcase.groundTruth.emailLanguage, 'en');
    assert.equal(showcase.groundTruth.expectedDraftLanguage, 'en');
    assert.equal(showcase.groundTruth.expectedNoteLanguage, 'fr');
    if (showcase.groundTruth.scenario !== 'covered') assert.fail('expected a covered claim');
    assert.equal(showcase.groundTruth.deductible, 300);
    assert.deepEqual(showcase.groundTruth.documentsMissing, []);
  });

  it('mixes French and English e-mails whose text matches their declared language', () => {
    const english = multiEmails.filter((email) => email.groundTruth.emailLanguage === 'en');
    assert.ok(english.length >= 10, `${english.length} English e-mails`);
    assert.ok(english.length < multiEmails.length / 2);
    for (const { email, groundTruth } of multiEmails) {
      GroundTruthSchema.parse(groundTruth);
      // A covered claim always comes with every required document.
      if (groundTruth.scenario === 'covered') assert.deepEqual(groundTruth.documentsMissing, []);
      assert.equal(
        detectLanguage(`${email.subject}\n${email.body}`),
        groundTruth.emailLanguage,
        email.subject,
      );
    }
  });

  it('has mixed cases: English e-mails on French clauses and French e-mails on English clauses', () => {
    const insurerLocale = (policyNumber: string | null) => {
      const policy = multi.policies.find((candidate) => candidate.number === policyNumber);
      return multi.insurers.find((insurer) => insurer.id === policy?.insurerId)?.locale;
    };
    const claims = multiEmails.filter((email) => email.groundTruth.requestType === 'claim');
    assert.ok(
      claims.some(
        (e) =>
          e.groundTruth.emailLanguage === 'en' &&
          insurerLocale(e.groundTruth.policyNumber) === 'fr',
      ),
    );
    assert.ok(
      claims.some(
        (e) =>
          e.groundTruth.emailLanguage === 'en' &&
          insurerLocale(e.groundTruth.policyNumber) === 'en',
      ),
    );
  });
});

test('the demo script covers every scenario once, in order, reproducibly (V14, V15)', () => {
  const world = generateWorld({ seed: 42, locales: ['fr', 'en'], mix: { en: 0.25 } });
  const script = generateDemoScript(world, 42);
  assert.equal(script.length, DEMO_SCRIPT.length);
  assert.deepEqual(
    script.map(({ groundTruth }) => groundTruth.scenario),
    DEMO_SCRIPT.map((entry) => (entry.crossLanguage ? 'covered' : entry.scenario)),
  );
  assert.deepEqual(
    script.map(({ groundTruth }) => groundTruth.emailLanguage),
    DEMO_SCRIPT.map((entry) => entry.language),
  );
  assert.equal(script[1]!.groundTruth.policyNumber, SHOWCASE.terminatedPolicy);
  assert.equal(new Set(script.map(({ email }) => email.messageId)).size, script.length);
  // Follow-ups and the resent claim refer to the right e-mails.
  const byScenario = (scenario: string) =>
    script.find(({ groundTruth }) => groundTruth.scenario === scenario)!;
  assert.equal(byScenario('follow_up').email.inReplyTo, script[3]!.email.messageId);
  assert.equal(byScenario('follow_up_no_header').email.inReplyTo, undefined);
  assert.equal(byScenario('follow_up_no_header').email.from, script[0]!.email.from);
  assert.equal(byScenario('resent_claim').email.from, script[7]!.email.from);
  // V18: the booby-trapped invoice hides an instruction, readable in the text but also printed in red under the totals.
  const trap = byScenario('prompt_injection');
  const invoice = trap.email.attachments.find((a) => a.document?.kind === 'invoice')!;
  assert.ok(invoice.document && 'hiddenText' in invoice.document && invoice.document.hiddenText);
  assert.ok(invoice.extractedText.includes(invoice.document.hiddenText));
  assert.deepEqual(trap.groundTruth.alerts, ['prompt_injection']);
  for (const { email, groundTruth } of script) {
    InboundEmailInputSchema.parse(email);
    GroundTruthSchema.parse(groundTruth);
  }
  assert.deepEqual(generateDemoScript(world, 42), script);
});
