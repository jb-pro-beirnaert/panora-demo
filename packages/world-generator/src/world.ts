import type {
  ExtranetClaim,
  ExtranetCoverage,
  ExtranetPolicy,
  Locale,
  Peril,
  PolicyEndReason,
  PolicyStatus,
} from '@demo/shared';
import type { Faker } from '@faker-js/faker';
import {
  BUSINESSES,
  LEGAL_FORMS,
  VEHICLE_MODELS,
  type BusinessDefinition,
} from './catalog/businesses.js';
import { BUSINESSES_EN, PERILS_EN, PRODUCT_LABELS_EN } from './catalog/english.js';
import {
  ALL_INSURERS,
  INSURERS,
  NORTHBRIDGE,
  coverageClauseRef,
  insurerById,
  insurerClauses,
} from './catalog/insurers.js';
import { PERILS, PRODUCTS, type ProductDefinition } from './catalog/perils.js';
import {
  addDays,
  createEnglishRandom,
  createRandom,
  int,
  pick,
  roundTo,
  siren,
  slugify,
} from './random.js';
import type { Broker, Brokerage, BrokeragePolicy, Client, Vehicle, World } from './types.js';

export interface GenerateWorldOptions {
  seed: number;
  /** Languages of the generated data. Defaults to `['fr']`. `locale` is the V1–V3 spelling. */
  locales?: Locale[];
  locale?: Locale;
  /** Share of English-speaking clients when `locales` includes `en`. Defaults to 0.3. */
  mix?: { en: number };
  /** "Today" of the world. Defaults to `DEFAULT_REFERENCE_DATE` so output never depends on the clock. */
  referenceDate?: string;
}

export const DEFAULT_REFERENCE_DATE = '2026-11-18';

export const WORLD_SIZE = {
  clients: 30,
  policies: 40,
  priorClaims: 12,
  recentOpenClaims: 3,
} as const;

/** Hand-written entities from `specs/00-demo-data-and-scenarios.md`, used by the showcase e-mails. */
export const SHOWCASE = {
  brokerCode: 'DLM-075',
  terminatedPolicy: 'C-48213',
  fleetPolicy: 'F-77102',
  fleetPriorClaim: 'S-2026-0412',
  bakeryClientId: 'cli-001',
  transportClientId: 'cli-002',
  garageClientId: 'cli-003',
  /** Scenario 13: English-speaking client of a French brokerage, policy at a French insurer. */
  crossLanguagePolicy: 'C-51877',
  crossLanguageClientEmail: 'facilities@brightwave-solutions.com',
} as const;

/** The client's business, in the client's language. */
export function businessOf(client: Pick<Client, 'language' | 'businessIndex'>): BusinessDefinition {
  return (client.language === 'en' ? BUSINESSES_EN : BUSINESSES)[client.businessIndex]!;
}

const BROKERAGES: Brokerage[] = [
  {
    id: 'brk-001',
    name: 'Delorme Courtage',
    brokerCode: SHOWCASE.brokerCode,
    locale: 'fr',
    inboxEmail: 'sinistres@delorme-courtage.fr',
  },
  {
    id: 'brk-002',
    name: 'Vasseur & Associés',
    brokerCode: 'VSR-069',
    locale: 'fr',
    inboxEmail: 'sinistres@vasseur-associes.fr',
  },
];

/** English-speaking brokerage, added with the English data (V4). */
const ENGLISH_BROKERAGE: Brokerage = {
  id: 'brk-003',
  name: 'Hartley & Finch Brokers',
  brokerCode: 'HTF-092',
  locale: 'en',
  inboxEmail: 'claims@hartley-finch.eu',
};

function businessIndex(prefix: string): number {
  return BUSINESSES.findIndex((business) => business.prefix === prefix);
}

class WorldBuilder {
  readonly clients: Client[] = [];
  readonly brokers: Broker[] = [];
  readonly policies: ExtranetPolicy[] = [];
  readonly brokeragePolicies: BrokeragePolicy[] = [];
  readonly claims: ExtranetClaim[] = [];
  readonly vehicles: Vehicle[] = [];
  readonly brokerages: Brokerage[] = [...BROKERAGES];
  private readonly usedNumbers = new Set<string>();
  private readonly usedNames = new Set<string>();

  constructor(
    private readonly faker: Faker,
    private readonly referenceDate: string,
  ) {}

  // --- Brokers ---

