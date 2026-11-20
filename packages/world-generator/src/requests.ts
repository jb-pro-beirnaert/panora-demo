import type {
  ClaimGroundTruth,
  ExtranetPolicy,
  Locale,
  RequestGroundTruth,
  RequestScenarioId,
} from '@demo/shared';
import { buildAttachmentEn } from './attachments-en.js';
import { buildAttachment, type AttachmentContext } from './attachments.js';
import { PERILS_EN } from './catalog/english.js';
import { CANCELLATION_NOTICE_MONTHS } from './catalog/insurers.js';
import { PERILS } from './catalog/perils.js';
import type { EmailFactory } from './emails.js';
import {
  addDays,
  enDate,
  frDate,
  frShortDate,
  enShortDate,
  int,
  isoDateTime,
  pick,
  roundTo,
} from './random.js';
import type { Client, GeneratedEmail } from './types.js';
import { businessOf } from './world.js';

/** V15 requests that are not claims: cancellations, questions, unrelated e-mails, follow-ups. */

function addMonths(date: string, months: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
}

/**
 * Date a cancellation received on `received` takes effect (clause 12.3): the next renewal date
 * with two months' notice, otherwise the following one.
 */
export function cancellationEffectiveDate(renewalDate: string, received: string): string {
  return addMonths(received, CANCELLATION_NOTICE_MONTHS) <= renewalDate
    ? renewalDate
    : addMonths(renewalDate, 12);
}

const SUPPLIERS = [
  {
    name: 'Bureautique Pro',
    email: 'facturation@bureautique-pro.fr',
    item: 'Fournitures de bureau',
  },
  {
    name: 'Net & Clean Services',
    email: 'compta@netclean-services.fr',
    item: 'Entretien des locaux',
  },
];

interface Common {
  factory: EmailFactory;
  index: number;
}

function inbox(factory: EmailFactory): { id: string; email: string; brokerCode: string } {
  const brokerage = factory.world.brokerages[0]!;
  return { id: brokerage.id, email: brokerage.inboxEmail, brokerCode: brokerage.brokerCode };
}

function truth(
  factory: EmailFactory,
  language: Locale,
  fields: Omit<
    RequestGroundTruth,
    'brokerCode' | 'emailLanguage' | 'expectedDraftLanguage' | 'expectedNoteLanguage'
  >,
): RequestGroundTruth {
  const { brokerCode } = inbox(factory);
  return { ...fields, brokerCode, ...factory.languages(language, brokerCode) };
}

function clientOf(factory: EmailFactory, policy: ExtranetPolicy): Client {
  return factory.world.clients.find((client) => client.companyName === policy.holderName)!;
}

/** Policies of clients writing in `language` (any language when none matches). */
function policiesIn(
  factory: EmailFactory,
  language: Locale,
  accept: (policy: ExtranetPolicy) => boolean,
): ExtranetPolicy[] {
  const accepted = factory.world.policies.filter(accept);
  const inLanguage = accepted.filter((policy) => clientOf(factory, policy).language === language);
  return inLanguage.length > 0 ? inLanguage : accepted;
}

function greet(factory: EmailFactory, client: Client): string {
  const { id } = inbox(factory);
  return client.language === 'en' ? factory.greetingEn(id) : factory.greeting(id);
}

function sign(factory: EmailFactory, client: Client): string {
  return client.language === 'en' ? factory.signatureEn(client) : factory.signature(client);
}

function email(
  common: Common,
  content: {
    from: string;
    subject: string;
    body: string;
    receivedAt: string;
    attachments?: GeneratedEmail['email']['attachments'];
    inReplyTo?: string;
  },
): GeneratedEmail['email'] {
  return {
    messageId: common.factory.messageId(common.index),
    receivedAt: content.receivedAt,
    from: content.from,
    to: inbox(common.factory).email,
    subject: content.subject,
    body: content.body,
    ...(content.inReplyTo ? { inReplyTo: content.inReplyTo } : {}),
    attachments: content.attachments ?? [],
  };
}

// --- Cancellations ---

