import { z } from 'zod';
import { IsoDateSchema, LocaleSchema } from './domain.js';

/**
 * V16: a supporting document as a structured model (an invoice, an incident report…), laid out as
 * a real-looking PDF by `@demo/documents`. The world generator builds these models; Core only ever
 * sees the PDF and extracts its text.
 */

const AddressedSchema = z.object({ name: z.string(), address: z.array(z.string()) });

export const InvoiceDocumentSchema = z.object({
  kind: z.enum(['invoice', 'quote']),
  language: LocaleSchema,
  issuer: AddressedSchema.extend({
    phone: z.string(),
    email: z.string(),
    siret: z.string(),
    vatNumber: z.string(),
    /** Colour of the simulated logo. */
    color: z.string(),
  }),
  client: AddressedSchema,
  number: z.string(),
  date: IsoDateSchema,
  /** Quotes only. */
  validUntil: IsoDateSchema.nullable(),
  /** What the work is about (claim nature, vehicle or place). */
  subject: z.string(),
  lines: z.array(
    z.object({ label: z.string(), quantity: z.number(), unitPrice: z.number().nullable() }),
  ),
  vatRate: z.number(),
  /** Null: the totals are unreadable (scenario 9: amount masked on a damaged scan). */
  totals: z.object({ net: z.number(), vat: z.number(), gross: z.number() }).nullable(),
  iban: z.string(),
});
export type InvoiceDocument = z.infer<typeof InvoiceDocumentSchema>;

export const IncidentReportDocumentSchema = z.object({
  kind: z.literal('incident_report'),
  language: LocaleSchema,
  /** `water`: water damage report; `vehicle`: car accident report; `statement`: written statement. */
  variant: z.enum(['water', 'vehicle', 'statement']),
  insured: AddressedSchema.extend({ siren: z.string(), policyNumber: z.string().nullable() }),
  /** Null: left blank (scenario 9). */
  date: IsoDateSchema.nullable(),
  time: z.string().nullable(),
  location: z.string(),
  /** Checkbox labels, and the ones that are ticked. */
  options: z.array(z.string()),
  checked: z.array(z.string()),
  circumstances: z.string(),
  damages: z.string(),
  vehicle: z.object({ plate: z.string(), model: z.string() }).nullable(),
  signedBy: z.string(),
  signedOn: IsoDateSchema,
});
export type IncidentReportDocument = z.infer<typeof IncidentReportDocumentSchema>;

export const PoliceReportDocumentSchema = z.object({
  kind: z.literal('police_report'),
  language: LocaleSchema,
  office: z.string(),
  procedureNumber: z.string(),
  complainant: z.string(),
  company: z.string(),
  offence: z.string(),
  date: IsoDateSchema.nullable(),
  location: z.string(),
  stolenItems: z.array(z.string()),
  registeredOn: IsoDateSchema,
});
export type PoliceReportDocument = z.infer<typeof PoliceReportDocumentSchema>;

export const FireReportDocumentSchema = z.object({
  kind: z.literal('fire_report'),
  language: LocaleSchema,
  service: z.string(),
  interventionNumber: z.string(),
  date: IsoDateSchema.nullable(),
  times: z.object({ call: z.string(), arrival: z.string(), end: z.string() }),
  address: z.string(),
  means: z.array(z.string()),
  nature: z.string(),
  observations: z.string(),
  officer: z.string(),
});
export type FireReportDocument = z.infer<typeof FireReportDocumentSchema>;

export const DocumentModelSchema = z.union([
  InvoiceDocumentSchema,
  IncidentReportDocumentSchema,
  PoliceReportDocumentSchema,
  FireReportDocumentSchema,
]);
export type DocumentModel = z.infer<typeof DocumentModelSchema>;

