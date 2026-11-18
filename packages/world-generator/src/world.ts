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
import { BUSINESSES, LEGAL_FORMS, VEHICLE_MODELS } from './catalog/businesses.js';
import { INSURERS, coverageClauseRef, insurerById, insurerClauses } from './catalog/insurers.js';
import { PERILS, PRODUCTS, type ProductDefinition } from './catalog/perils.js';
import { addDays, createRandom, int, pick, roundTo, siren, slugify } from './random.js';
import type { Broker, Brokerage, BrokeragePolicy, Client, Vehicle, World } from './types.js';

export interface GenerateWorldOptions {
  seed: number;
  locale: Locale;
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
} as const;

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
  private readonly usedNumbers = new Set<string>();
  private readonly usedNames = new Set<string>();

  constructor(
    private readonly faker: Faker,
    private readonly referenceDate: string,
  ) {}

  // --- Brokers ---

  addBroker(brokerage: Brokerage, name?: string): void {
    const fullName = name ?? `${this.faker.person.firstName()} ${this.faker.person.lastName()}`;
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
  }): Client {
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
      businessIndex: input.businessIndex,
    };
    this.clients.push(client);
    return client;
  }

  // --- Policies ---

  private policyNumber(product: ProductDefinition): string {
    let number: string;
    do {
      number = `${product.numberPrefix}-${int(this.faker, 10_000, 99_999)}`;
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
    coverageOverrides?: Partial<Record<Peril, { limit: number; deductible: number }>>;
    vehicles?: Omit<Vehicle, 'policyNumber'>[];
  }): ExtranetPolicy {
    const number = input.number ?? this.policyNumber(input.product);
    this.usedNumbers.add(number);
    const insurer = insurerById(input.insurerId ?? pick(this.faker, INSURERS).id);
    const brokerage = BROKERAGES.find((candidate) => candidate.id === input.client.brokerageId)!;
    const coverages: ExtranetCoverage[] = input.product.perils.map((peril) => {
      const definition = PERILS[peril];
      const override = input.coverageOverrides?.[peril];
      return {
        peril,
        label: definition.label,
        limit: override?.limit ?? pick(this.faker, definition.limits),
        deductible: override?.deductible ?? pick(this.faker, definition.deductibles),
        exclusions: definition.exclusions.map((exclusion) => exclusion.label),
        clauseRef: coverageClauseRef(insurer, peril),
      };
    });
    const status = input.status ?? 'active';
    const policy: ExtranetPolicy = {
      number,
      insurerId: insurer.id,
      holderName: input.client.companyName,
      holderSiren: input.client.siren,
      brokerCode: brokerage.brokerCode,
      product: input.product.label,
      status,
      startDate: addDays(this.referenceDate, -int(this.faker, 200, 2_000)),
      endDate: input.endDate ?? null,
      endReason: input.endReason ?? null,
      coverages,
    };
    this.policies.push(policy);
    this.brokeragePolicies.push({
      number,
      clientId: input.client.id,
      insurerName: insurer.name,
      product: input.product.label,
      knownStatus: input.knownStatus ?? status,
      renewalDate: addDays(this.referenceDate, int(this.faker, 10, 360)),
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

  addClaim(input: Omit<ExtranetClaim, 'number'> & { number?: string }): ExtranetClaim {
    let number = input.number;
    while (!number || this.usedNumbers.has(number)) {
      number = `S-${input.date.slice(0, 4)}-${this.faker.string.numeric(4)}`;
    }
    this.usedNumbers.add(number);
    const claim: ExtranetClaim = { ...input, number };
    this.claims.push(claim);
    return claim;
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

  return {
    seed: options.seed,
    locale: options.locale,
    referenceDate,
    brokerages: BROKERAGES,
    brokers: builder.brokers,
    clients: builder.clients,
    brokeragePolicies: builder.brokeragePolicies,
    insurers: INSURERS.map(({ id, name, locale }) => ({ id, name, locale })),
    clauses: INSURERS.flatMap(insurerClauses),
    policies: builder.policies,
    claims: builder.claims,
    vehicles: builder.vehicles,
  };
}
