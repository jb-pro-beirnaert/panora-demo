import {
  missingDocuments,
  REQUIRED_DOCUMENTS,
  type ActionType,
  type AlertType,
  type AttachmentInput,
  type ClaimGroundTruth,
  type ClaimScenarioId,
  type DocumentType,
  type ExtranetClaim,
  type ExtranetCoverage,
  type ExtranetPolicy,
  type NonClaimGroundTruth,
  type Peril,
  type ScenarioId,
  type Verdict,
} from '@demo/shared';
import type { Faker } from '@faker-js/faker';
import { buildAttachment, DOCUMENT_NOUNS, type AttachmentContext } from './attachments.js';
import { BUSINESSES, ROADS, type BusinessDefinition } from './catalog/businesses.js';
import { clauseRef, GENERAL_CLAUSES, insurerById } from './catalog/insurers.js';
import { PERILS, type ExclusionDefinition } from './catalog/perils.js';
import {
  addDays,
  createRandom,
  frAmount,
  frDate,
  frShortDate,
  int,
  isoDateTime,
  pick,
  roundTo,
} from './random.js';
import type { Client, GeneratedEmail, Vehicle, World } from './types.js';
import { SHOWCASE } from './world.js';

export interface GenerateEmailsOptions {
  seed: number;
  count: number;
  /** Restrict the draw to these scenarios. Defaults to every available scenario. */
  scenarios?: ScenarioId[];
}

/**
 * The first e-mails go through the catalog in this order, so a small batch already contains every
 * scenario, starting with the showcase ones. Later e-mails are drawn with `SCENARIO_WEIGHTS`.
 */
export const SCENARIO_ORDER: ScenarioId[] = [
  'covered',
  'policy_terminated',
  'missing_document',
  'exclusion',
  'limit_exceeded',
  'deductible',
  'duplicate_claim',
  'unreadable_field',
  'late_declaration',
  'non_claim',
];

/** About 35 % simple cases (covered, deductible), 50 % traps, 15 % e-mails that are not claims. */
export const SCENARIO_WEIGHTS: Record<ScenarioId, number> = {
  covered: 25,
  deductible: 10,
  policy_terminated: 7,
  exclusion: 7,
  limit_exceeded: 7,
  missing_document: 7,
  duplicate_claim: 7,
  unreadable_field: 7,
  late_declaration: 8,
  non_claim: 15,
};

/** The action `draftingAgent` should propose for each claim scenario. */
const EXPECTED_ACTION: Record<ClaimScenarioId, ActionType> = {
  covered: 'file_claim',
  deductible: 'file_claim',
  limit_exceeded: 'file_claim',
  policy_terminated: 'notify_denial',
  exclusion: 'notify_denial',
  missing_document: 'request_documents',
  duplicate_claim: 'request_documents',
  unreadable_field: 'request_documents',
  late_declaration: 'request_documents',
};

interface Target {
  policy: ExtranetPolicy;
  coverage: ExtranetCoverage;
  client: Client;
  business: BusinessDefinition;
  vehicle: Vehicle | undefined;
}

/** Everything needed to write one claim e-mail. */
interface ClaimDraft {
  scenario: ClaimScenarioId;
  target: Target;
  incidentDate: string;
  receivedAt: string;
  amount: number;
  /** Amount readable in the e-mail or its attachments. */
  amountReadable: boolean;
  dateReadable: boolean;
  policyNumberInEmail: boolean;
  documents: DocumentType[];
  exclusion: ExclusionDefinition | undefined;
  verdict: Verdict;
  alerts: AlertType[];
  clauseRef: string;
}

class EmailFactory {
  private readonly usage = new Map<string, number>();
  private readonly recentOpenClaims: ExtranetClaim[];

  constructor(
    private readonly world: World,
    private readonly faker: Faker,
    private readonly seed: number,
  ) {
    const recentLimit = addDays(world.referenceDate, -10);
    this.recentOpenClaims = world.claims.filter(
      (claim) => claim.status === 'open' && claim.date >= recentLimit,
    );
  }