function writeCancellation(
  common: Common,
  scenario: Extract<RequestScenarioId, `cancellation${string}`>,
  language: Locale,
): GeneratedEmail {
  const { factory } = common;
  const received = factory.receivedDate();
  const daysToRenewal = (policy: ExtranetPolicy) =>
    (Date.parse(policy.renewalDate) - Date.parse(received)) / 86_400_000;
  const free = (policy: ExtranetPolicy) => policy.status === 'active' && policy.endReason === null;
  const accept: Record<typeof scenario, (policy: ExtranetPolicy) => boolean> = {
    cancellation: (policy) => free(policy) && daysToRenewal(policy) >= 75,
    cancellation_late_notice: (policy) =>
      free(policy) && daysToRenewal(policy) > 5 && daysToRenewal(policy) < 50,
    cancellation_already_terminated: (policy) => policy.status === 'terminated',
    cancellation_already_requested: (policy) =>
      policy.status === 'active' && policy.endReason === 'client_request',
  };
  const policy = pick(factory.faker, policiesIn(factory, language, accept[scenario]));
  const client = clientOf(factory, policy);
  const english = client.language === 'en';
  const reasons = english
    ? ['We have found an offer that better suits our business.', 'We are closing this activity.']
    : [
        'Nous avons trouvé une offre plus adaptée à notre activité.',
        'Nous cessons cette activité.',
      ];
  // The late-notice client expects the next renewal date; the clause moves it a year later.
  const when =
    scenario === 'cancellation_late_notice'
      ? english
        ? `at its renewal date, ${enDate(policy.renewalDate)}`
        : `à son échéance du ${frDate(policy.renewalDate)}`
      : english
        ? 'at its next renewal date'
        : 'à sa prochaine échéance';
  const request = english
    ? `We would like to cancel our policy ${policy.number} (${policy.product}) ${when}. ${pick(factory.faker, reasons)} Could you confirm the cancellation?`
    : `Nous souhaitons résilier notre contrat ${policy.number} (${policy.product}) ${when}. ${pick(factory.faker, reasons)} Merci de nous confirmer la résiliation.`;
  const alerts: RequestGroundTruth['alerts'] = {
    cancellation: [],
    cancellation_late_notice: ['notice_period_not_met' as const],
    cancellation_already_terminated: ['already_terminated' as const],
    cancellation_already_requested: ['cancellation_already_requested' as const],
  }[scenario];
  const effectiveDate =
    scenario === 'cancellation' || scenario === 'cancellation_late_notice'
      ? cancellationEffectiveDate(policy.renewalDate, received)
      : scenario === 'cancellation_already_requested'
        ? policy.endDate
        : null;
  return {
    email: email(common, {
      from: client.email,
      subject: english
        ? `Cancellation of policy ${policy.number}`
        : pick(factory.faker, [
            `Résiliation du contrat ${policy.number}`,
            'Demande de résiliation',
          ]),
      body: [greet(factory, client), request, sign(factory, client)].join('\n\n'),
      receivedAt: factory.receivedAt(received),
    }),
    groundTruth: truth(factory, client.language, {
      scenario,
      requestType: 'cancellation',
      subtype: null,
      holderName: client.companyName,
      policyNumber: policy.number,
      policyNumberInEmail: true,
      expectedOutcome: 'action',
      expectedAction:
        scenario === 'cancellation' || scenario === 'cancellation_late_notice'
          ? 'cancel_policy'
          : 'send_status',
      handoverReason: null,
      alerts,
      effectiveDate,
      followUpOf: null,
    }),
  };
}

// --- Information requests ---

function writeCoverageQuestion(common: Common, language: Locale): GeneratedEmail {
  const { factory } = common;
  const policy = pick(
    factory.faker,
    policiesIn(factory, language, (candidate) => candidate.status === 'active'),
  );
  const client = clientOf(factory, policy);
  const coverage = pick(factory.faker, policy.coverages);
  const english = client.language === 'en';
  const topic = english
    ? PERILS_EN[coverage.peril].label.toLowerCase()
    : PERILS[coverage.peril].label.toLowerCase();
  const question = english
    ? `Does our policy ${policy.number} cover ${topic}? If so, what is the limit and how much is the deductible? We want to know before deciding on some work in ${businessOf(client).area}.`
    : `Notre contrat ${policy.number} couvre-t-il le risque « ${topic} » ? Si oui, quel est le plafond et quelle franchise resterait à notre charge ? Nous voulons le savoir avant d'engager des travaux dans ${businessOf(client).area}.`;
  return {
    email: email(common, {
      from: client.email,
      subject: english ? 'Question about our cover' : 'Question sur nos garanties',
      body: [greet(factory, client), question, sign(factory, client)].join('\n\n'),
      receivedAt: factory.receivedAt(factory.receivedDate()),
    }),
    groundTruth: truth(factory, client.language, {
      scenario: 'coverage_question',
      requestType: 'information',
      subtype: 'coverage_question',
      holderName: client.companyName,
      policyNumber: policy.number,
      policyNumberInEmail: true,
      expectedOutcome: 'action',
      expectedAction: 'answer_question',
      handoverReason: null,
      alerts: [],
      effectiveDate: null,
      followUpOf: null,
    }),
  };
}

