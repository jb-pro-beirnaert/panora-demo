import {
  detectLanguage,
  missingDocuments,
  type ActionType,
  type RequestSubtype,
  type RequestType,
  type ServiceAnalysis,
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

/** Request type and subtype from keywords (V15 request types). */
function simulatedRequest(head: string): [RequestType, RequestSubtype | null] {
  if (/newsletter|désabonner|unsubscribe/i.test(head)) return ['unrelated', 'newsletter'];
  if (/google|seo|audit gratuit|free audit/i.test(head)) return ['unrelated', 'spam'];
  if (/service comptabilit|fournitures de bureau|entretien des locaux/i.test(head)) {
    return ['unrelated', 'supplier_invoice'];
  }
  const subject = head.split('\n')[0] ?? '';
  const resent = /renvoie mon e-mail|sending my e-mail again/i.test(head);
  if (
    !resent &&
    (/^re\s*:/i.test(subject) ||
      /suite à mon e-mail|further to my|où en est|where does/i.test(head))
  ) {
    return ['follow_up', null];
  }
  if (/résili|cancel/i.test(head)) return ['cancellation', null];
  if (/attestation|certificate/i.test(head)) return ['information', 'certificate'];
  if (/couvre-t-il|question sur nos garanties|does our policy cover|about our cover/i.test(head)) {
    return ['information', 'coverage_question'];
  }
  if (/demande de devis|devis pour|quote request|send us a quote/i.test(head)) {
    return ['quote_request', null];
  }
  return ['claim', null];
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
  const [requestType, subtype] = simulatedRequest(head);
  const nature = PERIL_WORDS.find(([, pattern]) => pattern.test(head))?.[0] ?? null;
  const documentsPresent = email.attachments.map((attachment) => ({
    type: documentType(attachment.fileName),
    fileName: attachment.fileName,
  }));
  const incident = new Date(`${receivedDate}T00:00:00Z`);
  incident.setUTCDate(incident.getUTCDate() - 1);
  return {
    requestType,
    subtype,
    caseReference: /CASE-\d{4}/.exec(head)?.[0] ?? null,
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

/** The claim action a verdict calls for. */
export function claimActionOf(verdict: CoverageVerdict): ActionType {
  return verdict.verdict === 'covered'
    ? 'file_claim'
    : verdict.verdict === 'not_covered'
      ? 'notify_denial'
      : 'request_documents';
}

export async function simulateDraft(
  actionType: ActionType,
  emailLanguage: 'fr' | 'en',
  noteLanguage: 'fr' | 'en',
  latencyMs: number,
): Promise<Draft> {
  await sleep(latencyMs);
  const english = emailLanguage === 'en';
  const placeholder =
    actionType === 'file_claim'
      ? ' {{claimNumber}}'
      : actionType === 'cancel_policy'
        ? ' {{effectiveDate}}'
        : '';
  return {
    actionType,
    clientEmailDraft: {
      subject: english ? 'Your claim' : 'Votre sinistre',
      body: english
        ? `Hello,\n\nWe have reviewed your request (${actionType}${placeholder}).\n\nThe claims team`
        : `Bonjour,\n\nNous avons étudié votre demande (${actionType}${placeholder}).\n\nLe service sinistres`,
    },
    internalNote:
      noteLanguage === 'en'
        ? `Simulated proposal: ${actionType}.`
        : `Proposition simulée : ${actionType}.`,
  };
}

/**
 * Stand-in for `policyServiceAgent`: reads the policy through the real MCP tools and applies the
 * cancellation rules (notice of two months before the renewal date).
 */
export async function simulateService(
  claim: TriagedEmail,
  latencyMs: number,
): Promise<ServiceAnalysis> {
  await sleep(latencyMs);
  const number = claim.triage.policyNumber.value;
  const base: ServiceAnalysis = {
    outcome: 'handover',
    handoverReason: 'policy_not_found',
    policyNumber: number,
    policyStatus: null,
    renewalDate: null,
    effectiveDate: null,
    alerts: [],
    answer: null,
    citations: [],
    summary: 'Simulated analysis.',
  };
  if (!number) return base;
  const tools = await extranetTools('read', claim.brokerage.brokerCode);
  const policy = toolJson(await tools.get_policy?.execute?.({ number }, {})) as {
    status?: string;
    endDate?: string | null;
    endReason?: string | null;
    renewalDate?: string;
  } | null;
  if (!policy?.status || !policy.renewalDate) return base;
  const status = policy.status as ServiceAnalysis['policyStatus'];
  const common = {
    ...base,
    outcome: 'proposal' as const,
    handoverReason: null,
    policyStatus: status,
    renewalDate: policy.renewalDate,
  };
  if (claim.triage.requestType === 'information') {
    return { ...common, answer: 'Simulated answer about the cover.' };
  }
  if (status === 'terminated') return { ...common, alerts: ['already_terminated'] };
  if (policy.endReason === 'client_request' && policy.endDate) {
    return { ...common, effectiveDate: policy.endDate, alerts: ['cancellation_already_requested'] };
  }
  const notice = new Date(`${claim.receivedDate}T00:00:00Z`);
  notice.setUTCMonth(notice.getUTCMonth() + 2);
  if (notice.toISOString().slice(0, 10) <= policy.renewalDate) {
    return { ...common, effectiveDate: policy.renewalDate };
  }
  const next = new Date(`${policy.renewalDate}T00:00:00Z`);
  next.setUTCFullYear(next.getUTCFullYear() + 1);
  return {
    ...common,
    effectiveDate: next.toISOString().slice(0, 10),
    alerts: ['notice_period_not_met'],
  };
}