  // --- Target selection ---

  private target(policy: ExtranetPolicy, peril: Peril): Target {
    const client = this.world.clients.find(
      (candidate) => candidate.companyName === policy.holderName,
    )!;
    const coverage = policy.coverages.find((candidate) => candidate.peril === peril)!;
    const vehicles = this.world.vehicles.filter(
      (vehicle) => vehicle.policyNumber === policy.number,
    );
    return {
      policy,
      coverage,
      client,
      business: BUSINESSES[client.businessIndex]!,
      vehicle:
        PERILS[peril].vehicle || policy.product === 'Flotte automobile'
          ? pick(this.faker, vehicles)
          : undefined,
    };
  }

  /** Picks a (policy, coverage) pair matching `accept`, preferring the least used policies. */
  private pickTarget(
    accept: (policy: ExtranetPolicy, coverage: ExtranetCoverage) => boolean,
    policyFilter: (policy: ExtranetPolicy) => boolean,
  ): Target {
    const pairs = this.world.policies
      .filter(policyFilter)
      .flatMap((policy) =>
        policy.coverages
          .filter((coverage) => accept(policy, coverage))
          .map((coverage) => ({ policy, coverage })),
      );
    if (pairs.length === 0) throw new Error('No policy in the world fits this scenario');
    const minUsage = Math.min(...pairs.map(({ policy }) => this.usage.get(policy.number) ?? 0));
    const least = pairs.filter(({ policy }) => (this.usage.get(policy.number) ?? 0) === minUsage);
    const { policy, coverage } = pick(this.faker, least);
    this.usage.set(policy.number, minUsage + 1);
    return this.target(policy, coverage.peril);
  }

  private isActiveWithoutOpenClaim = (policy: ExtranetPolicy): boolean =>
    policy.status === 'active' &&
    !this.recentOpenClaims.some((claim) => claim.policyNumber === policy.number);

  // --- Dates and amounts ---

  private receivedDate(): string {
    return addDays(this.world.referenceDate, -int(this.faker, 0, 2));
  }

  private receivedAt(date: string): string {
    return isoDateTime(date, int(this.faker, 7, 18), int(this.faker, 0, 59));
  }

  private typicalAmount(coverage: ExtranetCoverage): number {
    const [min, max] = PERILS[coverage.peril].amountRange;
    const upper = Math.min(max, coverage.limit * 0.6);
    const lower = Math.max(min, coverage.deductible * 3);
    return roundTo(int(this.faker, Math.round(lower), Math.round(Math.max(lower, upper))), 10);
  }

  private completeDocuments(peril: Peril, amount: number): DocumentType[] {
    const documents: DocumentType[] = REQUIRED_DOCUMENTS[peril].map((required) =>
      required === 'invoice_or_quote' ? (amount > 3_000 ? 'quote' : 'invoice') : required,
    );
    if (this.faker.datatype.boolean(0.3)) documents.push('photos');
    return documents;
  }

  // --- Scenarios ---