function writeCertificateRequest(common: Common, language: Locale): GeneratedEmail {
  const { factory } = common;
  const policy = pick(
    factory.faker,
    policiesIn(factory, language, (candidate) => candidate.status === 'active'),
  );
  const client = clientOf(factory, policy);
  const english = client.language === 'en';
  const request = english
    ? `Could you send us an insurance certificate for our policy ${policy.number}? A customer asks for it for a tender, by the end of the week if possible.`
    : `Pourriez-vous nous adresser une attestation d'assurance pour notre contrat ${policy.number} ? Un client nous la demande pour un appel d'offres, si possible avant la fin de la semaine.`;
  return {
    email: email(common, {
      from: client.email,
      subject: english ? 'Insurance certificate' : "Demande d'attestation d'assurance",
      body: [greet(factory, client), request, sign(factory, client)].join('\n\n'),
      receivedAt: factory.receivedAt(factory.receivedDate()),
    }),
    groundTruth: truth(factory, client.language, {
      scenario: 'certificate_request',
      requestType: 'information',
      subtype: 'certificate',
      holderName: client.companyName,
      policyNumber: policy.number,
      policyNumberInEmail: true,
      expectedOutcome: 'needs_broker',
      expectedAction: 'acknowledge',
      handoverReason: 'certificate_request',
      alerts: [],
      effectiveDate: null,
      followUpOf: null,
    }),
  };
}

function writeQuoteRequest(common: Common, language: Locale): GeneratedEmail {
  const { factory } = common;
  const speakers = factory.world.clients.filter((client) => client.language === language);
  const client = pick(factory.faker, speakers.length > 0 ? speakers : factory.world.clients);
  const english = client.language === 'en';
  const business = businessOf(client);
  const request = english
    ? `${pick(factory.faker, ['We are opening a second site', 'We are moving to larger premises'])} ${pick(factory.faker, ['next month', 'early next year'])}. Could you send us a quote for a commercial multi-risk policy covering ${business.area} and the equipment?`
    : `${pick(factory.faker, ['Nous ouvrons un second établissement', 'Nous allons agrandir nos locaux'])} ${pick(factory.faker, ['le mois prochain', 'au début de l’année prochaine'])}. Pourriez-vous nous faire parvenir un devis pour une assurance multirisque professionnelle couvrant ${business.area} et le matériel ?`;
  return {
    email: email(common, {
      from: client.email,
      subject: english ? 'Insurance quote request' : 'Demande de devis assurance',
      body: [greet(factory, client), request, sign(factory, client)].join('\n\n'),
      receivedAt: factory.receivedAt(factory.receivedDate()),
    }),
    groundTruth: truth(factory, client.language, {
      scenario: 'quote_request',
      requestType: 'quote_request',
      subtype: null,
      holderName: client.companyName,
      policyNumber: null,
      policyNumberInEmail: false,
      expectedOutcome: 'needs_broker',
      expectedAction: 'acknowledge',
      handoverReason: 'quote_request',
      alerts: [],
      effectiveDate: null,
      followUpOf: null,
    }),
  };
}

// --- Unrelated e-mails ---

