import { GroundTruthSchema, InboundEmailInputSchema } from '@demo/shared';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SCENARIO_ORDER, generateEmails } from './emails.js';
import { toExtranetSeed } from './extranet.js';
import { WORLD_SIZE, generateWorld } from './world.js';

const world = generateWorld({ seed: 42, locale: 'fr' });
const emails = generateEmails(world, { seed: 42, count: 60 });

describe('generateWorld', () => {
  it('is reproducible for a given seed', () => {
    assert.deepEqual(generateWorld({ seed: 42, locale: 'fr' }), world);
    assert.notDeepEqual(generateWorld({ seed: 7, locale: 'fr' }).clients, world.clients);
  });

  it('has the expected size', () => {
    assert.equal(world.brokerages.length, 2);
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
      const policy = world.policies.find(
        (candidate) => candidate.number === groundTruth.policyNumber,
      );
      assert.ok(policy, `policy ${groundTruth.policyNumber} exists`);
      assert.ok(world.clauses.some((clause) => clause.ref === groundTruth.clauseRef));
      assert.ok(email.receivedAt.slice(0, 10) <= world.referenceDate);
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
        default:
          assert.equal(policy.status, 'active');
          assert.equal(groundTruth.documentsMissing.length, 0);
      }
    }
  });
});
