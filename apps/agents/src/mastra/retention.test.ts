import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

if ((process.env.CORE_SERVICE_TOKEN ?? '').length < 16) {
  process.env.CORE_SERVICE_TOKEN = 'test-core-service-token';
}
process.env.AGENTS_DATABASE_URL ??= 'postgresql://x@localhost/agents';
process.env.MCP_TOKEN_SECRET ??= 'test-mcp-token-secret-0123456789-0123456789';
process.env.OPENAI_API_KEY ??= 'sk-test';

const { purge, PurgeRequestSchema, WORKFLOW_NAMES } = await import('./retention.js');

describe('retention purge', () => {
  it('deletes every snapshot of each run and the traces', async () => {
    const deleted: string[] = [];
    const store = {
      async deleteWorkflowRunById({
        runId,
        workflowName,
      }: {
        runId: string;
        workflowName: string;
      }) {
        if (workflowName === 'draft-and-approve' && runId === 'r2') throw new Error('not found');
        deleted.push(`${workflowName}:${runId}`);
      },
    };
    const traces: string[] = [];
    const result = await purge(
      store,
      { runIds: ['r1', 'r2'], traceIds: ['abc123'] },
      async (id) => {
        traces.push(id);
        return true;
      },
    );
    assert.deepEqual(result, { runs: 2, traces: 1 });
    assert.equal(deleted.length, WORKFLOW_NAMES.length * 2 - 1);
    assert.deepEqual(traces, ['abc123']);
  });

  it('only accepts trace ids that look like trace ids', () => {
    assert.ok(!PurgeRequestSchema.safeParse({ runIds: [], traceIds: ['../../etc'] }).success);
  });
});
