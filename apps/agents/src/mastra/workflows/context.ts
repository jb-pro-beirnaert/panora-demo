import { RequestContext } from '@mastra/core/request-context';
import { BROKER_CODE_KEY, CASE_ID_KEY } from '../mcp/extranet-client.js';

/** Request context of an agent call: the brokerage (MCP token scope) and the Core case. */
export function caseContext(brokerCode: string, caseId: string | null): RequestContext {
  const entries: [string, unknown][] = [[BROKER_CODE_KEY, brokerCode]];
  if (caseId) entries.push([CASE_ID_KEY, caseId]);
  return new RequestContext(entries);
}
