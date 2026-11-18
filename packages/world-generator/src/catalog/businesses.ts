/** Kinds of small businesses the brokerages insure, with the French words used in e-mails. */

export interface BusinessDefinition {
  prefix: string;
  /** Main room, with its article ("le fournil"). */
  area: string;
  /** What a burglar would take. */
  stolenItems: string;
  /** Typical glass that breaks. */
  glass: string;
  /** Whether the business usually has a vehicle fleet. */
  fleet: 'always' | 'sometimes' | 'never';
}

export const BUSINESSES: BusinessDefinition[] = [
  {
    prefix: 'Boulangerie',
    area: 'le fournil',
    stolenItems: 'le terminal de paiement et le fond de caisse',
    glass: 'la vitrine de la boutique',
    fleet: 'never',
  },
  {
    prefix: 'Garage',
    area: "l'atelier",
    stolenItems: "l'outillage de diagnostic et deux crics hydrauliques",
    glass: 'la baie vitrée du hall d’accueil',
    fleet: 'sometimes',
  },
  {
    prefix: 'Imprimerie',
    area: "l'atelier d'impression",
    stolenItems: 'deux ordinateurs et une imprimante grand format',
    glass: 'la porte vitrée de l’entrée',
    fleet: 'sometimes',
  },
  {
    prefix: 'Restaurant',
    area: 'la cuisine',
    stolenItems: 'la caisse enregistreuse et une partie de la cave à vins',
    glass: 'la vitrine donnant sur la rue',
    fleet: 'never',
  },
  {
    prefix: 'Pharmacie',
    area: "l'arrière-boutique",
    stolenItems: 'le contenu du tiroir-caisse et des produits de parapharmacie',
    glass: 'la vitrine principale',
    fleet: 'never',
  },
  {
    prefix: 'Menuiserie',
    area: "l'atelier",
    stolenItems: 'plusieurs machines-outils portatives',
    glass: 'la vitre du bureau d’accueil',
    fleet: 'sometimes',
  },
  {
    prefix: 'Librairie',
    area: 'la réserve',
    stolenItems: 'la caisse et les liseuses exposées en vitrine',
    glass: 'la vitrine',
    fleet: 'never',
  },
  {
    prefix: 'Fromagerie',
    area: 'la cave d’affinage',
    stolenItems: 'la balance électronique et le terminal de paiement',
    glass: 'la vitrine réfrigérée',
    fleet: 'never',
  },
  {
    prefix: 'Fleuriste',
    area: 'la boutique',
    stolenItems: 'la caisse et la tablette de commande',
    glass: 'la vitrine',
    fleet: 'sometimes',
  },
  {
    prefix: 'Transports',
    area: 'le dépôt',
    stolenItems: 'des pièces détachées et deux GPS embarqués',
    glass: 'la vitre du bureau d’exploitation',
    fleet: 'always',
  },
  {
    prefix: 'Électricité',
    area: "l'entrepôt",
    stolenItems: 'des bobines de câble cuivre et l’outillage',
    glass: 'la porte vitrée du bureau',
    fleet: 'always',
  },
];

export const LEGAL_FORMS = ['SARL', 'SAS', 'EURL', ''] as const;

export const VEHICLE_MODELS = [
  'Renault Master',
  'Peugeot Boxer',
  'Citroën Jumpy',
  'Ford Transit',
  'Iveco Daily',
  'Renault Trafic',
];

export const ROADS = [
  "l'A1 à hauteur de Senlis",
  "l'A6 près d'Auxerre",
  'la rocade de Rennes',
  'la N7 près de Valence',
  'le périphérique nord de Lille',
  "l'A43 en direction de Chambéry",
];

export const REPAIRERS = {
  water_damage: 'Plomberie',
  fire: 'Rénovation',
  theft: 'Serrurerie',
  glass_breakage: 'Miroiterie',
  vehicle_damage: 'Carrosserie',
} as const;
