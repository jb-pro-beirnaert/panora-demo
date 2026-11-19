import {
  detectLanguage,
  missingDocuments,
  type CoverageVerdict,
  type Draft,
  type DocumentType,
  type InboundEmailInput,
  type Peril,
  type TriageResult,
} from '@demo/shared';
import type { RequestContext } from '@mastra/core/request-context';
import { extranetTools } from '../mcp/extranet-client.js';
import type { TriagedEmail } from '../workflows/schemas.js';

/**
 * Deterministic stand-ins for the three agents (AGENTS_MODE=simulated, load tests only). They run
 * in the real workflow and call the real extranet through MCP (with its retries and the chaos
 * mode), so a 1,000-case burst exercises queues, workflows, suspension, resume and restarts without
 * any LLM cost. Their answers are plausible, not graded.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const PERIL_WORDS: [Peril, RegExp][] = [
  ['fire', /incendie|feu|fire/i],
  ['theft', /vol\b|volé|effraction|theft|stolen|burglar/i],
  ['glass_breakage', /bris de glace|pare-brise|vitr|glass|windscreen|window/i],
  ['vehicle_damage', /accident|collision|percuté|véhicule|vehicle/i],
  ['water_damage', /eau|fuite|inond|water|leak|pipe/i],
];

function field<T>(value: T | null, document = 'email_body') {
  return {
    value,
    source: value === null ? null : { document, page: null },
    confidence: 'medium' as const,
  };
}

function documentType(fileName: string): DocumentType {
  if (/constat|incident/i.test(fileName)) return 'incident_report';
  if (/facture|invoice/i.test(fileName)) return 'invoice';
  if (/devis|quote/i.test(fileName)) return 'quote';
  if (/plainte|police/i.test(fileName)) return 'police_report';
  if (/pompiers|fire/i.test(fileName)) return 'fire_report';
  if (/photo|\.jpg/i.test(fileName)) return 'photos';
  return 'other';
}

/** "Total TTC : 1 450,00 €" / "Total incl. VAT: EUR 1,450.00". */
function amountIn(text: string): number | null {
  const match =
    /Total (?:TTC|incl\. VAT)\s*:\s*(?:EUR\s*)?([\d\s.,]+?)(?:\s*€|\n|$)/i.exec(text) ??
    /\(([\d\s.,]+)\s*(?:€|EUR)\)/.exec(text);
  if (!match?.[1]) return null;
  const raw = match[1].trim();
  const decimal = /[.,](\d{2})$/.exec(raw);
  const units = (decimal ? raw.slice(0, -3) : raw).replace(/[^\d]/g, '');
  return units ? Number(units) : null;
}

export async function simulateTriage(
  email: InboundEmailInput,
  receivedDate: string,
  latencyMs: number,
): Promise<TriageResult> {
  await sleep(latencyMs);
  const text = [email.subject, email.body, ...email.attachments.map((a) => a.extractedText)].join(
    '\n',
  );
  const head = `${email.subject}\n${email.body}`;
  const requestType = /résili|cancel/i.test(head)
    ? 'cancellation'
    : /devis|quote/i.test(head) && !/sinistre|claim|dégât|damage/i.test(head)
      ? 'quote_request'
      : 'claim';
  const nature = PERIL_WORDS.find(([, pattern]) => pattern.test(head))?.[0] ?? null;
  const documentsPresent = email.attachments.map((attachment) => ({
    type: documentType(attachment.fileName),
    fileName: attachment.fileName,
  }));
  const incident = new Date(`${receivedDate}T00:00:00Z`);
  incident.setUTCDate(incident.getUTCDate() - 1);
  return {
    requestType,
    emailLanguage: detectLanguage(head),
    holderName: field(null),
    policyNumber: field(/\b[CF]-\d{5}\b/.exec(text)?.[0] ?? null),
    incidentDate: field(requestType === 'claim' ? incident.toISOString().slice(0, 10) : null),
    nature: field(requestType === 'claim' ? nature : null),
    location: field(null),
    amount: field(amountIn(text)),
    documentsPresent,
    documentsMissing:
      requestType === 'claim' && nature
        ? missingDocuments(
            nature,
            documentsPresent.map((document) => document.type),
          )
        : [],
  };
}