  draft(scenario: ClaimScenarioId): ClaimDraft {
    const received = this.receivedDate();
    const base = {
      scenario,
      receivedAt: this.receivedAt(received),
      amountReadable: true,
      dateReadable: true,
      policyNumberInEmail: this.faker.datatype.boolean(scenario === 'covered' ? 0.6 : 0.5),
      exclusion: undefined,
    };
    const recentIncident = addDays(received, -int(this.faker, 1, 2));
    const coverageClause = (target: Target) => target.coverage.clauseRef;
    const generalClause = (target: Target, number: string) =>
      clauseRef(insurerById(target.policy.insurerId), number);

    switch (scenario) {
      case 'covered': {
        const target = this.pickTarget(() => true, this.isActiveWithoutOpenClaim);
        const amount = this.typicalAmount(target.coverage);
        return {
          ...base,
          target,
          incidentDate: recentIncident,
          amount,
          documents: this.completeDocuments(target.coverage.peril, amount),
          verdict: 'covered',
          alerts: [],
          clauseRef: coverageClause(target),
        };
      }
      case 'policy_terminated': {
        const target = this.pickTarget(
          () => true,
          (policy) => policy.status === 'terminated' && (policy.endDate ?? '') < recentIncident,
        );
        const amount = this.typicalAmount(target.coverage);
        return {
          ...base,
          target,
          incidentDate: recentIncident,
          amount,
          documents: this.completeDocuments(target.coverage.peril, amount),
          verdict: 'not_covered',
          alerts: ['policy_terminated'],
          clauseRef: generalClause(target, GENERAL_CLAUSES.termination),
        };
      }
      case 'exclusion': {
        const target = this.pickTarget(
          (_policy, coverage) => coverage.exclusions.length > 0,
          this.isActiveWithoutOpenClaim,
        );
        const amount = this.typicalAmount(target.coverage);
        return {
          ...base,
          target,
          incidentDate: recentIncident,
          amount,
          documents: this.completeDocuments(target.coverage.peril, amount),
          exclusion: pick(this.faker, PERILS[target.coverage.peril].exclusions),
          verdict: 'not_covered',
          alerts: ['exclusion'],
          clauseRef: coverageClause(target),
        };
      }
      case 'limit_exceeded': {
        const target = this.pickTarget(
          (_policy, coverage) =>
            ['water_damage', 'theft', 'vehicle_damage'].includes(coverage.peril),
          this.isActiveWithoutOpenClaim,
        );
        const amount = roundTo(
          target.coverage.limit * (1.2 + this.faker.number.float({ min: 0, max: 0.6 })),
          50,
        );
        return {
          ...base,
          target,
          incidentDate: recentIncident,
          amount,
          documents: this.completeDocuments(target.coverage.peril, amount),
          verdict: 'covered',
          alerts: ['limit_exceeded'],
          clauseRef: coverageClause(target),
        };
      }
      case 'deductible': {
        const target = this.pickTarget(
          (_policy, coverage) => coverage.deductible >= 300,
          this.isActiveWithoutOpenClaim,
        );
        const amount = target.coverage.deductible + roundTo(int(this.faker, 150, 700), 10);
        return {
          ...base,
          target,
          incidentDate: recentIncident,
          amount,
          documents: this.completeDocuments(target.coverage.peril, amount),
          verdict: 'covered',
          alerts: [],
          clauseRef: coverageClause(target),
        };
      }
      case 'missing_document': {
        const target = this.pickTarget(
          (_policy, coverage) => coverage.peril !== 'glass_breakage',
          this.isActiveWithoutOpenClaim,
        );
        return {
          ...base,
          target,
          incidentDate: recentIncident,
          amount: this.typicalAmount(target.coverage),
          amountReadable: false,
          documents: [],
          verdict: 'uncertain',
          alerts: ['missing_document'],
          clauseRef: generalClause(target, GENERAL_CLAUSES.supportingDocuments),
        };
      }
      case 'duplicate_claim': {
        const claim = pick(this.faker, this.recentOpenClaims);
        const policy = this.world.policies.find(
          (candidate) => candidate.number === claim.policyNumber,
        )!;
        this.usage.set(policy.number, (this.usage.get(policy.number) ?? 0) + 1);
        const target = this.target(policy, claim.nature);
        return {
          ...base,
          receivedAt: this.receivedAt(addDays(claim.date, int(this.faker, 1, 2))),
          target,
          incidentDate: claim.date,
          amount: claim.amount,
          documents: this.completeDocuments(claim.nature, claim.amount),
          verdict: 'uncertain',
          alerts: ['duplicate_claim'],
          clauseRef: coverageClause(target),
        };
      }
      case 'unreadable_field': {
        const target = this.pickTarget(() => true, this.isActiveWithoutOpenClaim);
        const amount = this.typicalAmount(target.coverage);
        const documents = this.completeDocuments(target.coverage.peril, amount);
        // Either the amount on the invoice/quote is unreadable, or the incident date is missing. A
        // missing date needs a document that would normally carry it.
        const dateCarrier = documents.some((type) =>
          ['incident_report', 'police_report', 'fire_report'].includes(type),
        );
        const dateUnreadable = dateCarrier && this.faker.datatype.boolean(0.5);
        return {
          ...base,
          target,
          incidentDate: addDays(received, -int(this.faker, 3, 6)),
          amount,
          amountReadable: dateUnreadable,
          dateReadable: !dateUnreadable,
          documents,
          verdict: 'uncertain',
          alerts: [],
          clauseRef: coverageClause(target),
        };
      }
      case 'late_declaration': {
        const target = this.pickTarget(() => true, this.isActiveWithoutOpenClaim);
        const amount = this.typicalAmount(target.coverage);
        return {
          ...base,
          target,
          incidentDate: addDays(received, -int(this.faker, 25, 60)),
          amount,
          documents: this.completeDocuments(target.coverage.peril, amount),
          verdict: 'uncertain',
          alerts: ['late_declaration'],
          clauseRef: generalClause(target, GENERAL_CLAUSES.declarationDelay),
        };
      }
    }
  }

