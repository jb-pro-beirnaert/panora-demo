import type {
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
  decide: (id: string, decision: DecisionRequest) =>
    request<{ status: string }>(CORE_API_URL, `/cases/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify(decision),
    }),
};

export interface SimulatorState {
  status: 'ready' | 'running' | 'paused';
  emailsPerMinute: number;
  sent: number;
  errors: number;
  poolSize: number;
  englishShare: number;
  seeding: 'pending' | 'done';
  autoValidation: { enabled: boolean; delayMs: number; rejectionRate: number };
  burst: { requested: number; sent: number; finishedAt: string | null; startedAt: string | null };
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
  sendShowcase: () => post('/send-showcase'),
  speed: (emailsPerMinute: number) => post('/speed', { emailsPerMinute }),
  languageMix: (en: number) => post('/language-mix', { en }),
  burst: (count: number) => post('/burst', { count }),
  autoValidation: (settings: Partial<SimulatorState['autoValidation']>) =>
    post('/auto-validation', settings),
};