/** Parses the JSON an MCP tool returns (structured content, or JSON in a text part). */
function toolJson(result: unknown): Record<string, unknown> | null {
  const value = result as {
    structuredContent?: Record<string, unknown>;
    content?: { type: string; text?: string }[];
  } | null;
  if (value?.structuredContent) return value.structuredContent;
  for (const part of value?.content ?? []) {
    try {
      if (part.text) return JSON.parse(part.text) as Record<string, unknown>;
    } catch {
      // not JSON
    }
  }
  return typeof result === 'object' ? (result as Record<string, unknown>) : null;
}

export async function simulateCoverage(
  claim: TriagedEmail,
  requestContext: RequestContext,
  latencyMs: number,
): Promise<CoverageVerdict> {
  await sleep(latencyMs);
  const policyNumber = claim.triage.policyNumber.value ?? claim.client?.policies[0]?.number ?? null;
  const base: CoverageVerdict = {
    verdict: 'uncertain',
    policyNumber,
    policyStatus: null,
    coverage: null,
    limit: null,
    deductible: null,
    claimedAmount: claim.triage.amount.value,
    estimatedPayout: null,
    citations: [],
    alerts: claim.client ? [] : ['unknown_client'],
    reasoning: 'Simulated agent (load test).',
  };
  if (!policyNumber) return base;
  const tools = await extranetTools('read', claim.brokerage.brokerCode);
  const options = { requestContext } as never;
  const policy = toolJson(await tools.get_policy?.execute?.({ number: policyNumber }, options));
  const coverages = toolJson(await tools.list_coverages?.execute?.({ policyNumber }, options)) as {
    coverages?: {
      peril: Peril;
      label: string;
      limit: number;
      deductible: number;
      clauseRef: string;
    }[];
  } | null;
  const status = (policy?.status as CoverageVerdict['policyStatus']) ?? null;
  const coverage = coverages?.coverages?.find(
    (candidate) => candidate.peril === claim.triage.nature.value,
  );
  const amount = claim.triage.amount.value;
  if (status === 'terminated') {
    return { ...base, verdict: 'not_covered', policyStatus: status, alerts: ['policy_terminated'] };
  }
  if (!coverage || amount === null || claim.triage.documentsMissing.length > 0) {
    return {
      ...base,
      policyStatus: status,
      alerts: claim.triage.documentsMissing.length ? ['missing_document'] : [],
    };
  }
  return {
    ...base,
    verdict: 'covered',
    policyStatus: status,
    coverage: { label: coverage.label, peril: coverage.peril, clauseRef: coverage.clauseRef },
    limit: coverage.limit,
    deductible: coverage.deductible,
    estimatedPayout: Math.max(0, Math.min(amount, coverage.limit) - coverage.deductible),
    alerts: amount > coverage.limit ? ['limit_exceeded'] : [],
  };
}

export async function simulateDraft(
  verdict: CoverageVerdict,
  emailLanguage: 'fr' | 'en',
  noteLanguage: 'fr' | 'en',
  latencyMs: number,
): Promise<Draft> {
  await sleep(latencyMs);
  const actionType =
    verdict.verdict === 'covered'
      ? 'file_claim'
      : verdict.verdict === 'not_covered'
        ? 'notify_denial'
        : 'request_documents';
  const english = emailLanguage === 'en';
  return {
    actionType,
    clientEmailDraft: {
      subject: english ? 'Your claim' : 'Votre sinistre',
      body: english
        ? `Hello,\n\nWe have reviewed your claim (${actionType}).\n\nThe claims team`
        : `Bonjour,\n\nNous avons étudié votre déclaration (${actionType}).\n\nLe service sinistres`,
    },
    internalNote:
      noteLanguage === 'en'
        ? `Simulated proposal: ${actionType}.`
        : `Proposition simulée : ${actionType}.`,
  };
}