/** Printed labels of every document, per language (shared by the PDF and its text rendering). */
export const DOCUMENT_LABELS = {
  fr: {
    invoice: 'FACTURE',
    quote: 'DEVIS',
    number: 'N°',
    date: 'Date',
    validUntil: "Valable jusqu'au",
    client: 'Client',
    subject: 'Objet',
    designation: 'Désignation',
    quantity: 'Qté',
    unitPrice: 'P.U. HT',
    lineTotal: 'Total HT',
    net: 'Total HT',
    vat: 'TVA 20 %',
    gross: 'Total TTC',
    unreadable: 'zone illisible',
    payment:
      'Paiement à 30 jours fin de mois. Pénalités de retard : trois fois le taux légal. Indemnité forfaitaire pour frais de recouvrement : 40 €.',
    iban: 'IBAN',
    siret: 'SIRET',
    vatNumber: 'TVA intracom.',
    waterTitle: 'CONSTAT AMIABLE DE DÉGÂT DES EAUX',
    vehicleTitle: "CONSTAT AMIABLE D'ACCIDENT AUTOMOBILE",
    statementTitle: 'DÉCLARATION CIRCONSTANCIÉE DE SINISTRE',
    insured: 'Assuré',
    siren: 'SIREN',
    policy: 'N° de contrat',
    incidentDate: 'Date du sinistre',
    time: 'Heure',
    location: 'Lieu',
    notFilled: '(non renseignée)',
    circumstances: 'Circonstances',
    damages: 'Dommages constatés',
    vehicleA: 'Véhicule A (assuré)',
    vehicleB: 'Véhicule B',
    plate: 'Immatriculation',
    model: 'Marque, modèle',
    sketch: 'Croquis de l’accident (joint)',
    signature: "Signature de l'assuré",
    madeOn: 'Fait le',
    policeAuthority: "MINISTÈRE DE L'INTÉRIEUR — POLICE NATIONALE",
    policeTitle: 'RÉCÉPISSÉ DE DÉPÔT DE PLAINTE',
    procedure: 'N° de procédure',
    office: 'Service',
    complainant: 'Plaignant',
    acting: 'agissant pour',
    offence: 'Nature des faits',
    factsDate: 'Date des faits',
    stolen: 'Objets déclarés volés',
    registeredOn: 'Enregistré le',
    stamp: 'Cachet du service',
    fireTitle: "RAPPORT D'INTERVENTION",
    intervention: "N° d'intervention",
    interventionDate: "Date de l'intervention",
    call: 'Appel',
    arrival: 'Arrivée sur les lieux',
    end: 'Fin d’intervention',
    address: 'Adresse',
    means: 'Moyens engagés',
    nature: 'Nature',
    observations: 'Observations',
    officer: 'Chef d’agrès',
  },
  en: {
    invoice: 'INVOICE',
    quote: 'QUOTE',
    number: 'No.',
    date: 'Date',
    validUntil: 'Valid until',
    client: 'Customer',
    subject: 'Subject',
    designation: 'Description',
    quantity: 'Qty',
    unitPrice: 'Unit price',
    lineTotal: 'Amount',
    net: 'Total excl. VAT',
    vat: 'VAT 20%',
    gross: 'Total incl. VAT',
    unreadable: 'unreadable area',
    payment: 'Payment within 30 days. Late payment interest at three times the legal rate.',
    iban: 'IBAN',
    siret: 'Company no.',
    vatNumber: 'VAT no.',
    waterTitle: 'WATER DAMAGE REPORT',
    vehicleTitle: 'MOTOR ACCIDENT REPORT',
    statementTitle: 'INCIDENT REPORT',
    insured: 'Insured',
    siren: 'SIREN',
    policy: 'Policy number',
    incidentDate: 'Date of incident',
    time: 'Time',
    location: 'Place',
    notFilled: '(not filled in)',
    circumstances: 'Circumstances',
    damages: 'Damage observed',
    vehicleA: 'Vehicle A (insured)',
    vehicleB: 'Vehicle B',
    plate: 'Registration',
    model: 'Make, model',
    sketch: 'Sketch of the accident (attached)',
    signature: 'Signed by the insured',
    madeOn: 'Date',
    policeAuthority: 'METROPOLITAN POLICE SERVICE',
    policeTitle: 'CRIME REPORT — RECEIPT OF COMPLAINT',
    procedure: 'Crime reference',
    office: 'Station',
    complainant: 'Complainant',
    acting: 'on behalf of',
    offence: 'Offence',
    factsDate: 'Date of the offence',
    stolen: 'Items reported stolen',
    registeredOn: 'Registered on',
    stamp: 'Station stamp',
    fireTitle: 'INTERVENTION REPORT',
    intervention: 'Incident no.',
    interventionDate: 'Date of intervention',
    call: 'Call',
    arrival: 'Arrival on scene',
    end: 'End of intervention',
    address: 'Address',
    means: 'Resources',
    nature: 'Nature',
    observations: 'Remarks',
    officer: 'Officer in charge',
  },
} as const;

/** `1 234,50 €` (fr) or `EUR 1,234.50` (en). */
export function formatMoney(value: number, language: 'fr' | 'en'): string {
  const fixed = value.toFixed(2);
  const [units = '0', cents = '00'] = fixed.split('.');
  const grouped = units.replace(/\B(?=(\d{3})+(?!\d))/g, language === 'fr' ? ' ' : ',');
  return language === 'fr' ? `${grouped},${cents} €` : `EUR ${grouped}.${cents}`;
}