  // --- Writing ---

  private whenExpression(draft: ClaimDraft): string {
    const received = draft.receivedAt.slice(0, 10);
    if (!draft.dateReadable)
      return 'La semaine dernière (mardi ou mercredi, je ne sais plus exactement)';
    if (draft.scenario === 'late_declaration') return `Le ${frDate(draft.incidentDate)}`;
    if (this.faker.datatype.boolean(0.5)) return `Le ${frShortDate(draft.incidentDate)}`;
    if (draft.incidentDate === addDays(received, -1))
      return pick(this.faker, ['Hier', 'Hier soir']);
    if (draft.incidentDate === addDays(received, -2)) return 'Avant-hier';
    return `Le ${frShortDate(draft.incidentDate)}`;
  }

  /** What happened, without the date expression (lower-case start, ends with a period). */
  private describe(draft: ClaimDraft): string {
    const { business, vehicle } = draft.target;
    const excluded = draft.exclusion !== undefined;
    switch (draft.target.coverage.peril) {
      case 'water_damage':
        return pick(this.faker, [
          `une fuite au plafond a inondé ${business.area}.`,
          `un tuyau a cédé et l'eau s'est répandue dans ${business.area}.`,
          `le chauffe-eau a lâché et a inondé ${business.area}.`,
        ]);
      case 'fire':
        return pick(this.faker, [
          `un départ de feu s'est déclaré dans ${business.area}.`,
          `un court-circuit sur un appareil a provoqué un incendie dans ${business.area}.`,
        ]);
      case 'theft':
        return `on nous a volé ${business.stolenItems}.${excluded ? '' : ' La porte arrière a été forcée.'}`;
      case 'glass_breakage':
        return vehicle
          ? `le pare-brise de notre ${vehicle.model} immatriculé ${vehicle.plate} a été endommagé sur ${pick(this.faker, ROADS)}.${excluded ? '' : " Un projectile l'a fissuré sur toute la largeur."}`
          : `nous avons constaté des dégâts sur ${business.glass}.${excluded ? '' : ' Elle a été brisée par un projectile lancé depuis la rue.'}`;
      case 'vehicle_damage':
        return `notre ${vehicle?.model ?? 'véhicule'} immatriculé ${vehicle?.plate ?? ''} a percuté un poteau en manœuvrant sur ${pick(this.faker, ['le parking du dépôt', 'une aire de livraison', ...ROADS])}.`;
    }
  }

