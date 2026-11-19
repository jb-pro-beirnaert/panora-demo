import { caseTracing } from './mastra-client.service.js';

describe('caseTracing', () => {
  it('derives one Langfuse trace and one session per case', () => {
    const tracing = caseTracing('649CC8E5-83c6-41e3-aa00-3928e11f2368', { brokerCode: 'DLM-075' });
    expect(tracing.traceId).toBe('649cc8e583c641e3aa003928e11f2368');
    expect(tracing.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(tracing.metadata).toEqual({
      sessionId: '649CC8E5-83c6-41e3-aa00-3928e11f2368',
      caseId: '649CC8E5-83c6-41e3-aa00-3928e11f2368',
      brokerCode: 'DLM-075',
    });
  });
});
