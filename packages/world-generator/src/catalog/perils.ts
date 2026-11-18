import type { Peril } from '@demo/shared';

/**
 * French wording of each peril: coverage label, clause text and the way a client describes an
 * incident. Ranges are in euros.
 */

export interface ExclusionDefinition {
  /** Short label stored on the coverage. */
  label: string;
  /** Wording inside the clause ("Sont exclus : …"). */
  clauseText: string;
  /** Sentence a client writes that reveals the excluded cause. */
  emailCause: string;
}

export interface PerilDefinition {
  peril: Peril;
  label: string;
  /** Clause number inside every insurer's general conditions (`CG-XX-<number>`). */
  clauseNumber: string;
  guarantee: string;
  exclusions: ExclusionDefinition[];
  limits: number[];
  deductibles: number[];
  /** Typical claimed amount. */
  amountRange: [number, number];
  /** Whether the peril concerns a vehicle (fleet policy) rather than premises. */
  vehicle: boolean;
}

export const PERILS: Record<Peril, PerilDefinition> = {
  water_damage: {
    peril: 'water_damage',
    label: 'Dégât des eaux',
    clauseNumber: '4.2',
    guarantee:
      "Sont garantis les dommages matériels causés aux biens assurés par les fuites, ruptures ou débordements accidentels de conduites non enterrées, d'appareils à effet d'eau et de chéneaux, ainsi que par les infiltrations accidentelles au travers des toitures.",
    exclusions: [
      {
        label: "défaut d'entretien de la toiture",
        clauseText:
          "les dommages résultant d'un défaut d'entretien ou de réparation de la toiture, connu de l'assuré",
        emailCause:
          "Pour être honnête, la toiture fuyait déjà depuis plusieurs mois et nous n'avions pas encore fait venir le couvreur.",
      },
      {
        label: 'infiltrations par les façades',
        clauseText: "les infiltrations d'eau au travers des murs et façades",
        emailCause:
          "L'eau est entrée par le mur de façade, fissuré depuis longtemps, après les fortes pluies de ces derniers jours.",
      },
      {
        label: 'humidité et remontées par capillarité',
        clauseText:
          "les dommages dus à l'humidité, à la condensation ou aux remontées par capillarité",
        emailCause:
          "Les murs sont humides depuis des semaines à cause de remontées d'humidité du sol, et le stock posé contre le mur s'est abîmé.",
      },
    ],
    limits: [20_000, 30_000, 50_000],
    deductibles: [150, 300, 500],
    amountRange: [900, 6_000],
    vehicle: false,
  },
  fire: {
    peril: 'fire',
    label: 'Incendie',
    clauseNumber: '4.1',
    guarantee:
      "Sont garantis les dommages matériels causés aux biens assurés par l'incendie, l'explosion, l'implosion et la chute de la foudre.",
    exclusions: [
      {
        label: 'installation électrique non vérifiée',
        clauseText:
          "les dommages résultant d'une installation électrique n'ayant pas fait l'objet de la vérification annuelle obligatoire",
        emailCause:
          "Je précise que la vérification annuelle de l'installation électrique n'a pas été faite cette année : l'électricien devait passer le mois prochain.",
      },
      {
        label: 'stockage non conforme de liquides inflammables',
        clauseText:
          "les dommages aggravés par le stockage de liquides inflammables en dehors d'un local ou d'une armoire de sécurité conforme",
        emailCause:
          "Le feu a pris très vite parce que nous stockions des bidons de solvant dans la pièce, en attendant l'armoire de sécurité que nous avions commandée.",
      },
    ],
    limits: [100_000, 150_000, 300_000],
    deductibles: [500, 1_000, 1_500],
    amountRange: [4_000, 40_000],
    vehicle: false,
  },
  theft: {
    peril: 'theft',
    label: 'Vol',
    clauseNumber: '4.3',
    guarantee:
      "Sont garantis la disparition, la destruction ou la détérioration des biens assurés à la suite d'un vol ou d'une tentative de vol commis avec effraction des locaux, escalade ou usage de fausses clés.",
    exclusions: [
      {
        label: 'vol sans effraction',
        clauseText: 'les vols commis sans effraction, escalade ni usage de fausses clés',
        emailCause:
          "Il n'y a aucune trace d'effraction : la porte arrière était restée ouverte pendant la pause de midi.",
      },
      {
        label: 'vol commis par un préposé',
        clauseText: "les vols commis par les préposés de l'assuré ou avec leur complicité",
        emailCause:
          "Nous soupçonnons fortement un de nos salariés, qui avait les clés et ne s'est plus présenté depuis.",
      },
    ],
    limits: [10_000, 15_000, 25_000],
    deductibles: [300, 500, 750],
    amountRange: [1_500, 9_000],
    vehicle: false,
  },
  glass_breakage: {
    peril: 'glass_breakage',
    label: 'Bris de glace',
    clauseNumber: '7.1',
    guarantee:
      'Sont garantis le bris accidentel des vitrages, glaces, enseignes et pare-brise des biens assurés, y compris les frais de pose et de remplacement.',
    exclusions: [
      {
        label: 'rayures et écaillures',
        clauseText: 'les simples rayures, ébréchures ou écaillures',
        emailCause:
          "Ce n'est pas vraiment cassé : la surface est surtout couverte de rayures profondes après un nettoyage avec un produit inadapté.",
      },
    ],
    limits: [3_000, 5_000, 8_000],
    deductibles: [0, 0, 150],
    amountRange: [350, 2_500],
    vehicle: false,
  },
  vehicle_damage: {
    peril: 'vehicle_damage',
    label: 'Dommages tous accidents',
    clauseNumber: '7.2',
    guarantee:
      "Sont garantis les dommages subis par le véhicule assuré à la suite d'une collision, d'un choc contre un corps fixe ou mobile, d'un renversement ou d'un acte de vandalisme.",
    exclusions: [
      {
        label: 'conducteur sans permis valide',
        clauseText:
          "les dommages survenus lorsque le conducteur n'est pas titulaire d'un permis de conduire en état de validité",
        emailCause:
          'Le chauffeur, embauché la semaine dernière, nous a avoué après coup que son permis était suspendu.',
      },
      {
        label: "conduite sous l'emprise de l'alcool",
        clauseText:
          "les dommages survenus lorsque le conducteur se trouvait sous l'emprise d'un état alcoolique",
        emailCause:
          "Le contrôle de gendarmerie effectué sur place a révélé un taux d'alcoolémie supérieur à la limite légale chez notre chauffeur.",
      },
    ],
    limits: [25_000, 40_000, 60_000],
    deductibles: [500, 800, 1_000],
    amountRange: [1_500, 12_000],
    vehicle: true,
  },
};

export interface ProductDefinition {
  id: 'multirisk' | 'fleet';
  label: string;
  numberPrefix: string;
  perils: Peril[];
}

export const PRODUCTS: Record<ProductDefinition['id'], ProductDefinition> = {
  multirisk: {
    id: 'multirisk',
    label: 'Multirisque professionnelle',
    numberPrefix: 'C',
    perils: ['water_damage', 'fire', 'theft', 'glass_breakage'],
  },
  fleet: {
    id: 'fleet',
    label: 'Flotte automobile',
    numberPrefix: 'F',
    perils: ['glass_breakage', 'vehicle_damage'],
  },
};
