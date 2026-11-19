import type { ExtranetClause, ExtranetInsurer, Peril } from '@demo/shared';
import { COVERAGE_CLAUSE_EN, generalClausesEn, PERILS_EN } from './english.js';
import { PERILS } from './perils.js';

/** Fictional insurers. Their general conditions ("CG") are fixed text, identical for every seed. */

export interface InsurerDefinition extends ExtranetInsurer {
  /** Two-letter code used in clause references (`CG-HZ-4.2`). */
  code: string;
  /** Claim declaration delay, in business days. */
  declarationDelayDays: number;
}

export const INSURERS: InsurerDefinition[] = [
  {
    id: 'ins-horizon',
    name: 'Assurances Horizon',
    locale: 'fr',
    code: 'HZ',
    declarationDelayDays: 5,
  },
  { id: 'ins-atlas', name: 'Mutuelle Atlas', locale: 'fr', code: 'AT', declarationDelayDays: 5 },
  {
    id: 'ins-boreale',
    name: 'Boréale Assurances',
    locale: 'fr',
    code: 'BO',
    declarationDelayDays: 10,
  },
];

/** English-language insurer, added with the English data (V4). */
export const NORTHBRIDGE: InsurerDefinition = {
  id: 'ins-northbridge',
  name: 'Northbridge Insurance',
  locale: 'en',
  code: 'NB',
  declarationDelayDays: 5,
};

export const ALL_INSURERS: InsurerDefinition[] = [...INSURERS, NORTHBRIDGE];

export function insurerById(id: string): InsurerDefinition {
  const insurer = ALL_INSURERS.find((candidate) => candidate.id === id);
  if (!insurer) throw new Error(`Unknown insurer ${id}`);
  return insurer;
}

/** General clause numbers, shared by every insurer. */
export const GENERAL_CLAUSES = {
  declarationDelay: '3.1',
  supportingDocuments: '3.2',
  termination: '12.1',
  suspension: '12.2',
} as const;

export function clauseRef(insurer: InsurerDefinition, clauseNumber: string): string {
  return `CG-${insurer.code}-${clauseNumber}`;
}

export function coverageClauseRef(insurer: InsurerDefinition, peril: Peril): string {
  return clauseRef(insurer, PERILS[peril].clauseNumber);
}

function generalClauses(insurer: InsurerDefinition): ExtranetClause[] {
  if (insurer.locale === 'en') {
    return Object.entries(generalClausesEn(insurer.declarationDelayDays)).map(
      ([number, [title, text]]) => ({
        ref: clauseRef(insurer, number),
        insurerId: insurer.id,
        title,
        text,
        general: true,
      }),
    );
  }
  const general = (number: string, title: string, text: string): ExtranetClause => ({
    ref: clauseRef(insurer, number),
    insurerId: insurer.id,
    title,
    text,
    general: true,
  });
  return [
    general(
      GENERAL_CLAUSES.declarationDelay,
      'Délai de déclaration des sinistres',
      `Sauf cas fortuit ou de force majeure, l'assuré doit déclarer tout sinistre à l'assureur, directement ou par l'intermédiaire de son courtier, dès qu'il en a connaissance et au plus tard dans un délai de ${insurer.declarationDelayDays} jours ouvrés. Ce délai est ramené à 2 jours ouvrés en cas de vol. Lorsque la déclaration est tardive, l'assureur peut opposer la déchéance de garantie s'il établit que le retard lui a causé un préjudice.`,
    ),
    general(
      GENERAL_CLAUSES.supportingDocuments,
      'Pièces justificatives',
      "L'assuré transmet à l'assureur tous les documents utiles à l'appréciation du sinistre : constat amiable ou déclaration circonstanciée, factures ou devis de réparation, récépissé de dépôt de plainte en cas de vol, rapport d'intervention des services de secours en cas d'incendie. Tant que ces pièces ne sont pas fournies, l'assureur ne peut se prononcer sur la prise en charge.",
    ),
    general(
      GENERAL_CLAUSES.termination,
      'Effets de la résiliation',
      "En cas de résiliation du contrat, quelle qu'en soit la cause, les garanties cessent à la date d'effet de la résiliation. Aucune garantie n'est acquise pour les sinistres survenus après cette date.",
    ),
    general(
      GENERAL_CLAUSES.suspension,
      'Suspension pour non-paiement de la prime',
      "À défaut de paiement d'une prime dans les dix jours de son échéance, la garantie est suspendue trente jours après la mise en demeure de l'assuré. Aucun sinistre survenu pendant la suspension n'est garanti.",
    ),
  ];
}

function coverageClauses(insurer: InsurerDefinition): ExtranetClause[] {
  if (insurer.locale === 'en') {
    return Object.values(PERILS).map((definition) => {
      const wording = PERILS_EN[definition.peril];
      return {
        ref: coverageClauseRef(insurer, definition.peril),
        insurerId: insurer.id,
        title: wording.label,
        text: [
          wording.guarantee,
          COVERAGE_CLAUSE_EN.limits,
          COVERAGE_CLAUSE_EN.excluded,
          ...wording.exclusions.map((exclusion) => `- ${exclusion.clauseText};`),
        ].join('\n'),
        general: false,
      };
    });
  }
  return Object.values(PERILS).map((definition) => {
    const exclusions = definition.exclusions.map((exclusion) => `- ${exclusion.clauseText} ;`);
    return {
      ref: coverageClauseRef(insurer, definition.peril),
      insurerId: insurer.id,
      title: definition.label,
      text: [
        definition.guarantee,
        'Les dommages sont indemnisés dans la limite du plafond et sous déduction de la franchise indiqués aux conditions particulières.',
        'Sont exclus :',
        ...exclusions,
      ].join('\n'),
      general: false,
    };
  });
}

export function insurerClauses(insurer: InsurerDefinition): ExtranetClause[] {
  return [...generalClauses(insurer), ...coverageClauses(insurer)];
}
