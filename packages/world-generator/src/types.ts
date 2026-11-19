import type {
  ExtranetClaim,
  ExtranetClause,
  ExtranetInsurer,
  ExtranetPolicy,
  GroundTruth,
  InboundEmailInput,
  Locale,
  PolicyStatus,
} from '@demo/shared';

export interface Brokerage {
  id: string;
  name: string;
  brokerCode: string;
  locale: Locale;
  /** Claims inbox the clients write to. */
  inboxEmail: string;
}

export interface Broker {
  id: string;
  brokerageId: string;
  name: string;
  email: string;
  preferredLocale: Locale;
}

export interface Client {
  id: string;
  brokerageId: string;
  companyName: string;
  /** Name used in e-mail signatures (no legal form). */
  tradeName: string;
  siren: string;
  email: string;
  contactName: string;
  phone: string;
  address: { street: string; postalCode: string; city: string };
  /** Language the client writes in. */
  language: Locale;
  /** Index in `BUSINESSES` (French-speaking client) or `BUSINESSES_EN` (English-speaking). */
  businessIndex: number;
}

/** A policy as the brokerage's own software knows it (may be out of date). */
export interface BrokeragePolicy {
  number: string;
  clientId: string;
  insurerName: string;
  product: string;
  knownStatus: PolicyStatus;
  renewalDate: string;
}

export interface Vehicle {
  policyNumber: string;
  plate: string;
  model: string;
}

export interface World {
  seed: number;
  /** Languages of the generated data. */
  locales: Locale[];
  /** Share of English-speaking clients and e-mails (0 when `locales` is `['fr']`). */
  mix: { en: number };
  /** "Today" of the generated world (`YYYY-MM-DD`). All dates are relative to it. */
  referenceDate: string;
  // Brokerage side (Core, from V3).
  brokerages: Brokerage[];
  brokers: Broker[];
  clients: Client[];
  brokeragePolicies: BrokeragePolicy[];
  // Insurer side (MCP extranet).
  insurers: ExtranetInsurer[];
  clauses: ExtranetClause[];
  policies: ExtranetPolicy[];
  claims: ExtranetClaim[];
  vehicles: Vehicle[];
}

export interface GeneratedEmail {
  email: InboundEmailInput;
  groundTruth: GroundTruth;
}
