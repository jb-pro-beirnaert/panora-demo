import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

// models.ts reads the env lazily through its defaults: provide what env.ts requires.
process.env.AGENTS_DATABASE_URL ??= 'postgresql://x@localhost/agents';
if ((process.env.CORE_SERVICE_TOKEN ?? '').length < 16) {
  process.env.CORE_SERVICE_TOKEN = 'test-core-service-token';
}
process.env.MCP_TOKEN_SECRET ??= 'test-mcp-token-secret-0123456789-0123456789';
process.env.OPENAI_API_KEY ??= 'sk-test';

const { modelEntries, modelSpecOf, resolveModel } = await import('./models.js');
const { RequestContext } = await import('@mastra/core/request-context');
const { renderEmail } = await import('./workflows/process-email.js');

describe('per-request models (eval matrix)', () => {
  it('uses the override from the request context, else the env default', () => {
    const context = new RequestContext<unknown>(
      modelEntries({ models: { drafting: 'openai/gpt-5-nano' } }),
    );
    assert.equal(modelSpecOf('drafting', context), 'openai/gpt-5-nano');
    assert.equal(modelSpecOf('triage', context), process.env.TRIAGE_MODEL ?? 'openai/gpt-5-nano');
  });

  it('serves ollama/<model> through the OpenAI-compatible API of Ollama', () => {
    assert.deepEqual(resolveModel('ollama/qwen3:4b'), {
      providerId: 'ollama',
      modelId: 'qwen3:4b',
      url: 'http://localhost:11434/v1',
      apiKey: 'ollama',
    });
    assert.equal(resolveModel('openai/gpt-6-luna'), 'openai/gpt-6-luna');
  });
});

describe('reduced context', () => {
  const email = {
    messageId: '<1@x>',
    from: 'a@b.fr',
    to: 'c@d.fr',
    subject: 'Dégât des eaux',
    body: 'Bonjour',
    receivedAt: '2026-11-17T09:00:00.000Z',
    attachments: [
      {
        fileName: 'constat.pdf',
        contentType: 'application/pdf',
        extractedText: 'Ligne 1\n\n\nLigne 2',
      },
      { fileName: 'photos.jpg', contentType: 'image/jpeg', extractedText: '[Photo] dégâts' },
    ],
  };

  it('drops photos and blank lines only when asked', () => {
    const full = renderEmail(email);
    const reduced = renderEmail(email, { context: 'reduced' });
    assert.match(full, /photos\.jpg/);
    assert.doesNotMatch(reduced, /photos\.jpg/);
    assert.match(reduced, /Ligne 1\nLigne 2/);
    assert.ok(reduced.length < full.length);
  });
});
