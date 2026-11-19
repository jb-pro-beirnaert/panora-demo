import type { BrokerView, CaseDetail, CaseStats, CaseSummary, DecisionRequest } from '@demo/shared';
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
  brokers: () => request<BrokerView[]>(CORE_API_URL, '/brokers'),
  cases: () => request<CaseSummary[]>(CORE_API_URL, '/cases'),
  stats: () => request<CaseStats>(CORE_API_URL, '/cases/stats'),
  case: (id: string) => request<CaseDetail>(CORE_API_URL, `/cases/${id}`),
  decide: (id: string, brokerId: string, decision: DecisionRequest) =>
    request<{ status: string }>(CORE_API_URL, `/cases/${id}/decision`, {
      method: 'POST',
      headers: { 'x-broker-id': brokerId },
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
  speed: (emailsPerMinute: number) => post('/speed', { emailsPerMinute }),
  languageMix: (en: number) => post('/language-mix', { en }),
  autoValidation: (settings: Partial<SimulatorState['autoValidation']>) =>
    post('/auto-validation', settings),
};
