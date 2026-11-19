import { CaseSummarySchema } from '@demo/shared';
import { caseReference, toCaseSummary } from './case-views.js';

describe('caseReference', () => {
  it('pads the case number', () => {
    expect(caseReference(1)).toBe('CASE-0001');
    expect(caseReference(12345)).toBe('CASE-12345');
  });
});

describe('toCaseSummary', () => {
  it('maps a case row to a schema-valid summary', () => {
    const now = new Date('2026-11-18T10:00:00.000Z');
    const summary = toCaseSummary({
      id: 'c1',
      number: 3,
      brokerageId: 'brk-001',
      emailId: 'e1',
      clientId: null,
      policyNumber: null,
      status: 'awaiting_approval',
      workflowRunId: 'run-1',
      traceId: null,
      requestType: 'claim',
      verdict: 'not_covered',
      alerts: ['policy_terminated'],
      claimNumber: null,
      failureReason: null,
      createdAt: now,
      updatedAt: now,
      brokerage: {
        id: 'brk-001',
        name: 'Delorme Courtage',
        brokerCode: 'DLM-075',
        locale: 'fr',
        inboxEmail: 'sinistres@delorme-courtage.fr',
      },
      client: null,
      email: {
        id: 'e1',
        messageId: '<1@x>',
        from: 'contact@boulangerie-martin.fr',
        to: 'sinistres@delorme-courtage.fr',
        subject: 'Dégât des eaux dans le fournil',
        body: '…',
        receivedAt: now,
        language: 'fr',
      },
    });
    expect(CaseSummarySchema.parse(summary)).toEqual(summary);
    expect(summary.reference).toBe('CASE-0003');
    expect(summary.clientName).toBeNull();
  });
});