function writeUnrelated(
  common: Common,
  scenario: 'spam' | 'newsletter' | 'supplier_invoice',
  language: Locale,
): GeneratedEmail {
  const { factory } = common;
  const received = factory.receivedDate();
  const english = language === 'en';
  let content: {
    from: string;
    subject: string;
    body: string;
    attachments?: GeneratedEmail['email']['attachments'];
  };
  if (scenario === 'spam') {
    content = english
      ? {
          from: `growth@${pick(factory.faker, ['rank-boosters', 'leadsmagnet', 'seo-rocket'])}.com`,
          subject: 'Your website deserves page one on Google',
          body: 'Hi,\n\nOur experts can bring your website to the first page of Google in 30 days, guaranteed. Reply YES to get a free audit worth $499.\n\nCheers,\nThe Growth Team',
        }
      : {
          from: `contact@${pick(factory.faker, ['referencement-express', 'visibilite-pro', 'top-google-agence'])}.fr`,
          subject: 'Votre site mérite la première page de Google',
          body: 'Bonjour,\n\nNos experts placent votre site en première page de Google en 30 jours, garanti. Répondez OUI pour recevoir un audit gratuit d’une valeur de 490 €.\n\nÀ très vite,\nL’équipe Visibilité',
        };
  } else if (scenario === 'newsletter') {
    const insurer = pick(factory.faker, factory.world.insurers);
    const domain = insurer.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/[^a-z0-9]+/g, '-');
    content = english
      ? {
          from: `newsletter@${domain}.com`,
          subject: `${insurer.name} — partner newsletter, November`,
          body: `Dear partners,\n\nThis month: our new cyber-risk offer for small businesses, the updated claims portal, and the dates of our spring training sessions.\n\nRead the full newsletter on our partner portal.\n\n${insurer.name} — Partner relations\nTo unsubscribe, click here.`,
        }
      : {
          from: `newsletter@${domain}.fr`,
          subject: `La lettre des partenaires ${insurer.name} — novembre`,
          body: `Chers partenaires,\n\nAu sommaire ce mois-ci : notre nouvelle offre cyber pour les TPE, le portail sinistres modernisé et les dates des formations de printemps.\n\nRetrouvez la lettre complète sur votre espace partenaire.\n\n${insurer.name} — Relations partenaires\nPour vous désabonner, cliquez ici.`,
        };
  } else {
    const supplier = pick(factory.faker, SUPPLIERS);
    const amount = roundTo(int(factory.faker, 180, 900), 10);
    const net = Math.round((amount / 1.2) * 100) / 100;
    const brokerage = factory.world.brokerages[0]!;
    const invoice = {
      fileName: `facture_${supplier.name.toLowerCase().replace(/[^a-z]+/g, '_')}.pdf`,
      contentType: 'application/pdf',
      extractedText: `--- page 1 ---\n${supplier.name.toUpperCase()}\nFACTURE N° FA-${received.slice(0, 4)}-${int(factory.faker, 1000, 1999)}\nDate : ${frDate(received)}\nClient : ${brokerage.name}\nObjet : ${supplier.item} — ${received.slice(5, 7)}/${received.slice(0, 4)}\nTotal HT : ${net.toFixed(2).replace('.', ',')} €\nTotal TTC : ${amount.toFixed(2).replace('.', ',')} €\nÀ régler sous 30 jours par virement.`,
    };
    content = {
      from: supplier.email,
      subject: `Facture ${supplier.item.toLowerCase()} — ${brokerage.name}`,
      body: `Bonjour,\n\nVeuillez trouver ci-joint notre facture du mois pour ${supplier.item.toLowerCase()}.\n\nCordialement,\nService comptabilité\n${supplier.name}`,
      attachments: [invoice],
    };
  }
  return {
    email: email(common, { ...content, receivedAt: factory.receivedAt(received) }),
    groundTruth: truth(factory, scenario === 'supplier_invoice' ? 'fr' : language, {
      scenario,
      requestType: 'unrelated',
      subtype: scenario,
      holderName: null,
      policyNumber: null,
      policyNumberInEmail: false,
      expectedOutcome: 'classified',
      expectedAction: null,
      handoverReason: null,
      alerts: [],
      effectiveDate: null,
      followUpOf: null,
    }),
  };
}

/** One of the V15 request scenarios that do not depend on an earlier e-mail. */
export function writeRequest(
  factory: EmailFactory,
  index: number,
  scenario: Exclude<RequestScenarioId, 'follow_up' | 'follow_up_no_header'>,
  language: Locale,
): GeneratedEmail {
  const common = { factory, index };
  switch (scenario) {
    case 'cancellation':
    case 'cancellation_late_notice':
    case 'cancellation_already_terminated':
    case 'cancellation_already_requested':
      return writeCancellation(common, scenario, language);
    case 'coverage_question':
      return writeCoverageQuestion(common, language);
    case 'certificate_request':
      return writeCertificateRequest(common, language);
    case 'quote_request':
      return writeQuoteRequest(common, language);
    case 'spam':
    case 'newsletter':
    case 'supplier_invoice':
      return writeUnrelated(common, scenario, language);
  }
}

// --- Demo script only: e-mails about an earlier e-mail ---

