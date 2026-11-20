import type { AgentEventView, AgentStepView, SourceLink, StepSource } from '@demo/shared';

/**
 * V17: where the broker can open what an agent consulted — a policy or the insurer's conditions
 * in the extranet tab, a client's file, an attachment of the case — and which tool call gave the
 * agent that data ("what the agent saw").
 */

export interface LinkContext {
  caseId: string;
  /** The tool call whose result the page shows next to the current data. */
  eventId?: string | undefined;
  /** Clause excerpt to highlight. */
  excerpt?: string | undefined;
}

function query(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter((entry): entry is [string, string] =>
    Boolean(entry[1]),
  );
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
}

/** Anchor of an attachment on the case page. */
export function attachmentAnchor(fileName: string): string {
  return `attachment-${fileName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/** The UI path of a source, with the case and tool call it comes from. */
export function linkHref(link: SourceLink, context: LinkContext): string {
  const from = { case: context.caseId, event: context.eventId };
  switch (link.type) {
    case 'policy':
      return `/insurer/policies/${encodeURIComponent(link.policyNumber)}${query(from)}${link.section ? `#${link.section}` : ''}`;
    case 'clause':
      return `/insurer/clauses/${encodeURIComponent(link.clauseRef)}${query({ ...from, highlight: context.excerpt })}#${encodeURIComponent(link.clauseRef)}`;
    case 'client':
      return `/clients/${encodeURIComponent(link.clientId)}${query(from)}${link.section ? `#${link.section}` : ''}`;
    case 'policy_search':
      return `/insurer${query({ q: link.query })}`;
    case 'attachment':
      return `/cases/${encodeURIComponent(context.caseId)}#${attachmentAnchor(link.fileName)}`;
  }
}

/** The page a tool call of the live timeline leads to (from its arguments and its result). */
export function eventLink(
  event: AgentEventView,
  fallbackClientId: string | null,
): SourceLink | null {
  if (event.eventType !== 'tool_call') return null;
  const { tool, number, policyNumber, ref, holderName } = event.params;
  const result = (event.result ?? null) as { client?: { id?: string } | null } | null;
  switch (tool) {
    case 'get_policy':
      return number ? { type: 'policy', policyNumber: number } : null;
    case 'list_coverages':
      return policyNumber ? { type: 'policy', policyNumber, section: 'coverages' } : null;
    case 'get_claim_history':
      return policyNumber ? { type: 'policy', policyNumber, section: 'claims' } : null;
    case 'read_clause':
      return ref ? { type: 'clause', clauseRef: ref } : null;
    case 'search_policy':
      return holderName ? { type: 'policy_search', query: holderName } : null;
    case 'find_client': {
      const clientId = result?.client?.id ?? fallbackClientId;
      return clientId ? { type: 'client', clientId } : null;
    }
    case 'find_client_cases':
      return fallbackClientId
        ? { type: 'client', clientId: fallbackClientId, section: 'cases' }
        : null;
    default:
      return null;
  }
}

/** The tool a source comes from (a cited clause was read with `read_clause`). */
function toolOf(source: StepSource): string | null {
  if (source.kind === 'clause') return 'read_clause';
  if (source.kind === 'mcp_tool' || source.kind === 'core') return source.ref;
  return null;
}

/**
 * The tool call that gave the agent a source's data: the last call of that tool (and, for a
 * clause, of that clause) before the step was reported.
 */
export function sourceEvent(
  step: AgentStepView,
  source: StepSource,
  events: AgentEventView[],
): AgentEventView | null {
  const tool = toolOf(source);
  if (!tool) return null;
  const candidates = events.filter(
    (event) =>
      event.eventType === 'tool_call' &&
      event.params.tool === tool &&
      event.createdAt <= step.createdAt &&
      (tool !== 'read_clause' || event.params.ref === source.ref),
  );
  return candidates.at(-1) ?? null;
}
