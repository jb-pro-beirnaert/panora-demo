import {
  documentText,
  type AttachmentInput,
  type DocumentModel,
  type DocumentType,
  type InvoiceDocument,
  type Locale,
  type Peril,
} from '@demo/shared';
import type { Faker } from '@faker-js/faker';
import { REPAIRERS } from './catalog/businesses.js';
import { PERILS_EN, REPAIRERS_EN } from './catalog/english.js';
import { PERILS } from './catalog/perils.js';
import { addDays, int, slugify } from './random.js';
import type { Client, Vehicle } from './types.js';

/**
 * Supporting documents of a claim (V16): structured models — an invoice with its issuer and its
 * lines, a form-like incident report, a police receipt, a fire brigade report — that
 * `@demo/documents` lays out as real-looking PDFs. `extractedText` is the text a perfect parser
 * would read in it.
 */

export interface AttachmentContext {
  faker: Faker;
  client: Client;
  peril: Peril;
  incidentDate: string;
  receivedDate: string;
  /** Written on the incident report only when the e-mail is meant to carry the policy number. */
  policyNumber: string | null;
  /** Claimed amount; null makes the amount on the invoice or quote unreadable. */
  amount: number | null;
  /** Leaves the incident date blank on the incident report. */
  dateUnreadable: boolean;
  location: string;
  circumstances: string;
  vehicle: Vehicle | undefined;
  /** V18: printed invisibly in the invoice (prompt injection). */
  hiddenInstruction?: string | null;
}

/**
 * Details that do not matter to any scenario (SIRET, phone, IBAN…) come from a hash of the
 * document's identity, not from the shared faker: adding them does not shift the rest of the world.
 */