/**
 * A follow-up of an earlier claim e-mail: with `In-Reply-To` and the documents that were missing,
 * or (no header) a "where is my claim?" written from scratch.
 */
export function writeFollowUp(
  factory: EmailFactory,
  index: number,
  original: GeneratedEmail,
  withHeader: boolean,
): GeneratedEmail {
  const truthOf = original.groundTruth as ClaimGroundTruth;
  const policy = factory.world.policies.find(
    (candidate) => candidate.number === truthOf.policyNumber,
  )!;
  const client = clientOf(factory, policy);
  const english = client.language === 'en';
  const receivedDate = addDays(original.email.receivedAt.slice(0, 10), 1);
  const common = { factory, index };
  let attachments: GeneratedEmail['email']['attachments'] = [];
  let body: string;
  if (withHeader) {
    const target = factory.target(policy, truthOf.nature);
    const context: AttachmentContext = {
      faker: factory.faker,
      client,
      peril: truthOf.nature,
      incidentDate: truthOf.incidentDate,
      receivedDate,
      policyNumber: policy.number,
      amount: roundTo(int(factory.faker, 2_400, 6_800), 10),
      dateUnreadable: false,
      location: factory.location(target),
      circumstances: english ? 'Fire started in the workshop.' : "Départ de feu dans l'atelier.",
      vehicle: target.vehicle,
    };
    const build = english ? buildAttachmentEn : buildAttachment;
    const required = truthOf.nature === 'fire' ? 'fire_report' : 'incident_report';
    attachments = [build(required, context), build('quote', context)];
    body = english
      ? 'As requested, please find attached the report and the repair quote.'
      : 'Suite à votre demande, vous trouverez ci-joint le rapport et le devis de réparation.';
  } else {
    const date = english
      ? enShortDate(original.email.receivedAt.slice(0, 10))
      : frShortDate(original.email.receivedAt.slice(0, 10));
    body = english
      ? `Further to my e-mail of ${date} about "${original.email.subject}", could you tell me where the claim stands?`
      : `Suite à mon e-mail du ${date} au sujet de « ${original.email.subject} », pourriez-vous me dire où en est la déclaration ?`;
  }
  return {
    email: email(common, {
      from: original.email.from,
      subject: withHeader
        ? `Re: ${original.email.subject}`
        : english
          ? 'Where does my claim stand?'
          : 'Où en est mon dossier ?',
      body: [greet(factory, client), body, sign(factory, client)].join('\n\n'),
      receivedAt: isoDateTime(receivedDate, int(factory.faker, 8, 17), int(factory.faker, 0, 59)),
      attachments,
      ...(withHeader ? { inReplyTo: original.email.messageId } : {}),
    }),
    groundTruth: truth(factory, client.language, {
      scenario: withHeader ? 'follow_up' : 'follow_up_no_header',
      requestType: 'follow_up',
      subtype: null,
      holderName: client.companyName,
      policyNumber: policy.number,
      policyNumberInEmail: withHeader,
      expectedOutcome: 'action',
      expectedAction: 'send_status',
      handoverReason: null,
      alerts: [],
      effectiveDate: null,
      followUpOf: original.email.messageId,
    }),
  };
}

/** The same claim sent again (new message): the agents must spot the open case (duplicate). */
export function writeResentClaim(
  factory: EmailFactory,
  index: number,
  original: GeneratedEmail,
): GeneratedEmail {
  const truthOf = original.groundTruth as ClaimGroundTruth;
  const english = truthOf.emailLanguage === 'en';
  const receivedDate = addDays(original.email.receivedAt.slice(0, 10), 1);
  return {
    email: {
      ...original.email,
      messageId: factory.messageId(index),
      receivedAt: isoDateTime(receivedDate, int(factory.faker, 8, 17), int(factory.faker, 0, 59)),
      subject: `${english ? 'Fwd' : 'TR'}: ${original.email.subject}`,
      body: `${english ? 'I am sending my e-mail again, I am not sure it reached you.' : "Je vous renvoie mon e-mail, je ne suis pas sûr qu'il vous soit parvenu."}\n\n${original.email.body}`,
    },
    groundTruth: {
      ...truthOf,
      scenario: 'resent_claim',
      reason: 'resent_claim',
      verdict: 'uncertain',
      alerts: ['duplicate_claim'],
      expectedAction: 'request_documents',
    },
  };
}