  private subject(draft: ClaimDraft): string {
    const { business, client, vehicle } = draft.target;
    switch (draft.target.coverage.peril) {
      case 'water_damage':
        return pick(this.faker, [
          `Dégât des eaux dans ${business.area}`,
          `Sinistre dégât des eaux - ${client.tradeName}`,
          "Fuite d'eau dans nos locaux",
        ]);
      case 'fire':
        return pick(this.faker, [
          'Incendie dans nos locaux',
          `Départ de feu - ${client.tradeName}`,
          'Déclaration de sinistre incendie',
        ]);
      case 'theft':
        return pick(this.faker, [
          'Vol dans nos locaux',
          `Déclaration de vol - ${client.tradeName}`,
        ]);
      case 'glass_breakage':
        return vehicle
          ? `Bris de glace ${vehicle.plate}`
          : pick(this.faker, ['Vitrine endommagée', 'Bris de glace']);
      case 'vehicle_damage':
        return `Accident véhicule ${vehicle?.plate ?? ''}`.trim();
    }
  }

  private signature(client: Client): string {
    const company = this.faker.datatype.boolean(0.5) ? client.companyName : client.tradeName;
    return `${pick(this.faker, ['Cordialement,', 'Bien cordialement,', 'Merci par avance,'])}\n${client.contactName}\n${company}\n${client.phone}`;
  }

  private greeting(brokerageId: string): string {
    const brokers = this.world.brokers.filter((broker) => broker.brokerageId === brokerageId);
    const firstName = pick(this.faker, brokers).name.split(' ')[0];
    return pick(this.faker, ['Bonjour,', 'Bonjour Madame, Monsieur,', `Bonjour ${firstName},`]);
  }

  private location(target: Target): string {
    if (target.vehicle) return pick(this.faker, ROADS);
    const { street, postalCode, city } = target.client.address;
    return `${street}, ${postalCode} ${city}`;
  }

  write(draft: ClaimDraft, index: number): GeneratedEmail {
    const { target } = draft;
    const received = draft.receivedAt.slice(0, 10);
    const brokerage = this.world.brokerages.find(
      (candidate) => candidate.id === target.client.brokerageId,
    )!;
    const what = this.describe(draft);
    const description = `${this.whenExpression(draft)}, ${what}`;
    const numberInBody =
      draft.policyNumberInEmail &&
      (draft.documents.length === 0 || this.faker.datatype.boolean(0.6));
    const context: AttachmentContext = {
      faker: this.faker,
      client: target.client,
      peril: target.coverage.peril,
      incidentDate: draft.incidentDate,
      receivedDate: received,
      policyNumber: draft.policyNumberInEmail && !numberInBody ? target.policy.number : null,
      amount: draft.amountReadable ? draft.amount : null,
      dateUnreadable: !draft.dateReadable,
      location: this.location(target),
      circumstances: what.charAt(0).toUpperCase() + what.slice(1),
      vehicle: target.vehicle,
    };
    // An incident report always carries the number when the e-mail is meant to and the body does not.
    if (context.policyNumber && !draft.documents.includes('incident_report')) {
      draft.documents.unshift('incident_report');
    }
    const attachments = draft.documents.map((type) => buildAttachment(type, context));

    const paragraphs: string[] = [];
    if (draft.scenario === 'late_declaration') {
      paragraphs.push(
        `Je reviens vers vous au sujet d'un sinistre que nous n'avions pas encore déclaré, faute de temps avec l'activité de ces dernières semaines. ${description}`,
      );
    } else {
      paragraphs.push(description);
    }
    if (draft.exclusion) paragraphs.push(draft.exclusion.emailCause);
    if (attachments.length > 0) {
      const nouns = draft.documents.map((type) => DOCUMENT_NOUNS[type]);
      const list =
        nouns.length > 1 ? `${nouns.slice(0, -1).join(', ')} et ${nouns.at(-1)}` : nouns[0];
      const amountNote =
        draft.amountReadable && this.faker.datatype.boolean(0.5)
          ? ` (${frAmount(draft.amount)})`
          : '';
      paragraphs.push(`Vous trouverez ci-joint ${list}${amountNote}.`);
    } else {
      paragraphs.push(
        pick(this.faker, [
          'Que devons-nous faire ?',
          "Pouvez-vous nous dire comment procéder avec l'assurance ?",
        ]),
      );
    }
    if (!draft.amountReadable && attachments.length > 0) {
      paragraphs.push("Désolé, le scan de la facture n'est pas très net.");
    }
    if (numberInBody) paragraphs.push(`Notre numéro de contrat : ${target.policy.number}.`);
    if (attachments.length > 0) {
      paragraphs.push(
        pick(this.faker, [
          "Merci de faire le nécessaire auprès de l'assureur.",
          'Pouvez-vous déclarer le sinistre ?',
          'Merci de nous tenir informés de la suite.',
        ]),
      );
    }

    const body = [
      this.greeting(brokerage.id),
      paragraphs.join(' '),
      this.signature(target.client),
    ].join('\n\n');
    return this.finish(index, draft, {
      from: target.client.email,
      to: brokerage.inboxEmail,
      subject: this.subject(draft),
      body,
      attachments,
    });
  }