  addBroker(brokerage: Brokerage, name?: string, faker: Faker = this.faker): void {
    const fullName = name ?? `${faker.person.firstName()} ${faker.person.lastName()}`;
    const [first = '', ...rest] = fullName.split(' ');
    const domain = brokerage.inboxEmail.split('@')[1];
    this.brokers.push({
      id: `bkr-${String(this.brokers.length + 1).padStart(3, '0')}`,
      brokerageId: brokerage.id,
      name: fullName,
      email: `${slugify(first).charAt(0)}.${slugify(rest.join(' '))}@${domain}`,
      preferredLocale: brokerage.locale,
    });
  }

  // --- Clients ---

  addClient(input: {
    brokerage: Brokerage;
    businessIndex: number;
    lastName?: string;
    legalForm?: string;
    siren?: string;
    emailLocal?: string;
    /** English-speaking client (V4): English names, `BUSINESSES_EN`, `.com` address. */
    english?: { faker: Faker; companyName?: string; email?: string; city?: string };
  }): Client {
    if (input.english) return this.addEnglishClient({ ...input, english: input.english });
    const business = BUSINESSES[input.businessIndex]!;
    let lastName = input.lastName;
    while (!lastName || this.usedNames.has(`${business.prefix} ${lastName}`)) {
      lastName = this.faker.person.lastName();
    }
    const tradeName = `${business.prefix} ${lastName}`;
    this.usedNames.add(tradeName);
    const legalForm = input.legalForm ?? pick(this.faker, LEGAL_FORMS);
    const local =
      input.emailLocal ?? pick(this.faker, ['contact', 'direction', 'gerance', 'accueil']);
    const client: Client = {
      id: `cli-${String(this.clients.length + 1).padStart(3, '0')}`,
      brokerageId: input.brokerage.id,
      companyName: legalForm ? `${tradeName} ${legalForm}` : tradeName,
      tradeName,
      siren: input.siren ?? siren(this.faker),
      email: `${local}@${slugify(tradeName)}.fr`,
      contactName: `${this.faker.person.firstName()} ${lastName}`,
      phone: `0${int(this.faker, 1, 5)} ${this.faker.string.numeric(2)} ${this.faker.string.numeric(2)} ${this.faker.string.numeric(2)} ${this.faker.string.numeric(2)}`,
      address: {
        street: this.faker.location.streetAddress(),
        postalCode: this.faker.location.zipCode(),
        city: this.faker.location.city(),
      },
      language: 'fr',
      businessIndex: input.businessIndex,
    };
    this.clients.push(client);
    return client;
  }

  private addEnglishClient(input: {
    brokerage: Brokerage;
    businessIndex: number;
    english: { faker: Faker; companyName?: string; email?: string; city?: string };
  }): Client {
    const { faker } = input.english;
    const business = BUSINESSES_EN[input.businessIndex]!;
    let tradeName = input.english.companyName;
    while (!tradeName || this.usedNames.has(tradeName)) {
      tradeName = `${faker.person.lastName()} ${business.prefix}`;
    }
    this.usedNames.add(tradeName);
    const contactLastName = faker.person.lastName();
    const client: Client = {
      id: `cli-${String(this.clients.length + 1).padStart(3, '0')}`,
      brokerageId: input.brokerage.id,
      companyName: input.english.companyName ?? `${tradeName} SAS`,
      tradeName,
      // Companies established in France: they still have a SIREN.
      siren: siren(faker),
      email:
        input.english.email ??
        `${pick(faker, ['contact', 'office', 'facilities', 'admin'])}@${slugify(tradeName)}.com`,
      contactName: `${faker.person.firstName()} ${contactLastName}`,
      phone: `+33 ${int(faker, 1, 5)} ${faker.string.numeric(2)} ${faker.string.numeric(2)} ${faker.string.numeric(2)} ${faker.string.numeric(2)}`,
      address: {
        street: `${int(faker, 1, 120)} ${pick(faker, ['rue de la République', 'avenue Jean Jaurès', 'quai Perrache', 'rue Garibaldi', 'boulevard Haussmann'])}`,
        postalCode: pick(faker, ['69002', '69007', '75008', '75011', '33000']),
        city: input.english.city ?? pick(faker, ['Lyon', 'Paris', 'Bordeaux']),
      },
      language: 'en',
      businessIndex: input.businessIndex,
    };
    this.clients.push(client);
    return client;
  }

  // --- Policies ---

  private policyNumber(product: ProductDefinition, faker: Faker = this.faker): string {
    let number: string;
    do {
      number = `${product.numberPrefix}-${int(faker, 10_000, 99_999)}`;
    } while (this.usedNumbers.has(number));
    this.usedNumbers.add(number);
    return number;
  }

