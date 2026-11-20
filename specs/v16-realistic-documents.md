# V16 — Des pièces jointes qui ressemblent à de vraies pièces

**Résultat attendu** : quand on ouvre une pièce jointe, on voit le document qu'un courtier recevrait vraiment : une facture avec l'en-tête du réparateur, ses mentions légales et un tableau de lignes ; un constat amiable avec ses cases ; un récépissé de plainte ; un rapport des pompiers. Les agents reçoivent toujours le texte extrait, et ils lisent ces documents aussi bien qu'avant.

**Services touchés** : `packages/documents`, `packages/world-generator`, `packages/shared`, `evals`.

**Prérequis** : V15.

## 1. Constat

Depuis V14, les pièces jointes sont de vrais PDF, mais leur mise en page reprend le texte extrait : un titre, puis des lignes `Libellé : valeur`. À l'écran, ça ressemble à une fiche technique, pas à une facture.

## 2. Un modèle par type de document

Le générateur ne produit plus du texte de page, mais un **modèle de document structuré** par type. `@demo/documents` le met en page avec pdfmake. Les types partagés vivent dans `@demo/shared` (`DocumentModel`, union discriminée sur `kind`).

| `kind` | Mise en page attendue (FR et EN) |
| --- | --- |
| `invoice` / `quote` | **En-tête de l'émetteur** à gauche (raison sociale, adresse, téléphone, e-mail, SIRET, n° de TVA intracommunautaire) et logo simulé (pastille de couleur avec les initiales). Bloc **client** à droite (raison sociale, adresse). Titre « FACTURE » / « DEVIS », numéro, date (et date de validité pour un devis). Référence du sinistre (nature, véhicule ou lieu, date). **Tableau** : désignation, quantité, prix unitaire HT, total HT. **Totaux** : HT, TVA 20 %, TTC en gras. Pied : conditions de paiement (30 jours, pénalités de retard), IBAN fictif, mentions légales. |
| `incident_report` (constat amiable de dégât des eaux, déclaration circonstanciée) | Formulaire encadré : titre, cadres « Assuré » / « Lieu du sinistre » / « Date et heure », cases à cocher (origine de la fuite, locaux touchés), zone « Circonstances » en texte libre, cadre « Dommages constatés », signature et date. |
| `incident_report` véhicule (constat amiable d'accident automobile) | Deux colonnes « Véhicule A » / « Véhicule B » (assuré, contrat, immatriculation, marque et modèle), une ligne de cases « Circonstances » numérotées (1 à 17) dont une cochée, un cadre « Croquis » (rectangle avec la mention « croquis joint »), observations, signatures. |
| `police_report` | En-tête « Ministère de l'Intérieur — Police nationale » (FR) ou « Metropolitan Police » (EN), « Récépissé de dépôt de plainte » avec numéro de procédure, service enregistreur, identité du plaignant, nature et date des faits, lieu, liste des objets déclarés volés, cachet simulé (cercle gris). |
| `fire_report` | En-tête du SDIS (ou « Fire and Rescue Service »), numéro d'intervention, date et heures (appel, arrivée, fin), adresse, moyens engagés, nature du sinistre, observations, nom de l'officier. |
| `supplier_invoice` (V15, e-mail sans rapport) | Même gabarit que `invoice`, adressée au cabinet. |

- Les montants, dates, numéros de contrat et lieux viennent des mêmes données qu'aujourd'hui : la vérité terrain ne change pas.
- **Champ illisible** (scénario 9) : la valeur n'est pas imprimée. À sa place, un rectangle hachuré gris avec la mention « zone illisible », ou une date manquante sur le formulaire. Le texte extrait ne contient donc pas la valeur, comme pour un vrai scan abîmé.
- **Photos** : inchangées (image générique, non analysée).
- **Reproductibilité** : mêmes données, même PDF à l'octet près (test).

## 3. L'extraction reste fiable

- Un tableau ou deux colonnes peuvent sortir dans le désordre d'un extracteur de texte. `extractText` reconstitue les lignes à partir des positions (regroupement par ordonnée, tri par abscisse), pour que le texte transmis aux agents se lise de haut en bas et de gauche à droite.
- Les marqueurs `--- page N ---` restent. La limite de 8 000 caractères par pièce aussi.
- Un test vérifie, pour chaque type de document en français et en anglais, que le texte extrait contient les faits utiles : montant TTC, date, numéro de contrat s'il est imprimé, immatriculation, numéro de procédure.

## 4. Evals

- Le jeu de données `seed-7` est régénéré : les modèles de documents remplacent le texte de page.
- La baseline est relancée sur les 21 cas « un par scénario ». Les scores de tri (`triage/fields`) et de couverture ne doivent pas baisser de plus de 2 points par rapport à la baseline V15.

## Critères d'acceptation

- [ ] Chaque type de document s'ouvre dans un lecteur PDF avec une mise en page reconnaissable par un humain (en-tête, tableaux, cadres), en français et en anglais.
- [ ] Une facture affiche émetteur, client, numéro, date, lignes, HT, TVA, TTC et conditions de paiement.
- [ ] Le champ illisible n'apparaît ni à l'écran ni dans le texte extrait.
- [ ] Le texte extrait se lit dans l'ordre et contient les faits utiles (test par type).
- [ ] La baseline des evals ne perd pas plus de 2 points sur `triage/fields`, `coverage/verdict` et `workflow/case_correct`.

## Hors périmètre

- Des documents scannés (images) et l'OCR.
- De vraies photos des dégâts.
- Le dépôt de documents par l'utilisateur.