  finish(
    index: number,
    draft: ClaimDraft,
    content: {
      from: string;
      to: string;
      subject: string;
      body: string;
      attachments: AttachmentInput[];
    },
  ): GeneratedEmail {
    const { target } = draft;
    const groundTruth: ClaimGroundTruth = {
      scenario: draft.scenario,
      requestType: 'claim',
      brokerCode: target.policy.brokerCode,
      holderName: target.policy.holderName,
      policyNumber: target.policy.number,
      policyNumberInEmail: draft.policyNumberInEmail,
      incidentDate: draft.incidentDate,
      incidentDateReadable: draft.dateReadable,
      nature: target.coverage.peril,
      amount: draft.amountReadable ? draft.amount : null,
      documentsMissing: missingDocuments(target.coverage.peril, draft.documents),
      verdict: draft.verdict,
      reason: draft.scenario,
      alerts: draft.alerts,
      coverageLabel: target.coverage.label,
      limit: target.coverage.limit,
      deductible: target.coverage.deductible,
      clauseRef: draft.clauseRef,
      expectedAction: EXPECTED_ACTION[draft.scenario],
    };
    return {
      email: {
        messageId: `<demo-${this.seed}-${String(index + 1).padStart(4, '0')}@simulator.local>`,
        receivedAt: draft.receivedAt,
        ...content,
      },
      groundTruth,
    };
  }

  // --- Showcase e-mails (verbatim from specs/00-demo-data-and-scenarios.md §3) ---