  addPolicy(input: {
    client: Client;
    product: ProductDefinition;
    number?: string;
    insurerId?: string;
    status?: PolicyStatus;
    endReason?: PolicyEndReason | null;
    endDate?: string | null;
    knownStatus?: PolicyStatus;
    /** Faker used for the random parts (the English part uses its own). */
    faker?: Faker;
    coverageOverrides?: Partial<Record<Peril, { limit: number; deductible: number }>>;
    vehicles?: Omit<Vehicle, 'policyNumber'>[];
  }): ExtranetPolicy {
    const faker = input.faker ?? this.faker;
    const number = input.number ?? this.policyNumber(input.product, faker);
    this.usedNumbers.add(number);
    const insurer = insurerById(input.insurerId ?? pick(faker, INSURERS).id);
    const brokerage = this.brokerages.find(
      (candidate) => candidate.id === input.client.brokerageId,
    )!;
    // The insurer writes its contracts in its own language.
    const english = insurer.locale === 'en';
    const coverages: ExtranetCoverage[] = input.product.perils.map((peril) => {
      const definition = PERILS[peril];
      const wording = english ? PERILS_EN[peril] : definition;
      const override = input.coverageOverrides?.[peril];
      return {
        peril,
        label: wording.label,
        limit: override?.limit ?? pick(faker, definition.limits),
        deductible: override?.deductible ?? pick(faker, definition.deductibles),
        exclusions: wording.exclusions.map((exclusion) => exclusion.label),
        clauseRef: coverageClauseRef(insurer, peril),
      };
    });
    const productLabel = english ? PRODUCT_LABELS_EN[input.product.id] : input.product.label;
    const status = input.status ?? 'active';
    const policy: ExtranetPolicy = {
      number,
      insurerId: insurer.id,
      holderName: input.client.companyName,
      holderSiren: input.client.siren,
      brokerCode: brokerage.brokerCode,
      product: productLabel,
      status,
      startDate: addDays(this.referenceDate, -int(faker, 200, 2_000)),
      endDate: input.endDate ?? null,
      endReason: input.endReason ?? null,
      coverages,
    };
    this.policies.push(policy);
    this.brokeragePolicies.push({
      number,
      clientId: input.client.id,
      insurerName: insurer.name,
      product: productLabel,
      knownStatus: input.knownStatus ?? status,
      renewalDate: addDays(this.referenceDate, int(faker, 10, 360)),
    });
    if (input.product.id === 'fleet') this.addVehicles(number, input.vehicles);
    return policy;
  }

  private addVehicles(policyNumber: string, fixed: Omit<Vehicle, 'policyNumber'>[] = []): void {
    const plate = () => {
      const letters = () =>
        this.faker.string.alpha({ length: 2, casing: 'upper', exclude: ['I', 'O', 'U'] });
      return `${letters()}-${this.faker.string.numeric(3)}-${letters()}`;
    };
    const count = Math.max(fixed.length, int(this.faker, 2, 5));
    for (let index = 0; index < count; index++) {
      const vehicle = fixed[index] ?? { plate: plate(), model: pick(this.faker, VEHICLE_MODELS) };
      this.vehicles.push({ policyNumber, ...vehicle });
    }
  }

  // --- Claims ---

  addClaim(
    input: Omit<ExtranetClaim, 'number'> & { number?: string },
    faker: Faker = this.faker,
  ): ExtranetClaim {
    let number = input.number;
    while (!number || this.usedNumbers.has(number)) {
      number = `S-${input.date.slice(0, 4)}-${faker.string.numeric(4)}`;
    }
    this.usedNumbers.add(number);
    const claim: ExtranetClaim = { ...input, number };
    this.claims.push(claim);
    return claim;
  }
}

/** Short description of a past claim, as an English-language insurer recorded it. */
function claimDescriptionEn(peril: Peril, client: Client): string {
  const area = client.language === 'en' ? businessOf(client).area : 'the premises';
  switch (peril) {
    case 'water_damage':
      return `Water leak in ${area}`;
    case 'fire':
      return `Fire in ${area}`;
    case 'theft':
      return 'Burglary: equipment stolen';
    case 'glass_breakage':
      return 'Replacement of a broken window';
    case 'vehicle_damage':
      return 'Vehicle damaged in a collision';
  }
}

