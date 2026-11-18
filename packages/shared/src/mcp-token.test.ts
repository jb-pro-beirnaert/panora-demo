import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { issueMcpToken, verifyMcpToken } from './mcp-token.js';

const secret = 'test-secret-with-enough-characters';

describe('MCP tokens', () => {
  it('round-trips the claims', () => {
    const token = issueMcpToken({ scope: 'read', brokerCode: 'DLM-075' }, secret);
    assert.deepEqual(verifyMcpToken(token, secret), { scope: 'read', brokerCode: 'DLM-075' });
  });

  it('rejects a token signed with another secret', () => {
    const token = issueMcpToken({ scope: 'write', brokerCode: 'DLM-075' }, 'another-secret-value');
    assert.equal(verifyMcpToken(token, secret), null);
  });

  it('rejects a token whose claims were tampered with', () => {
    const token = issueMcpToken({ scope: 'read', brokerCode: 'DLM-075' }, secret);
    const [prefix, , signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ scope: 'write', brokerCode: 'DLM-075' })).toString(
      'base64url',
    );
    assert.equal(verifyMcpToken(`${prefix}.${forged}.${signature}`, secret), null);
  });

  it('rejects malformed tokens', () => {
    for (const token of ['', 'mcp', 'mcp..', 'Bearer x', 'mcp.a.b.c']) {
      assert.equal(verifyMcpToken(token, secret), null);
    }
  });
});