function stableRandom(key: string): () => number {
  let seed = 2166136261;
  for (const char of key) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function digits(random: () => number, count: number): string {
  return Array.from({ length: count }, () => Math.floor(random() * 10)).join('');
}

const LOGO_COLORS = ['#1d4ed8', '#047857', '#b45309', '#7c3aed', '#be123c', '#0f766e'];
const STREETS = {
  fr: ['rue des Artisans', 'avenue de la République', 'rue du Commerce', 'boulevard Voltaire'],
  en: ['Station Road', 'High Street', 'Mill Lane', 'Church Street'],
};

function addressLines(client: Client): string[] {
  return [client.address.street, `${client.address.postalCode} ${client.address.city}`];
}

function pdf(fileName: string, document: DocumentModel): AttachmentInput {
  return {
    fileName,
    contentType: 'application/pdf',
    extractedText: documentText(document),
    document,
  };
}

/** Labour and parts lines adding up to the claimed amount (taxes included, VAT 20 %). */
function invoiceLines(
  amount: number | null,
  peril: Peril,
  language: Locale,
): Pick<InvoiceDocument, 'lines' | 'totals'> {
  const wording =
    language === 'fr'
      ? {
          travel: 'Déplacement et diagnostic',
          labour: "Main d'œuvre (heures)",
          parts: `Fournitures — ${PERILS[peril].label.toLowerCase()}`,
        }
      : {
          travel: 'Call-out and diagnosis',
          labour: 'Labour (hours)',
          parts: `Parts and materials — ${PERILS_EN[peril].label.toLowerCase()}`,
        };
  if (amount === null) {
    return {
      lines: [
        { label: wording.travel, quantity: 1, unitPrice: null },
        { label: wording.labour, quantity: 4, unitPrice: null },
        { label: wording.parts, quantity: 1, unitPrice: null },
      ],
      totals: null,
    };
  }
  const net = Math.round((amount / 1.2) * 100) / 100;
  const travel = Math.min(60, Math.round(net * 0.1 * 100) / 100);
  const hours = Math.max(1, Math.round((net * 0.4) / 55));
  const hourly = Math.round(((net * 0.4) / hours) * 100) / 100;
  const parts = Math.round((net - travel - hours * hourly) * 100) / 100;
  return {
    lines: [
      { label: wording.travel, quantity: 1, unitPrice: travel },
      { label: wording.labour, quantity: hours, unitPrice: hourly },
      { label: wording.parts, quantity: 1, unitPrice: parts },
    ],
    totals: { net, vat: Math.round((amount - net) * 100) / 100, gross: amount },
  };
}

function invoiceOrQuote(
  ctx: AttachmentContext,
  kind: 'invoice' | 'quote',
  language: Locale,
): AttachmentInput {
  const english = language === 'en';
  const trade = english ? REPAIRERS_EN[ctx.peril] : REPAIRERS[ctx.peril];
  const lastName = ctx.faker.person.lastName();
  const name = english ? `${lastName} ${trade}` : `${trade} ${lastName}`;
  const isInvoice = kind === 'invoice';
  const issued = isInvoice ? ctx.receivedDate : addDays(ctx.receivedDate, -1);
  const number = `${issued.slice(0, 4)}-${int(ctx.faker, 100, 999)}`;
  const random = stableRandom(`${name}|${number}|${ctx.client.id}`);
  const siren = digits(random, 9);
  const domain = slugify(name).replace(/_/g, '-');
  const nature = english
    ? PERILS_EN[ctx.peril].label.toLowerCase()
    : PERILS[ctx.peril].label.toLowerCase();
  const document: InvoiceDocument = {
    kind,
    language,
    issuer: {
      name,
      address: [
        `${1 + Math.floor(random() * 120)} ${STREETS[language][Math.floor(random() * 4)]}`,
        `${ctx.client.address.postalCode} ${ctx.client.address.city}`,
      ],
      phone: english
        ? `+44 20 ${digits(random, 4)} ${digits(random, 4)}`
        : `0${1 + Math.floor(random() * 5)} ${digits(random, 2)} ${digits(random, 2)} ${digits(random, 2)} ${digits(random, 2)}`,
      email: `${english ? 'accounts' : 'contact'}@${domain}.${english ? 'co.uk' : 'fr'}`,
      siret: `${siren}${digits(random, 5)}`,
      vatNumber: `FR${digits(random, 2)}${siren}`,
      color: LOGO_COLORS[Math.floor(random() * LOGO_COLORS.length)]!,
    },
    client: { name: ctx.client.companyName, address: addressLines(ctx.client) },
    number,
    date: issued,
    validUntil: isInvoice ? null : addDays(issued, 30),
    subject: english
      ? `Repairs after ${nature}${ctx.vehicle ? ` — vehicle ${ctx.vehicle.plate}` : ''}`
      : `Réparation suite à sinistre ${nature}${ctx.vehicle ? ` — véhicule ${ctx.vehicle.plate}` : ''}`,
    ...invoiceLines(ctx.amount, ctx.peril, language),
    vatRate: 0.2,
    hiddenText: ctx.hiddenInstruction ?? null,
    iban: `FR76 ${digits(random, 4)} ${digits(random, 4)} ${digits(random, 4)} ${digits(random, 4)} ${digits(random, 4)} ${digits(random, 3)}`,
  };
  const fileName = english
    ? `${isInvoice ? 'invoice' : 'quote'}_${slugify(trade)}.pdf`
    : `${isInvoice ? 'facture' : 'devis'}_${slugify(trade)}.pdf`;
  return pdf(fileName, document);
}

const WATER_OPTIONS = {
  fr: ['Fuite de canalisation', 'Débordement', 'Infiltration', 'Rupture de joint'],
  en: ['Pipe leak', 'Overflow', 'Seepage', 'Seal failure'],
};
const STATEMENT_OPTIONS = {
  fr: ['Incendie', 'Vol avec effraction', 'Bris de glace', 'Autre'],
  en: ['Fire', 'Burglary', 'Glass breakage', 'Other'],
};
const VEHICLE_OPTIONS = {
  fr: [
    '1 — en stationnement',
    '8 — heurtait à l’arrière',
    '13 — virait à droite',
    '17 — obstacle fixe',
  ],
  en: ['1 — parked', '8 — hit from behind', '13 — turning right', '17 — fixed obstacle'],
};

function incidentReport(ctx: AttachmentContext, language: Locale): AttachmentInput {
  const english = language === 'en';
  const variant = ctx.vehicle ? 'vehicle' : ctx.peril === 'water_damage' ? 'water' : 'statement';
  const options =
    variant === 'water'
      ? WATER_OPTIONS[language]
      : variant === 'vehicle'
        ? VEHICLE_OPTIONS[language]
        : STATEMENT_OPTIONS[language];
  const checked =
    variant === 'water'
      ? [options[0]!]
      : variant === 'vehicle'
        ? [options[3]!]
        : [
            options[
              ctx.peril === 'fire'
                ? 0
                : ctx.peril === 'theft'
                  ? 1
                  : ctx.peril === 'glass_breakage'
                    ? 2
                    : 3
            ]!,
          ];
  const random = stableRandom(`${ctx.client.id}|${ctx.incidentDate}|report`);
  const fileName = english
    ? 'incident_report.pdf'
    : ctx.peril === 'water_damage'
      ? 'constat.pdf'
      : 'constat_amiable.pdf';
  return pdf(fileName, {
    kind: 'incident_report',
    language,
    variant,
    insured: {
      name: ctx.client.companyName,
      address: addressLines(ctx.client),
      siren: ctx.client.siren,
      policyNumber: ctx.policyNumber,
    },
    date: ctx.dateUnreadable ? null : ctx.incidentDate,
    time: ctx.dateUnreadable
      ? null
      : `${String(6 + Math.floor(random() * 14)).padStart(2, '0')}:${String(Math.floor(random() * 60)).padStart(2, '0')}`,
    location: ctx.location,
    options,
    checked,
    circumstances: ctx.circumstances,
    damages: english
      ? 'Damage to the premises and equipment, see photos and repair estimate.'
      : 'Dégâts aux locaux et au matériel, voir photos et devis de réparation.',
    vehicle: ctx.vehicle ? { plate: ctx.vehicle.plate, model: ctx.vehicle.model } : null,
    signedBy: ctx.client.contactName,
    signedOn: ctx.receivedDate,
  });
}

function policeReport(ctx: AttachmentContext, language: Locale): AttachmentInput {
  const english = language === 'en';
  const random = stableRandom(`${ctx.client.id}|${ctx.incidentDate}|police`);
  return pdf(english ? 'police_report.pdf' : 'recepisse_plainte.pdf', {
    kind: 'police_report',
    language,
    office: english
      ? `${ctx.client.address.city} Police Station`
      : `Commissariat de ${ctx.client.address.city}`,
    procedureNumber: english
      ? `CR/${digits(random, 7)}/${ctx.incidentDate.slice(2, 4)}`
      : `${ctx.incidentDate.slice(0, 4)}/${digits(random, 6)}`,
    complainant: ctx.client.contactName,
    company: ctx.client.companyName,
    offence: english ? 'Burglary' : 'Vol avec effraction',
    date: ctx.dateUnreadable ? null : ctx.incidentDate,
    location: ctx.location,
    stolenItems: english
      ? ['Cash register', 'Laptop', 'Stock items']
      : ['Caisse enregistreuse', 'Ordinateur portable', 'Marchandises en stock'],
    registeredOn: addDays(ctx.incidentDate, 1),
  });
}

function fireReport(ctx: AttachmentContext, language: Locale): AttachmentInput {
  const english = language === 'en';
  const random = stableRandom(`${ctx.client.id}|${ctx.incidentDate}|fire`);
  const hour = 1 + Math.floor(random() * 21);
  const at = (minutes: number) => {
    const total = hour * 60 + minutes;
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };
  return pdf(english ? 'fire_brigade_report.pdf' : 'rapport_pompiers.pdf', {
    kind: 'fire_report',
    language,
    service: english ? 'FIRE AND RESCUE SERVICE' : "SERVICE DÉPARTEMENTAL D'INCENDIE ET DE SECOURS",
    interventionNumber: `${ctx.incidentDate.slice(0, 4)}-${digits(random, 6)}`,
    date: ctx.dateUnreadable ? null : ctx.incidentDate,
    times: { call: at(0), arrival: at(9), end: at(95) },
    address: ctx.location,
    means: english
      ? ['1 fire engine', '1 ladder truck', '8 firefighters']
      : ['1 fourgon pompe-tonne', '1 échelle aérienne', '8 sapeurs-pompiers'],
    nature: english ? 'Fire in business premises' : 'Feu de local professionnel',
    observations: ctx.circumstances,
    officer: english
      ? `Station Officer ${ctx.faker.person.lastName()}`
      : `Lieutenant ${ctx.faker.person.lastName()}`,
  });
}

function photos(ctx: AttachmentContext, language: Locale): AttachmentInput {
  return {
    fileName: language === 'en' ? 'damage_photos.jpg' : 'photos_degats.jpg',
    contentType: 'image/jpeg',
    extractedText:
      language === 'en'
        ? `[Photo] View of the damage: ${ctx.circumstances}`
        : `[Photo] Vue des dégâts : ${ctx.circumstances}`,
  };
}

export function buildDocument(
  type: DocumentType,
  ctx: AttachmentContext,
  language: Locale,
): AttachmentInput {
  switch (type) {
    case 'incident_report':
      return incidentReport(ctx, language);
    case 'invoice':
    case 'quote':
      return invoiceOrQuote(ctx, type, language);
    case 'police_report':
      return policeReport(ctx, language);
    case 'fire_report':
      return fireReport(ctx, language);
    case 'photos':
    case 'other':
      return photos(ctx, language);
  }
}

export function buildAttachment(type: DocumentType, ctx: AttachmentContext): AttachmentInput {
  return buildDocument(type, ctx, 'fr');
}

/** French noun phrase for a document type, used in e-mail bodies ("le constat"). */
export const DOCUMENT_NOUNS: Record<DocumentType, string> = {
  incident_report: 'le constat',
  invoice: 'la facture',
  quote: 'le devis',
  police_report: 'le récépissé de dépôt de plainte',
  fire_report: "le rapport d'intervention des pompiers",
  photos: 'des photos',
  other: 'un document',
};
