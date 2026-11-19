import {
  AgentNameSchema,
  AlertTypeSchema,
  AuditActionSchema,
  CaseStatusSchema,
  StepTypeSchema,
  VerdictSchema,
} from '@demo/shared';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { createTranslator } from 'use-intl/core';
import { renderAgentEvent, renderAudit, renderStep, type Translate } from './render';

type Messages = { [key: string]: string | Messages };

const load = (locale: string): Messages =>
  JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), 'utf8'));

const fr = load('fr');
const en = load('en');

function keys(messages: Messages, prefix = ''): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : keys(value, `${prefix}${key}.`),
  );
}

const formatters = {
  money: (value: number) => `${value} €`,
  date: (value: string) => value,
};

describe('messages', () => {
  it('fr.json and en.json have exactly the same keys', () => {
    assert.deepEqual(keys(fr).sort(), keys(en).sort());
  });

  it('has a translation for every value the backend stores', () => {
    const all = new Set(keys(en));
    const expected = [
      ...StepTypeSchema.options.map((type) => `steps.${type}`),
      ...AuditActionSchema.options.map((action) => `audit.${action}`),
      ...CaseStatusSchema.options.map((status) => `status.${status}`),
      ...AlertTypeSchema.options.map((alert) => `alert.${alert}`),
      ...VerdictSchema.options.map((verdict) => `verdict.${verdict}`),
      ...AgentNameSchema.options.map((agent) => `agent.${agent}`),
    ];
    for (const key of expected) assert.ok(all.has(key), `missing message ${key}`);
  });
});

describe('renderStep', () => {
  const translators = {
    fr: createTranslator({ locale: 'fr', messages: fr }) as unknown as Translate,
    en: createTranslator({ locale: 'en', messages: en }) as unknown as Translate,
  };

  it('renders a stored step in the UI language', () => {
    const step = {
      stepType: 'coverage.policy_checked' as const,
      params: { policyNumber: 'C-48213', status: 'terminated', knownStatus: 'active' },
    };
    assert.equal(
      renderStep(step, translators.fr, formatters),
      "Contrat C-48213 consulté chez l'assureur : résilié",
    );
    assert.equal(
      renderStep(step, translators.en, formatters),
      'Policy C-48213 checked at the insurer: terminated',
    );
  });

  it('translates alerts, amounts and missing values', () => {
    const step = {
      stepType: 'coverage.verdict' as const,
      params: { verdict: 'covered', coverage: null, alerts: ['limit_exceeded'], limit: 3000 },
    };
    assert.equal(
      renderStep(step, translators.en, formatters),
      'Verdict: Covered (unknown), alerts: Limit exceeded',
    );
  });

  it('renders a live tool call in the UI language', () => {
    const event = {
      agent: 'coverage' as const,
      eventType: 'tool_call' as const,
      params: { tool: 'get_policy', number: 'C-48213' },
    };
    assert.equal(
      renderAgentEvent(event, translators.fr),
      "Agent Garanties consulte le contrat C-48213 chez l'assureur",
    );
    assert.equal(
      renderAgentEvent(event, translators.en),
      'Coverage agent checks policy C-48213 at the insurer',
    );
    assert.equal(
      renderAgentEvent({ ...event, params: { tool: 'mystery' } }, translators.en),
      'Coverage agent calls mystery',
    );
  });

  it('renders an agent_step audit row through the step message', () => {
    const log = {
      action: 'agent_step' as const,
      params: { stepType: 'drafting.proposed', actionType: 'notify_denial', revision: 2 },
    };
    assert.equal(
      renderAudit(log, translators.fr, formatters),
      'Étape : Proposition 2 : Notifier le refus',
    );
  });
});