/** Short description of a past claim, as the insurer recorded it. */
function claimDescription(peril: Peril, client: Client, vehicle?: Vehicle): string {
  const business = BUSINESSES[client.businessIndex]!;
  switch (peril) {
    case 'water_damage':
      return `Fuite d'eau dans ${business.area}`;
    case 'fire':
      return `Départ de feu dans ${business.area}`;
    case 'theft':
      return `Vol avec effraction : ${business.stolenItems}`;
    case 'glass_breakage':
      return vehicle
        ? `Remplacement du pare-brise du véhicule ${vehicle.plate} (${vehicle.model})`
        : `Remplacement de ${business.glass}`;
    case 'vehicle_damage':
      return `Dommages au véhicule ${vehicle?.plate ?? ''} après une collision`.trim();
  }
}

export function generateWorld(options: GenerateWorldOptions): World {
  const locales = options.locales ?? [options.locale ?? 'fr'];
  const english = locales.includes('en');
  const mix = { en: english ? (options.mix?.en ?? 0.3) : 0 };
  const referenceDate = options.referenceDate ?? DEFAULT_REFERENCE_DATE;
  const faker = createRandom(options.seed);
  const builder = new WorldBuilder(faker, referenceDate);
  const [delorme, vasseur] = BROKERAGES as [Brokerage, Brokerage];

  builder.addBroker(delorme, 'Sophie Marchal');
  builder.addBroker(delorme);
  builder.addBroker(vasseur);
  builder.addBroker(vasseur);

  // Showcase clients and policies (scenarios 1, 2 and 6 of the catalog).
  const bakery = builder.addClient({
    brokerage: delorme,
    businessIndex: businessIndex('Boulangerie'),
    lastName: 'Martin',
    legalForm: 'SARL',
    siren: '812456931',
    emailLocal: 'contact',
  });
  const transport = builder.addClient({
    brokerage: delorme,
    businessIndex: businessIndex('Transports'),
    lastName: 'Lefèvre',
    legalForm: 'SAS',
    emailLocal: 'contact',
  });
  const garage = builder.addClient({
    brokerage: delorme,
    businessIndex: businessIndex('Garage'),
    lastName: 'Bernard',
    legalForm: 'SARL',
    emailLocal: 'direction',
  });
  builder.addPolicy({
    client: bakery,
    product: PRODUCTS.multirisk,
    number: SHOWCASE.terminatedPolicy,
    insurerId: 'ins-horizon',
    status: 'terminated',
    endReason: 'non_payment',
    endDate: addDays(referenceDate, -48),
    knownStatus: 'active',
    coverageOverrides: { water_damage: { limit: 30_000, deductible: 300 } },
  });
  builder.addPolicy({
    client: transport,
    product: PRODUCTS.fleet,
    number: SHOWCASE.fleetPolicy,
    insurerId: 'ins-atlas',
    coverageOverrides: { glass_breakage: { limit: 5_000, deductible: 0 } },
    vehicles: [
      { plate: 'AB-456-EF', model: 'Renault Master' },
      { plate: 'GH-218-KL', model: 'Renault Master' },
      { plate: 'CD-731-MN', model: 'Iveco Daily' },
    ],
  });
  builder.addPolicy({ client: garage, product: PRODUCTS.multirisk, insurerId: 'ins-boreale' });

  // Filler clients, one primary policy each.
  const filler: Client[] = [];
  while (builder.clients.length < WORLD_SIZE.clients) {
    const client = builder.addClient({
      brokerage: pick(faker, BROKERAGES),
      businessIndex: int(faker, 0, BUSINESSES.length - 1),
    });
    filler.push(client);
    const business = BUSINESSES[client.businessIndex]!;
    builder.addPolicy({
      client,
      product: business.fleet === 'always' ? PRODUCTS.fleet : PRODUCTS.multirisk,
    });
  }

  // Secondary policies: the product each client does not have yet, fleet-prone businesses first.
  const secondaryOrder = faker.helpers.shuffle(filler).sort((a, b) => {
    const rank = (client: Client) =>
      ({ always: 0, sometimes: 1, never: 2 })[BUSINESSES[client.businessIndex]!.fleet];
    return rank(a) - rank(b);
  });
  for (const client of secondaryOrder) {
    if (builder.policies.length >= WORLD_SIZE.policies) break;
    const hasFleet = BUSINESSES[client.businessIndex]!.fleet === 'always';
    builder.addPolicy({ client, product: hasFleet ? PRODUCTS.multirisk : PRODUCTS.fleet });
  }

  // Status traps on filler policies: one mismatch like the showcase, one known termination, one
  // suspension the brokerage is unaware of.
  const fillerPolicies = faker.helpers.shuffle(builder.policies.slice(3));
  const statusChanges: {
    status: PolicyStatus;
    endReason: PolicyEndReason;
    knownStatus: PolicyStatus;
    terminated: boolean;
  }[] = [
    { status: 'terminated', endReason: 'non_payment', knownStatus: 'active', terminated: true },
    {
      status: 'terminated',
      endReason: 'client_request',
      knownStatus: 'terminated',
      terminated: true,
    },
    { status: 'suspended', endReason: 'non_payment', knownStatus: 'active', terminated: false },
  ];
  statusChanges.forEach((change, index) => {
    const policy = fillerPolicies[index]!;
    policy.status = change.status;
    policy.endReason = change.endReason;
    policy.endDate = change.terminated ? addDays(referenceDate, -int(faker, 30, 120)) : null;
    builder.brokeragePolicies.find((known) => known.number === policy.number)!.knownStatus =
      change.knownStatus;
  });

  const clientOf = (policy: ExtranetPolicy) =>
    builder.clients.find((client) => client.companyName === policy.holderName)!;
  const vehicleOf = (policy: ExtranetPolicy) =>
    builder.vehicles.find((vehicle) => vehicle.policyNumber === policy.number);

  // Claim history: the showcase claim on another vehicle, older settled claims, and a few recent
  // open claims that the duplicate scenario re-declares.
  builder.addClaim({
    number: SHOWCASE.fleetPriorClaim,
    policyNumber: SHOWCASE.fleetPolicy,
    date: addDays(referenceDate, -60),
    nature: 'glass_breakage',
    amount: 680,
    status: 'settled',
    description: claimDescription('glass_breakage', transport, {
      policyNumber: SHOWCASE.fleetPolicy,
      plate: 'GH-218-KL',
      model: 'Renault Master',
    }),
  });
  for (let index = 0; index < WORLD_SIZE.priorClaims; index++) {
    const policy = pick(faker, builder.policies);
    const coverage = pick(faker, policy.coverages);
    const [min, max] = PERILS[coverage.peril].amountRange;
    builder.addClaim({
      policyNumber: policy.number,
      date: addDays(referenceDate, -int(faker, 40, 500)),
      nature: coverage.peril,
      amount: roundTo(int(faker, min, max), 10),
      status: faker.helpers.weightedArrayElement([
        { value: 'settled' as const, weight: 4 },
        { value: 'rejected' as const, weight: 1 },
      ]),
      description: claimDescription(coverage.peril, clientOf(policy), vehicleOf(policy)),
    });
  }
  const openCandidates = faker.helpers
    .shuffle(builder.policies.slice(3))
    .filter((policy) => policy.status === 'active' && policy.product === PRODUCTS.multirisk.label)
    .slice(0, WORLD_SIZE.recentOpenClaims);
  for (const policy of openCandidates) {
    const peril = pick(faker, ['water_damage', 'fire', 'glass_breakage'] as const);
    const [min, max] = PERILS[peril].amountRange;
    builder.addClaim({
      policyNumber: policy.number,
      date: addDays(referenceDate, -int(faker, 3, 5)),
      nature: peril,
      amount: roundTo(int(faker, min, max), 10),
      status: 'open',
      description: claimDescription(peril, clientOf(policy)),
    });
  }

  // The English part is appended after the French one, with its own Faker: the French world is
  // the same with or without it.
  if (english) addEnglishPart(builder, options.seed, mix.en, referenceDate);
  const insurers = english ? ALL_INSURERS : INSURERS;

  return {
    seed: options.seed,
    locales,
    mix,
    referenceDate,
    brokerages: builder.brokerages,
    brokers: builder.brokers,
    clients: builder.clients,
    brokeragePolicies: builder.brokeragePolicies,
    insurers: insurers.map(({ id, name, locale }) => ({ id, name, locale })),
    clauses: insurers.flatMap(insurerClauses),
    policies: builder.policies,
    claims: builder.claims,
    vehicles: builder.vehicles,
  };
}

