import type { DocumentType, Peril } from '@demo/shared';
import type { BusinessDefinition } from './businesses.js';
import type { ExclusionDefinition } from './perils.js';

/**
 * English wording (V4): perils and clauses of the English-language insurer, the businesses of the
 * English-speaking clients and the words used in their e-mails. Exclusions are listed in the same
 * order as the French catalog, so an exclusion has the same index in both languages.
 */

export interface PerilWording {
  label: string;
  guarantee: string;
  exclusions: ExclusionDefinition[];
}

export const PERILS_EN: Record<Peril, PerilWording> = {
  water_damage: {
    label: 'Water damage',
    guarantee:
      'We cover material damage to the insured property caused by accidental leaks, bursts or overflows of pipes that are not buried, of water appliances and of gutters, and by accidental seepage through roofs.',
    exclusions: [
      {
        label: 'poorly maintained roof',
        clauseText:
          'damage resulting from a lack of maintenance or repair of the roof that the insured was aware of',
        emailCause:
          'To be honest, the roof had been leaking for a few months and we had not called a roofer yet.',
      },
      {
        label: 'seepage through walls',
        clauseText: 'water seeping through walls and facades',
        emailCause:
          'The water came in through the front wall, which has been cracked for a long time, after the heavy rain of the last few days.',
      },
      {
        label: 'damp and rising damp',
        clauseText: 'damage caused by damp, condensation or rising damp',
        emailCause:
          'The walls have been damp for weeks because of rising damp from the ground, and the stock stored against the wall got damaged.',
      },
    ],
  },
  fire: {
    label: 'Fire',
    guarantee:
      'We cover material damage to the insured property caused by fire, explosion, implosion and lightning.',
    exclusions: [
      {
        label: 'electrical installation not inspected',
        clauseText:
          'damage resulting from an electrical installation that has not undergone the mandatory annual inspection',
        emailCause:
          'I should mention that the annual inspection of the electrical installation was not done this year: the electrician was due next month.',
      },
      {
        label: 'non-compliant storage of flammable liquids',
        clauseText:
          'damage made worse by flammable liquids stored outside a compliant room or safety cabinet',
        emailCause:
          'The fire spread very quickly because we were keeping cans of solvent in the room while waiting for the safety cabinet we had ordered.',
      },
    ],
  },
  theft: {
    label: 'Theft',
    guarantee:
      'We cover the loss, destruction or deterioration of the insured property following a theft or attempted theft committed by breaking into the premises, climbing in or using false keys.',
    exclusions: [
      {
        label: 'theft without break-in',
        clauseText: 'thefts committed without break-in, climbing in or use of false keys',
        emailCause:
          'There is no sign of a break-in: the back door had been left open during the lunch break.',
      },
      {
        label: 'theft by an employee',
        clauseText: "thefts committed by the insured's employees or with their complicity",
        emailCause:
          'We strongly suspect one of our employees, who had the keys and has not shown up since.',
      },
    ],
  },
  glass_breakage: {
    label: 'Glass breakage',
    guarantee:
      'We cover the accidental breakage of windows, glass panels, signs and windscreens of the insured property, including fitting and replacement costs.',
    exclusions: [
      {
        label: 'scratches and chips',
        clauseText: 'mere scratches, chips or flaking',
        emailCause:
          'It is not really broken: the surface is mostly covered in deep scratches after being cleaned with the wrong product.',
      },
    ],
  },
  vehicle_damage: {
    label: 'Accidental damage',
    guarantee:
      'We cover damage to the insured vehicle following a collision, an impact with a fixed or moving object, an overturn or an act of vandalism.',
    exclusions: [
      {
        label: 'driver without a valid licence',
        clauseText: 'damage occurring when the driver does not hold a valid driving licence',
        emailCause:
          'The driver, hired last week, admitted afterwards that his licence was suspended.',
      },
      {
        label: 'drink-driving',
        clauseText: 'damage occurring when the driver was under the influence of alcohol',
        emailCause: 'The police check on site showed our driver was over the legal alcohol limit.',
      },
    ],
  },
};

export const PRODUCT_LABELS_EN = {
  multirisk: 'Commercial multi-risk',
  fleet: 'Motor fleet',
} as const;

/** General clauses of the English-language insurer (same numbers as the French ones). */
export function generalClausesEn(declarationDelayDays: number): Record<string, [string, string]> {
  return {
    '3.1': [
      'Claim notification period',
      `Except in the event of an unforeseeable event or force majeure, the insured must notify the insurer of any claim, directly or through their broker, as soon as they become aware of it and at the latest within ${declarationDelayDays} working days. This period is reduced to 2 working days in the event of theft. When a claim is notified late, the insurer may refuse cover if it proves that the delay caused it a loss.`,
    ],
    '3.2': [
      'Supporting documents',
      'The insured sends the insurer every document needed to assess the claim: incident report or written statement of the circumstances, repair invoices or quotes, police report in the event of theft, fire brigade intervention report in the event of fire. Until these documents are provided, the insurer cannot decide whether the claim is covered.',
    ],
    '12.1': [
      'Effects of termination',
      'If the policy is terminated, for whatever reason, cover ends on the date the termination takes effect. No cover is provided for claims occurring after that date.',
    ],
    '12.2': [
      'Suspension for non-payment of the premium',
      'If a premium is not paid within ten days of its due date, cover is suspended thirty days after the insured has been given formal notice. No claim occurring during the suspension is covered.',
    ],
    '12.3': [
      'Cancellation by the insured',
      'The insured may cancel the policy at each renewal date, by letter or any other durable medium sent to the insurer or to their broker, with two months’ notice. A request received less than two months before the renewal date takes effect at the following renewal date. The policy and its cover remain in force until the cancellation takes effect.',
    ],
  };
}

export const COVERAGE_CLAUSE_EN = {
  limits:
    'Damage is compensated up to the limit and after deduction of the deductible stated in the schedule.',
  excluded: 'Exclusions:',
};

/** Kinds of companies the English-speaking clients run, with the English words used in e-mails. */
export const BUSINESSES_EN: BusinessDefinition[] = [
  {
    prefix: 'Solutions',
    area: 'the office',
    stolenItems: 'three laptops and a video projector',
    glass: 'the glass entrance door',
    fleet: 'never',
  },
  {
    prefix: 'Studio',
    area: 'the design studio',
    stolenItems: 'two workstations and a camera kit',
    glass: 'the shop window',
    fleet: 'never',
  },
  {
    prefix: 'Consulting',
    area: 'the meeting room',
    stolenItems: 'the laptops left in the meeting room',
    glass: 'the glass partition of the reception',
    fleet: 'never',
  },
  {
    prefix: 'Café',
    area: 'the kitchen',
    stolenItems: 'the till and the coffee machine',
    glass: 'the front window',
    fleet: 'never',
  },
  {
    prefix: 'Labs',
    area: 'the lab',
    stolenItems: 'two microscopes and the lab computers',
    glass: 'the lab window',
    fleet: 'never',
  },
];

export const REPAIRERS_EN: Record<Peril, string> = {
  water_damage: 'Plumbing',
  fire: 'Restoration',
  theft: 'Locksmiths',
  glass_breakage: 'Glazing',
  vehicle_damage: 'Body Shop',
};

/** English noun phrase for a document type, used in e-mail bodies ("the incident report"). */
export const DOCUMENT_NOUNS_EN: Record<DocumentType, string> = {
  incident_report: 'the incident report',
  invoice: 'the invoice',
  quote: 'the quote',
  police_report: 'the police report',
  fire_report: 'the fire brigade report',
  photos: 'some photos',
  other: 'a document',
};
