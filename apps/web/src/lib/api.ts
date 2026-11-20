import type {
  ClientDetail,
  ClientSummary,
  InsurerClauses,
  InsurerPolicySummary,
  InsurerPolicyView,
  AgentsActivity,
  BrokerView,
  CaseDetail,
  CaseMetrics,
  CaseStats,
  CaseSummary,
  DecisionRequest,
} from '@demo/shared';
import { CORE_API_URL, SIMULATOR_URL } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(base: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(new URL(path, base), {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
    cache: 'no-store',
  });
  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = (await response.json()) as { message?: string | string[]; error?: string };
      message = [body.message ?? body.error ?? message].flat().join(', ');
    } catch {
      // not JSON
    }
    throw new ApiError(response.status, message);
  }
  return (await response.json()) as T;
}

export const coreApi = {
  broker: () => request<BrokerView>(CORE_API_URL, '/broker'),
  agentsActivity: () => request<AgentsActivity>(CORE_API_URL, '/agents/activity'),
  cases: () => request<CaseSummary[]>(CORE_API_URL, '/cases'),
  stats: () => request<CaseStats>(CORE_API_URL, '/cases/stats'),
  metrics: () => request<CaseMetrics>(CORE_API_URL, '/cases/metrics'),
  retry: (id: string) =>
    request<{ status: string }>(CORE_API_URL, `/cases/${id}/retry`, { method: 'POST' }),
  case: (id: string) => request<CaseDetail>(CORE_API_URL, `/cases/${id}`),
  // V17: the insurer's extranet and the brokerage's clients (read-only).
  insurerPolicies: (q?: string) =>
    request<InsurerPolicySummary[]>(
      CORE_API_URL,
      `/insurer/policies${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    ),
  insurerPolicy: (number: string) =>
    request<InsurerPolicyView>(CORE_API_URL, `/insurer/policies/${encodeURIComponent(number)}`),
  conditions: (ref: string) =>
    request<InsurerClauses>(CORE_API_URL, `/insurer/clauses/${encodeURIComponent(ref)}`),
  clients: (q?: string) =>
    request<ClientSummary[]>(CORE_API_URL, `/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  client: (id: string) => request<ClientDetail>(CORE_API_URL, `/clients/${encodeURIComponent(id)}`),
  /** V15 "Marquer comme traité". */
  handled: (id: string, comment?: string) =>
    request<{ status: string }>(CORE_API_URL, `/cases/${id}/handled`, {
      method: 'POST',
      body: JSON.stringify(comment ? { comment } : {}),
    }),
  /** V15: analyse again with the documents of a follow-up. */
  reanalyze: (id: string) =>
    request<{ status: string }>(CORE_API_URL, `/cases/${id}/reanalyze`, { method: 'POST' }),
  decide: (id: string, decision: DecisionRequest) =>
    request<{ status: string }>(CORE_API_URL, `/cases/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify(decision),
    }),
};

/** The real file of an attachment (V14), served by Core. */
export function attachmentUrl(caseId: string, attachmentId: string): string {
  return new URL(`/cases/${caseId}/attachments/${attachmentId}/file`, CORE_API_URL).toString();
}

/** One e-mail of the demo script (V14). */
export interface ScriptItem {
  index: number;
  scenario: string;
  requestType: string;
  language: 'fr' | 'en';
  subject: string;
  sent: boolean;
}

export interface SimulatorState {
  status: 'ready' | 'running' | 'paused' | 'finished';
  sent: number;
  total: number;
  errors: number;
  intervalSeconds: number;
  next: ScriptItem | null;
  script: ScriptItem[];
  seeding: 'pending' | 'done';
}

const post = (path: string, body?: unknown) =>
  request<SimulatorState>(SIMULATOR_URL, path, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });

export const simulatorApi = {
  state: () => request<SimulatorState>(SIMULATOR_URL, '/state'),
  start: () => post('/start'),
  pause: () => post('/pause'),
  resume: () => post('/resume'),
  reset: () => post('/reset'),
  sendOne: () => post('/send-one'),
  speed: (intervalSeconds: number) => post('/speed', { intervalSeconds }),
};
