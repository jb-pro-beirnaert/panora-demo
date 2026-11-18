import type { AttachmentInput, DocumentType, Peril } from '@demo/shared';
import type { Faker } from '@faker-js/faker';
import { REPAIRERS } from './catalog/businesses.js';
import { PERILS } from './catalog/perils.js';
import { addDays, frDate, frMoney, int, slugify } from './random.js';
import type { Client, Vehicle } from './types.js';

/** Simulated attachments: the text a document parser would extract, page by page. */

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
}

function pages(...contents: string[]): string {
  return contents
    .map((content, index) => `--- page ${index + 1} ---\n${content.trim()}`)
    .join('\n');
}

function pdf(fileName: string, ...contents: string[]): AttachmentInput {
  return { fileName, contentType: 'application/pdf', extractedText: pages(...contents) };
}

function incidentReport(ctx: AttachmentContext): AttachmentInput {
  const title = ctx.vehicle
    ? "CONSTAT AMIABLE D'ACCIDENT AUTOMOBILE"
    : ctx.peril === 'water_damage'
      ? 'CONSTAT AMIABLE DE DÉGÂT DES EAUX'
      : 'DÉCLARATION CIRCONSTANCIÉE DE SINISTRE';
  const date = ctx.dateUnreadable ? '(non renseignée)' : frDate(ctx.incidentDate);
  const fileName = ctx.peril === 'water_damage' ? 'constat.pdf' : 'constat_amiable.pdf';
  return pdf(
    fileName,
    `${title}
Assuré : ${ctx.client.companyName} — SIREN ${ctx.client.siren}
${ctx.policyNumber ? `N° de contrat : ${ctx.policyNumber}\n` : ''}Date du sinistre : ${date}
Lieu : ${ctx.location}
${ctx.vehicle ? `Véhicule : ${ctx.vehicle.model}, immatriculation ${ctx.vehicle.plate}\n` : ''}`,
    `Circonstances : ${ctx.circumstances}
Signature de l'assuré : ${ctx.client.contactName}
Fait le ${frDate(ctx.receivedDate)}`,
  );
}

function invoiceOrQuote(ctx: AttachmentContext, kind: 'invoice' | 'quote'): AttachmentInput {
  const repairer = `${REPAIRERS[ctx.peril]} ${ctx.faker.person.lastName()}`;
  const isInvoice = kind === 'invoice';
  const word = isInvoice ? 'FACTURE' : 'DEVIS';
  const issued = isInvoice ? ctx.receivedDate : addDays(ctx.receivedDate, -1);
  const nature = PERILS[ctx.peril].label.toLowerCase();
  const fileName = `${isInvoice ? 'facture' : 'devis'}_${slugify(REPAIRERS[ctx.peril])}.pdf`;
  let lines: string;
  if (ctx.amount === null) {
    lines = `Main d'œuvre ........ ▒▒▒,▒▒ €
Fournitures ......... ▒▒▒▒,▒▒ €
Total TTC : ▒ ▒▒▒,▒▒ €  [zone illisible : document scanné de travers]`;
  } else {
    const net = Math.round((ctx.amount / 1.2) * 100) / 100;
    const labour = Math.round(net * 0.4 * 100) / 100;
    lines = `Main d'œuvre ........ ${frMoney(labour)}
Fournitures ......... ${frMoney(Math.round((net - labour) * 100) / 100)}
Total HT : ${frMoney(net)}
TVA 20 % : ${frMoney(Math.round((ctx.amount - net) * 100) / 100)}
Total TTC : ${frMoney(ctx.amount)}`;
  }
  return pdf(
    fileName,
    `${repairer.toUpperCase()}
${word} N° ${issued.slice(0, 4)}-${int(ctx.faker, 100, 999)}
Date : ${frDate(issued)}
Client : ${ctx.client.companyName}, ${ctx.client.address.street}, ${ctx.client.address.postalCode} ${ctx.client.address.city}
Objet : réparation suite à sinistre ${nature}${ctx.vehicle ? ` — véhicule ${ctx.vehicle.plate}` : ''}
${lines}`,
  );
}

function policeReport(ctx: AttachmentContext): AttachmentInput {
  return pdf(
    'recepisse_plainte.pdf',
    `RÉCÉPISSÉ DE DÉPÔT DE PLAINTE
Commissariat de ${ctx.client.address.city}
Plaignant : ${ctx.client.contactName}, pour ${ctx.client.companyName}
Faits : vol avec effraction
Date des faits : ${ctx.dateUnreadable ? '(non renseignée)' : frDate(ctx.incidentDate)}
Lieu : ${ctx.location}
Enregistré le ${frDate(addDays(ctx.incidentDate, 1))}`,
  );
}

function fireReport(ctx: AttachmentContext): AttachmentInput {
  return pdf(
    'rapport_pompiers.pdf',
    `SERVICE DÉPARTEMENTAL D'INCENDIE ET DE SECOURS
RAPPORT D'INTERVENTION
Date de l'intervention : ${ctx.dateUnreadable ? '(non renseignée)' : frDate(ctx.incidentDate)}
Adresse : ${ctx.location}
Nature : feu de local professionnel
Observations : ${ctx.circumstances}`,
  );
}

function photos(ctx: AttachmentContext): AttachmentInput {
  return {
    fileName: 'photos_degats.jpg',
    contentType: 'image/jpeg',
    extractedText: `[Photo] Vue des dégâts : ${ctx.circumstances}`,
  };
}

export function buildAttachment(type: DocumentType, ctx: AttachmentContext): AttachmentInput {
  switch (type) {
    case 'incident_report':
      return incidentReport(ctx);
    case 'invoice':
    case 'quote':
      return invoiceOrQuote(ctx, type);
    case 'police_report':
      return policeReport(ctx);
    case 'fire_report':
      return fireReport(ctx);
    case 'photos':
    case 'other':
      return photos(ctx);
  }
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