  showcase(scenario: ClaimScenarioId, index: number): GeneratedEmail | undefined {
    const policyOf = (number: string) =>
      this.world.policies.find((policy) => policy.number === number);
    const signature = (client: Client) =>
      `Cordialement,\n${client.contactName}\n${client.companyName}\n${client.phone}`;

    if (scenario === 'covered') {
      const policy = policyOf(SHOWCASE.fleetPolicy);
      if (!policy) return undefined;
      const target = { ...this.target(policy, 'glass_breakage') };
      target.vehicle = this.world.vehicles.find((vehicle) => vehicle.plate === 'AB-456-EF');
      const received = addDays(this.world.referenceDate, -2);
      const incident = addDays(received, -1);
      const draft: ClaimDraft = {
        scenario,
        target,
        incidentDate: incident,
        receivedAt: isoDateTime(received, 9, 12),
        amount: 420,
        amountReadable: true,
        dateReadable: true,
        policyNumberInEmail: true,
        documents: ['invoice'],
        exclusion: undefined,
        verdict: 'covered',
        alerts: [],
        clauseRef: target.coverage.clauseRef,
      };
      const invoice = buildAttachment('invoice', {
        faker: this.faker,
        client: target.client,
        peril: 'glass_breakage',
        incidentDate: incident,
        receivedDate: received,
        policyNumber: null,
        amount: 420,
        dateUnreadable: false,
        location: 'A1',
        circumstances: 'Pare-brise fissuré par un projectile',
        vehicle: target.vehicle,
      });
      return this.finish(index, draft, {
        from: target.client.email,
        to: this.inboxOf(target.client),
        subject: 'Bris de glace camion AB-456-EF',
        body: `Bonjour,\n\nLe pare-brise de notre camion AB-456-EF a été fissuré par un projectile sur l'A1 le ${frShortDate(incident)}. Ci-joint la facture du réparateur (420 €). Contrat F-77102.\n\n${signature(target.client)}`,
        attachments: [{ ...invoice, fileName: 'facture_vitrage.pdf' }],
      });
    }

    if (scenario === 'policy_terminated') {
      const policy = policyOf(SHOWCASE.terminatedPolicy);
      if (!policy) return undefined;
      const target = this.target(policy, 'water_damage');
      const received = addDays(this.world.referenceDate, -1);
      const draft: ClaimDraft = {
        scenario,
        target,
        incidentDate: received,
        receivedAt: isoDateTime(received, 7, 48),
        amount: 1_450,
        amountReadable: true,
        dateReadable: true,
        policyNumberInEmail: false,
        documents: ['incident_report', 'invoice'],
        exclusion: undefined,
        verdict: 'not_covered',
        alerts: ['policy_terminated'],
        clauseRef: clauseRef(insurerById(policy.insurerId), GENERAL_CLAUSES.termination),
      };
      const context: AttachmentContext = {
        faker: this.faker,
        client: target.client,
        peril: 'water_damage',
        incidentDate: received,
        receivedDate: received,
        policyNumber: null,
        amount: 1_450,
        dateUnreadable: false,
        location: this.location(target),
        circumstances: 'Fuite au plafond vers 3 h du matin, le fournil a été inondé.',
        vehicle: undefined,
      };
      return this.finish(index, draft, {
        from: target.client.email,
        to: this.inboxOf(target.client),
        subject: 'Dégât des eaux dans le fournil',
        body: `Bonjour,\n\nUne fuite au plafond a inondé le fournil cette nuit. Vous trouverez le constat et la facture du plombier (1 450 €).\n\n${signature(target.client)}`,
        attachments: [
          buildAttachment('incident_report', context),
          { ...buildAttachment('invoice', context), fileName: 'facture_plombier.pdf' },
        ],
      });
    }

    if (scenario === 'missing_document') {
      const garage = this.world.clients.find((client) => client.id === SHOWCASE.garageClientId);
      const policy = this.world.policies.find(
        (candidate) => candidate.holderName === garage?.companyName,
      );
      if (!garage || !policy || policy.status !== 'active') return undefined;
      const target = this.target(policy, 'fire');
      const received = addDays(this.world.referenceDate, -1);
      const draft: ClaimDraft = {
        scenario,
        target,
        incidentDate: addDays(received, -1),
        receivedAt: isoDateTime(received, 8, 5),
        amount: 0,
        amountReadable: false,
        dateReadable: true,
        policyNumberInEmail: false,
        documents: [],
        exclusion: undefined,
        verdict: 'uncertain',
        alerts: ['missing_document'],
        clauseRef: clauseRef(insurerById(policy.insurerId), GENERAL_CLAUSES.supportingDocuments),
      };
      return this.finish(index, draft, {
        from: garage.email,
        to: this.inboxOf(garage),
        subject: 'Incendie atelier',
        body: `Bonjour,\n\nUn départ de feu dans notre atelier hier soir. Que devons-nous faire ?\n\n${signature(garage)}`,
        attachments: [],
      });
    }
    return undefined;
  }

  // --- Not a claim (scenario 8): a quote request or a cancellation ---