/** `16/11/2026` (fr) or `16 November 2026` (en). */
export function formatDocumentDate(date: string, language: 'fr' | 'en'): string {
  const value = new Date(`${date}T00:00:00Z`);
  return language === 'fr'
    ? value.toLocaleDateString('fr-FR', { timeZone: 'UTC' })
    : value.toLocaleDateString('en-GB', { timeZone: 'UTC', dateStyle: 'long' });
}

/**
 * The text a perfect parser would read in the document, page by page (`--- page N ---`). Kept on
 * generated e-mails as `extractedText`: evals and tests read it; the demo extracts the real PDF.
 */
export function documentText(model: DocumentModel): string {
  const l = DOCUMENT_LABELS[model.language];
  const date = (value: string | null) =>
    value ? formatDocumentDate(value, model.language) : l.notFilled;
  const money = (value: number) => formatMoney(value, model.language);
  const lines: string[] = [];
  switch (model.kind) {
    case 'invoice':
    case 'quote': {
      lines.push(
        model.issuer.name.toUpperCase(),
        ...model.issuer.address,
        `${l.siret} ${model.issuer.siret} — ${l.vatNumber} ${model.issuer.vatNumber}`,
        `${model.kind === 'invoice' ? l.invoice : l.quote} ${l.number} ${model.number}`,
        `${l.date} : ${date(model.date)}`,
      );
      if (model.validUntil) lines.push(`${l.validUntil} : ${date(model.validUntil)}`);
      lines.push(
        `${l.client} : ${model.client.name}, ${model.client.address.join(', ')}`,
        `${l.subject} : ${model.subject}`,
      );
      for (const line of model.lines) {
        lines.push(
          `${line.label} — ${line.quantity} × ${line.unitPrice === null ? l.unreadable : money(line.unitPrice)}`,
        );
      }
      if (model.totals) {
        lines.push(
          `${l.net} : ${money(model.totals.net)}`,
          `${l.vat} : ${money(model.totals.vat)}`,
          `${l.gross} : ${money(model.totals.gross)}`,
        );
      } else {
        lines.push(`${l.gross} : [${l.unreadable}]`);
      }
      lines.push(l.payment, `${l.iban} ${model.iban}`);
      return `--- page 1 ---\n${lines.join('\n')}`;
    }
    case 'incident_report': {
      const title =
        model.variant === 'water'
          ? l.waterTitle
          : model.variant === 'vehicle'
            ? l.vehicleTitle
            : l.statementTitle;
      lines.push(title, `${l.insured} : ${model.insured.name} — ${l.siren} ${model.insured.siren}`);
      if (model.insured.policyNumber) lines.push(`${l.policy} : ${model.insured.policyNumber}`);
      lines.push(`${l.incidentDate} : ${date(model.date)}`, `${l.location} : ${model.location}`);
      if (model.vehicle) {
        lines.push(`${l.plate} : ${model.vehicle.plate}`, `${l.model} : ${model.vehicle.model}`);
      }
      const page2 = [
        `${l.circumstances} : ${model.circumstances}`,
        ...model.checked.map((option) => `[x] ${option}`),
        `${l.damages} : ${model.damages}`,
        `${l.signature} : ${model.signedBy}`,
        `${l.madeOn} ${date(model.signedOn)}`,
      ];
      return `--- page 1 ---\n${lines.join('\n')}\n--- page 2 ---\n${page2.join('\n')}`;
    }
    case 'police_report':
      lines.push(
        l.policeAuthority,
        l.policeTitle,
        `${l.procedure} : ${model.procedureNumber}`,
        `${l.office} : ${model.office}`,
        `${l.complainant} : ${model.complainant}, ${l.acting} ${model.company}`,
        `${l.offence} : ${model.offence}`,
        `${l.factsDate} : ${date(model.date)}`,
        `${l.location} : ${model.location}`,
        `${l.stolen} : ${model.stolenItems.join(', ')}`,
        `${l.registeredOn} ${date(model.registeredOn)}`,
      );
      return `--- page 1 ---\n${lines.join('\n')}`;
    case 'fire_report':
      lines.push(
        model.service,
        l.fireTitle,
        `${l.intervention} : ${model.interventionNumber}`,
        `${l.interventionDate} : ${date(model.date)}`,
        `${l.call} : ${model.times.call} — ${l.arrival} : ${model.times.arrival} — ${l.end} : ${model.times.end}`,
        `${l.address} : ${model.address}`,
        `${l.means} : ${model.means.join(', ')}`,
        `${l.nature} : ${model.nature}`,
        `${l.observations} : ${model.observations}`,
        `${l.officer} : ${model.officer}`,
      );
      return `--- page 1 ---\n${lines.join('\n')}`;
  }
}
