import {
  ClientDetailSchema,
  InsurerClausesSchema,
  InsurerPolicyDetailSchema,
  InsurerPolicySummarySchema,
  type ClientDetail,
  type ClientSummary,
  type InsurerClauses,
  type InsurerPolicySummary,
  type InsurerPolicyView,
} from '@demo/shared';
import { issueMcpToken } from '@demo/shared/mcp-token';
import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { caseReference } from '../cases/case-views.js';
import { CasesService } from '../cases/cases.service.js';
import { ENV, type Env } from '../env.js';
import { PrismaService } from '../prisma/prisma.service.js';

const TIMEOUT_MS = 10_000;
const isoDate = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

/**
 * V17: what the broker can open in the UI — the insurer's extranet (read through its `/portal`
 * routes with a `read` token of the brokerage; the browser holds no token) and the brokerage's
 * own client base. Read-only.
 */
@Injectable()
export class PortalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cases: CasesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** GET on the extranet's portal, as the demo's brokerage, with a read token. */
  private async extranet(path: string): Promise<unknown> {
    if (!this.env.MCP_TOKEN_SECRET) {
      throw new ServiceUnavailableException(
        'MCP_TOKEN_SECRET is not set: the extranet is not reachable.',
      );
    }
    const broker = await this.cases.currentBroker();
    const token = issueMcpToken(
      { scope: 'read', brokerCode: broker.brokerage.brokerCode },
      this.env.MCP_TOKEN_SECRET,
    );
    const response = await fetch(new URL(`/portal${path}`, this.env.MCP_EXTRANET_URL), {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 404) throw new NotFoundException((await response.json()).error);
    if (response.status === 403) throw new ForbiddenException((await response.json()).error);
    if (!response.ok) {
      throw new ServiceUnavailableException(`Extranet ${path} failed (${response.status}).`);
    }
    return response.json();
  }

  async policies(query: string | undefined): Promise<InsurerPolicySummary[]> {
    const path = query ? `/policies?q=${encodeURIComponent(query)}` : '/policies';
    return InsurerPolicySummarySchema.array().parse(await this.extranet(path));
  }

  /** The insurer's policy, next to what the brokerage knows about it. */
  async policy(number: string): Promise<InsurerPolicyView> {
    const detail = InsurerPolicyDetailSchema.parse(
      await this.extranet(`/policies/${encodeURIComponent(number)}`),
    );
    const known = await this.prisma.policy.findUnique({
      where: { number: detail.number },
      include: { client: true },
    });
    return {
      ...detail,
      brokerage: known
        ? {
            knownStatus: known.knownStatus,
            renewalDate: isoDate(known.renewalDate)!,
            cancellationEffectiveDate: isoDate(known.cancellationEffectiveDate),
            client: { id: known.client.id, companyName: known.client.companyName },
          }
        : null,
    };
  }

  async conditions(clauseRef: string): Promise<InsurerClauses> {
    return InsurerClausesSchema.parse(
      await this.extranet(`/clauses/${encodeURIComponent(clauseRef)}`),
    );
  }

  async clients(query: string | undefined): Promise<ClientSummary[]> {
    const q = query?.trim();
    const clients = await this.prisma.client.findMany({
      where: q
        ? {
            OR: [
              { companyName: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
              { siren: { contains: q } },
            ],
          }
        : {},
      include: { _count: { select: { policies: true, cases: true } } },
      orderBy: { companyName: 'asc' },
    });
    return clients.map((client) => ({
      id: client.id,
      companyName: client.companyName,
      siren: client.siren,
      contactName: client.contactName,
      email: client.email,
      policies: client._count.policies,
      cases: client._count.cases,
    }));
  }

  async client(id: string): Promise<ClientDetail> {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        policies: { orderBy: { number: 'asc' } },
        cases: {
          orderBy: { createdAt: 'desc' },
          include: {
            email: true,
            proposedActions: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
    });
    if (!client) throw new NotFoundException(`No client ${id}.`);
    return ClientDetailSchema.parse({
      id: client.id,
      companyName: client.companyName,
      siren: client.siren,
      contactName: client.contactName,
      email: client.email,
      policies: client.policies.map((policy) => ({
        number: policy.number,
        insurerName: policy.insurerName,
        product: policy.product,
        knownStatus: policy.knownStatus,
        renewalDate: isoDate(policy.renewalDate),
        cancellationEffectiveDate: isoDate(policy.cancellationEffectiveDate),
      })),
      cases: client.cases.map((kase) => ({
        id: kase.id,
        reference: caseReference(kase.number),
        receivedAt: kase.email.receivedAt.toISOString(),
        subject: kase.email.subject,
        requestType: kase.requestType,
        status: kase.status,
        lastAction: kase.proposedActions[0]?.actionType ?? null,
      })),
    });
  }
}