  writeNonClaim(index: number): GeneratedEmail {
    const client = pick(this.faker, this.world.clients);
    const brokerage = this.world.brokerages.find(
      (candidate) => candidate.id === client.brokerageId,
    )!;
    const business = BUSINESSES[client.businessIndex]!;
    const policies = this.world.brokeragePolicies.filter(
      (policy) => policy.clientId === client.id && policy.knownStatus === 'active',
    );
    const cancellation = policies.length > 0 && this.faker.datatype.boolean(0.5);
    const policy = cancellation ? pick(this.faker, policies) : undefined;
    const received = this.receivedDate();

    const subject = policy
      ? pick(this.faker, [
          `Résiliation du contrat ${policy.number}`,
          'Demande de résiliation',
          `Résiliation - ${client.tradeName}`,
        ])
      : pick(this.faker, [
          "Demande de devis pour l'ouverture d'un second local",
          'Demande de devis assurance',
          `Devis - ${client.tradeName}`,
        ]);
    const request = policy
      ? `Nous souhaitons résilier notre contrat ${policy.number} (${policy.product}) à sa prochaine échéance, le ${frDate(policy.renewalDate)}. ${pick(this.faker, ['Nous avons trouvé une offre plus adaptée à notre activité.', 'Nous cessons cette activité à la fin de l’année.', 'Merci de nous confirmer la démarche à suivre.'])}`
      : `${pick(this.faker, ['Nous ouvrons un second établissement', 'Nous allons agrandir nos locaux', 'Nous reprenons un fonds de commerce'])} ${pick(this.faker, ['le mois prochain', 'au début de l’année prochaine', 'dans quelques semaines'])}. Pourriez-vous nous faire parvenir un devis pour une assurance multirisque professionnelle couvrant ${business.area} et le matériel ?`;
    const body = [this.greeting(brokerage.id), request, this.signature(client)].join('\n\n');

    const groundTruth: NonClaimGroundTruth = {
      scenario: 'non_claim',
      requestType: policy ? 'cancellation' : 'quote_request',
      brokerCode: brokerage.brokerCode,
      holderName: client.companyName,
      policyNumber: policy?.number ?? null,
      policyNumberInEmail: policy !== undefined,
    };
    return {
      email: {
        messageId: `<demo-${this.seed}-${String(index + 1).padStart(4, '0')}@simulator.local>`,
        receivedAt: this.receivedAt(received),
        from: client.email,
        to: brokerage.inboxEmail,
        subject,
        body,
        attachments: [],
      },
      groundTruth,
    };
  }

  private inboxOf(client: Client): string {
    return this.world.brokerages.find((brokerage) => brokerage.id === client.brokerageId)!
      .inboxEmail;
  }
}

function drawScenarios(faker: Faker, allowed: ScenarioId[], count: number): ScenarioId[] {
  const ordered = SCENARIO_ORDER.filter((scenario) => allowed.includes(scenario));
  const scenarios = ordered.slice(0, count);
  const weighted = ordered.map((value) => ({ value, weight: SCENARIO_WEIGHTS[value] }));
  while (scenarios.length < count) scenarios.push(faker.helpers.weightedArrayElement(weighted));
  return scenarios;
}

/** Generates `count` inbound e-mails about `world`, each with its ground truth. Same seed, same e-mails. */
export function generateEmails(world: World, options: GenerateEmailsOptions): GeneratedEmail[] {
  const faker = createRandom(options.seed);
  const factory = new EmailFactory(world, faker, options.seed);
  const scenarios = drawScenarios(faker, options.scenarios ?? SCENARIO_ORDER, options.count);
  const showcased = new Set<ScenarioId>();
  return scenarios.map((scenario, index) => {
    if (scenario === 'non_claim') return factory.writeNonClaim(index);
    if (!showcased.has(scenario)) {
      showcased.add(scenario);
      const showcase = factory.showcase(scenario, index);
      if (showcase) return showcase;
    }
    return factory.write(factory.draft(scenario), index);
  });
}