/**
 * English data (V4): an English-speaking brokerage, the English-language insurer Northbridge, and
 * English-speaking clients, some of them at French brokerages or French insurers so that e-mails,
 * clauses and the brokerage's language can differ (scenarios 12 to 14).
 */
function addEnglishPart(
  builder: WorldBuilder,
  seed: number,
  share: number,
  referenceDate: string,
): void {
  const faker = createEnglishRandom(seed);
  builder.brokerages.push(ENGLISH_BROKERAGE);
  builder.addBroker(ENGLISH_BROKERAGE, 'Olivia Hartley', faker);
  builder.addBroker(ENGLISH_BROKERAGE, undefined, faker);
  const [delorme, vasseur] = BROKERAGES as [Brokerage, Brokerage];

  // Scenario 13 showcase: English e-mail, French insurer, French brokerage.
  const brightwave = builder.addClient({
    brokerage: delorme,
    businessIndex: 0,
    english: {
      faker,
      companyName: 'Brightwave Solutions',
      email: SHOWCASE.crossLanguageClientEmail,
      city: 'Lyon',
    },
  });
  builder.addPolicy({
    client: brightwave,
    product: PRODUCTS.multirisk,
    number: SHOWCASE.crossLanguagePolicy,
    insurerId: 'ins-horizon',
    faker,
    coverageOverrides: { water_damage: { limit: 20_000, deductible: 300 } },
  });

  // English-speaking clients: mostly Hartley & Finch's (at Northbridge, a few at French insurers),
  // some foreign companies established in France at the French brokerages.
  const count = Math.max(4, Math.round(WORLD_SIZE.clients * share));
  const englishPolicies: ExtranetPolicy[] = [];
  for (let index = 1; index < count; index++) {
    const atEnglishBrokerage = index % 3 !== 0;
    const client = builder.addClient({
      brokerage: atEnglishBrokerage ? ENGLISH_BROKERAGE : pick(faker, [delorme, vasseur]),
      businessIndex: int(faker, 0, BUSINESSES_EN.length - 1),
      english: { faker },
    });
    const insurerId =
      atEnglishBrokerage && index % 4 !== 0 ? NORTHBRIDGE.id : pick(faker, INSURERS).id;
    englishPolicies.push(
      builder.addPolicy({ client, product: PRODUCTS.multirisk, insurerId, faker }),
    );
  }

  // French-speaking clients whose policy is at Northbridge: French e-mail, English clauses.
  for (const brokerage of [delorme, vasseur]) {
    const client = builder.addClient({
      brokerage,
      businessIndex: int(faker, 0, BUSINESSES.length - 1),
      lastName: faker.person.lastName(),
      legalForm: 'SAS',
      siren: siren(faker),
    });
    englishPolicies.push(
      builder.addPolicy({ client, product: PRODUCTS.multirisk, insurerId: NORTHBRIDGE.id, faker }),
    );
  }

  // Traps on English data: a policy Northbridge terminated that the brokerage believes active,
  // past claims, and a recent open claim the duplicate scenario can re-declare.
  const atNorthbridge = englishPolicies.filter((policy) => policy.insurerId === NORTHBRIDGE.id);
  const terminated = atNorthbridge[0];
  if (terminated) {
    terminated.status = 'terminated';
    terminated.endReason = 'non_payment';
    terminated.endDate = addDays(referenceDate, -int(faker, 30, 90));
    builder.brokeragePolicies.find((known) => known.number === terminated.number)!.knownStatus =
      'active';
  }
  const clientOf = (policy: ExtranetPolicy) =>
    builder.clients.find((client) => client.companyName === policy.holderName)!;
  const describe = (policy: ExtranetPolicy, peril: Peril) =>
    insurerById(policy.insurerId).locale === 'en'
      ? claimDescriptionEn(peril, clientOf(policy))
      : claimDescription(peril, clientOf(policy));
  for (const policy of englishPolicies.slice(1, 4)) {
    const coverage = pick(faker, policy.coverages);
    const [min, max] = PERILS[coverage.peril].amountRange;
    builder.addClaim(
      {
        policyNumber: policy.number,
        date: addDays(referenceDate, -int(faker, 60, 400)),
        nature: coverage.peril,
        amount: roundTo(int(faker, min, max), 10),
        status: 'settled',
        description: describe(policy, coverage.peril),
      },
      faker,
    );
  }
  const openTarget = atNorthbridge.find((policy) => policy.status === 'active');
  if (openTarget) {
    const [min, max] = PERILS.water_damage.amountRange;
    builder.addClaim(
      {
        policyNumber: openTarget.number,
        date: addDays(referenceDate, -int(faker, 3, 5)),
        nature: 'water_damage',
        amount: roundTo(int(faker, min, max), 10),
        status: 'open',
        description: describe(openTarget, 'water_damage'),
      },
      faker,
    );
  }
}
