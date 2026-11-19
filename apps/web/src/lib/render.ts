import type { AgentEventView, AgentStepView, AuditLogView, StepParams } from '@demo/shared';

/**
 * Turns stored `type + params` into a sentence in the UI language. Enum values are translated
 * through their own namespace, amounts and dates are formatted for the locale.
 */

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export interface Formatters {
  money: (value: number) => string;
  date: (value: string) => string;
}

const ENUM_NAMESPACES: Record<string, string> = {
  verdict: 'verdict',
  status: 'policyStatus',
  knownStatus: 'policyStatus',
  requestType: 'requestType',
  actionType: 'actionType',
  nature: 'peril',
};

const MONEY_KEYS = new Set(['amount', 'limit', 'deductible', 'claimedAmount', 'estimatedPayout']);
const DATE_KEYS = new Set(['incidentDate', 'date']);

export function formatParams(
  params: StepParams | Record<string, unknown>,
  t: Translate,
  format: Formatters,
): Record<string, string | number> {
  const values: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      values[key] = t('common.unknown');
    } else if (Array.isArray(value)) {
      const items = value.map((item) =>
        key === 'alerts' ? t(`alert.${String(item)}`) : String(item),
      );
      values[key] = items.length > 0 ? items.join(', ') : t('common.none');
    } else if (typeof value === 'string' && ENUM_NAMESPACES[key]) {
      values[key] = t(`${ENUM_NAMESPACES[key]}.${value}`);
    } else if (typeof value === 'number' && MONEY_KEYS.has(key)) {
      values[key] = format.money(value);
    } else if (typeof value === 'string' && DATE_KEYS.has(key)) {
      values[key] = format.date(value);
    } else if (typeof value === 'number') {
      values[key] = value;
    } else {
      values[key] = String(value);
    }
  }
  return values;
}

export function renderStep(
  step: Pick<AgentStepView, 'stepType' | 'params'>,
  t: Translate,
  format: Formatters,
): string {
  return t(`steps.${step.stepType}`, formatParams(step.params, t, format));
}

export function renderAudit(
  log: Pick<AuditLogView, 'action' | 'params'>,
  t: Translate,
  format: Formatters,
): string {
  if (log.action === 'agent_step' && typeof log.params.stepType === 'string') {
    const { stepType, ...params } = log.params;
    const step = renderStep(
      { stepType: stepType as AgentStepView['stepType'], params: params as StepParams },
      t,
      format,
    );
    return t('audit.agent_step', { step });
  }
  return t(`audit.${log.action}`, formatParams(log.params, t, format));
}

const KNOWN_TOOLS = new Set([
  'get_policy',
  'search_policy',
  'list_coverages',
  'read_clause',
  'get_claim_history',
  'find_client',
]);

/** "Coverage agent checks policy C-48213 at the insurer", in the UI language. */
export function renderAgentEvent(
  event: Pick<AgentEventView, 'agent' | 'eventType' | 'params'>,
  t: Translate,
): string {
  const { tool = 'unknown', ...args } = event.params;
  const values: Record<string, string> = {
    agent: t(`agent.${event.agent}`),
    tool,
    number: args.number ?? args.policyNumber ?? '—',
    policyNumber: args.policyNumber ?? args.number ?? '—',
    query: args.holderName ?? args.number ?? '—',
    ref: args.ref ?? '—',
    email: args.email ?? '—',
  };
  return t(`events.tool.${KNOWN_TOOLS.has(tool) ? tool : 'other'}`, values);
}
