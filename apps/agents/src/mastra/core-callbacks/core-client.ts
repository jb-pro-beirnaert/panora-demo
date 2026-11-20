import {
  ClientCaseSchema,
  ClientLookupResultSchema,
  type ClientCase,
  type AgentEventCallback,
  type AgentStepCallback,
  type ClientLookupResult,
  type ExecutedActionCallback,
  type ProposedActionCallback,
  type WorkflowFailedCallback,
} from '@demo/shared';
import { env } from '../env.js';

const TIMEOUT_MS = 5_000;
const ATTEMPTS = 3;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function headers(): Record<string, string> {
  return {
    'content-type': 'application/json',
    authorization: `Bearer ${env.CORE_SERVICE_TOKEN}`,
  };
}

/**
 * POSTs a callback to Core, with a few retries. Reporting never breaks the workflow: after the
 * last attempt the error is logged and swallowed (Core ignores callbacks for unknown cases).
 */
async function post(path: string, body: unknown): Promise<void> {
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(new URL(path, env.CORE_API_URL), {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.ok) return;
      // 4xx: the payload is wrong, retrying will not help.
      if (response.status < 500) {
        console.error(
          `core callback ${path} rejected (${response.status}): ${await response.text()}`,
        );
        return;
      }
    } catch (error) {
      if (attempt === ATTEMPTS) console.error(`core callback ${path} failed:`, error);
    }
    if (attempt < ATTEMPTS) await sleep(250 * 2 ** attempt);
  }
}

const casePath = (caseId: string, suffix: string) =>
  `/internal/cases/${encodeURIComponent(caseId)}/${suffix}`;

/** Every function is a no-op without a case id (workflow run by hand in Mastra Studio). */
export const core = {
  async step(caseId: string | null | undefined, step: AgentStepCallback): Promise<void> {
    if (caseId) await post(casePath(caseId, 'steps'), step);
  },
  async agentEvent(caseId: string | null | undefined, event: AgentEventCallback): Promise<void> {
    if (caseId) await post(casePath(caseId, 'agent-events'), event);
  },
  async proposedAction(
    caseId: string | null | undefined,
    payload: ProposedActionCallback,
  ): Promise<void> {
    if (caseId) await post(casePath(caseId, 'proposed-action'), payload);
  },
  async executedAction(
    caseId: string | null | undefined,
    payload: ExecutedActionCallback,
  ): Promise<void> {
    if (caseId) await post(casePath(caseId, 'executed-action'), payload);
  },
  async failed(caseId: string | null | undefined, payload: WorkflowFailedCallback): Promise<void> {
    if (caseId) await post(casePath(caseId, 'failed'), payload);
  },

  /** `find_client_cases` (V15): the brokerage's recent cases for a sender, newest first. */
  async findClientCases(email: string, excludeCaseId?: string): Promise<ClientCase[]> {
    const url = new URL('/internal/clients/cases', env.CORE_API_URL);
    url.searchParams.set('email', email);
    if (excludeCaseId) url.searchParams.set('excludeCaseId', excludeCaseId);
    const response = await fetch(url, {
      headers: headers(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Core case lookup failed (${response.status}): ${await response.text()}`);
    }
    return ClientCaseSchema.array().parse(await response.json());
  },

  /** `find_client`: null when the sender is not a client of the brokerage. */
  async findClient(email: string, brokerCode: string): Promise<ClientLookupResult | null> {
    const url = new URL('/internal/clients', env.CORE_API_URL);
    url.searchParams.set('email', email);
    url.searchParams.set('brokerCode', brokerCode);
    const response = await fetch(url, {
      headers: headers(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Core client lookup failed (${response.status}): ${await response.text()}`);
    }
    return ClientLookupResultSchema.parse(await response.json());
  },
};
