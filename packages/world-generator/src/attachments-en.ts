import type { AttachmentInput, DocumentType } from '@demo/shared';
import type { AttachmentContext } from './attachments.js';
import { PERILS_EN, REPAIRERS_EN } from './catalog/english.js';
import { addDays, enDate, enMoney, int, slugify } from './random.js';

/** Simulated attachments of English-speaking clients: the text a parser would extract. */

function pages(...contents: string[]): string {
  return contents
    .map((content, index) => `--- page ${index + 1} ---\n${content.trim()}`)
    .join('\n');
}

function pdf(fileName: string, ...contents: string[]): AttachmentInput {
  return { fileName, contentType: 'application/pdf', extractedText: pages(...contents) };
}

const dateOrBlank = (ctx: AttachmentContext) =>
  ctx.dateUnreadable ? '(not filled in)' : enDate(ctx.incidentDate);

function incidentReport(ctx: AttachmentContext): AttachmentInput {
  return pdf(
    'incident_report.pdf',
    `INCIDENT REPORT
Insured: ${ctx.client.companyName} — SIREN ${ctx.client.siren}
${ctx.policyNumber ? `Policy number: ${ctx.policyNumber}\n` : ''}Date of incident: ${dateOrBlank(ctx)}
Place: ${ctx.location}
${ctx.vehicle ? `Vehicle: ${ctx.vehicle.model}, registration ${ctx.vehicle.plate}\n` : ''}`,
    `Circumstances: ${ctx.circumstances}
Signed by the insured: ${ctx.client.contactName}
Date: ${enDate(ctx.receivedDate)}`,
  );
}

function invoiceOrQuote(ctx: AttachmentContext, kind: 'invoice' | 'quote'): AttachmentInput {
  const trade = REPAIRERS_EN[ctx.peril];
  const repairer = `${ctx.faker.person.lastName()} ${trade}`;
  const isInvoice = kind === 'invoice';
  const issued = isInvoice ? ctx.receivedDate : addDays(ctx.receivedDate, -1);
  const fileName = `${isInvoice ? 'invoice' : 'quote'}_${slugify(trade)}.pdf`;
  let lines: string;
  if (ctx.amount === null) {
    lines = `Labour .............. EUR ▒▒▒.▒▒
Parts ............... EUR ▒,▒▒▒.▒▒
Total incl. VAT: EUR ▒,▒▒▒.▒▒  [unreadable area: document scanned askew]`;
  } else {
    const net = Math.round((ctx.amount / 1.2) * 100) / 100;
    const labour = Math.round(net * 0.4 * 100) / 100;
    lines = `Labour .............. ${enMoney(labour)}
Parts ............... ${enMoney(Math.round((net - labour) * 100) / 100)}
Total excl. VAT: ${enMoney(net)}
VAT 20%: ${enMoney(Math.round((ctx.amount - net) * 100) / 100)}
Total incl. VAT: ${enMoney(ctx.amount)}`;
  }
  return pdf(
    fileName,
    `${repairer.toUpperCase()}
${isInvoice ? 'INVOICE' : 'QUOTE'} No. ${issued.slice(0, 4)}-${int(ctx.faker, 100, 999)}
Date: ${enDate(issued)}
Customer: ${ctx.client.companyName}, ${ctx.client.address.street}, ${ctx.client.address.postalCode} ${ctx.client.address.city}
Subject: repairs after ${PERILS_EN[ctx.peril].label.toLowerCase()}${ctx.vehicle ? ` — vehicle ${ctx.vehicle.plate}` : ''}
${lines}`,
  );
}

function policeReport(ctx: AttachmentContext): AttachmentInput {
  return pdf(
    'police_report.pdf',
    `POLICE REPORT — RECEIPT OF COMPLAINT
Police station of ${ctx.client.address.city}
Complainant: ${ctx.client.contactName}, for ${ctx.client.companyName}
Offence: burglary
Date of the offence: ${dateOrBlank(ctx)}
Place: ${ctx.location}
Registered on ${enDate(addDays(ctx.incidentDate, 1))}`,
  );
}

function fireReport(ctx: AttachmentContext): AttachmentInput {
  return pdf(
    'fire_brigade_report.pdf',
    `FIRE AND RESCUE SERVICE
INTERVENTION REPORT
Date of intervention: ${dateOrBlank(ctx)}
Address: ${ctx.location}
Nature: fire in business premises
Remarks: ${ctx.circumstances}`,
  );
}

function photos(ctx: AttachmentContext): AttachmentInput {
  return {
    fileName: 'damage_photos.jpg',
    contentType: 'image/jpeg',
    extractedText: `[Photo] View of the damage: ${ctx.circumstances}`,
  };
}

export function buildAttachmentEn(type: DocumentType, ctx: AttachmentContext): AttachmentInput {
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
