# V16 — Des pièces jointes qui ressemblent à de vraies pièces

Branche : `v16-realistic-documents` (créée depuis `v15-requests-and-replies`).
Spec : [`specs/v16-realistic-documents.md`](../../specs/v16-realistic-documents.md).

## Ce qui a été fait

- `@demo/shared` : `DocumentModel` (union sur `kind` : `invoice` / `quote`, `incident_report`
  avec ses variantes `water`, `vehicle` et `statement`, `police_report`, `fire_report`), les
  libellés imprimés en français et en anglais (`DOCUMENT_LABELS`), et `documentText`, le texte
  qu'un parseur parfait lirait. Une pièce jointe générée porte son modèle dans `document`.
- Générateur : `attachments.ts` produit ces modèles. La facture comporte un émetteur avec
  adresse, téléphone, e-mail, SIRET, n° de TVA et pastille de logo, des lignes
  (déplacement, main-d'œuvre, fournitures) qui tombent juste sur le montant TTC, la TVA, un IBAN
  et les conditions de paiement. Les détails sans enjeu viennent d'un hachage stable du document
  et non du `faker` partagé : le reste du monde ne change pas. La facture du fournisseur (V15)
  utilise le même gabarit.
- `@demo/documents` : `renderDocument` met en page chaque type avec pdfmake :
  - la facture et le devis ont en-tête, bloc client, tableau, totaux et mentions légales ;
  - le constat est un formulaire encadré avec cases à cocher (« X »), colonnes véhicule A / B et
    cadre de croquis ;
  - le récépissé de plainte a un en-tête « Police nationale », un n° de procédure et un cachet ;
  - le rapport des pompiers a un en-tête SDIS, des horaires et les moyens engagés.

  Champ illisible : un rectangle hachuré « zone illisible » à la place de la valeur.

- Extraction : `extractText` reconstitue les lignes à partir des positions (même ordonnée, puis
  de gauche à droite, colonnes séparées par de larges espaces). Les champs de formulaire sont
  imprimés « Libellé : valeur » sur une ligne, pour qu'un humain comme un agent les lise
  directement.

## Vérifié

- `lint`, `typecheck`, `test` (dont 2 nouveaux tests : chaque type de document en français et
  en anglais est reproductible octet pour octet et rend ses faits utiles au texte extrait ;
  un formulaire se lit « libellé : valeur »), `test:integration` (Core 29, extranet 7).
- Rendus vérifiés à l'œil (conversion en image) : facture, devis illisible, constat automobile,
  récépissé de plainte, rapport des pompiers.
- Evals sur les 11 cas de sinistre du jeu régénéré (sans juge LLM) : 11/11 entièrement corrects,
  `triage/fields` et `coverage/verdict` à 100 %. Aucune baisse par rapport à la baseline V15.

## Non vérifié

- La baseline complète sur 21 cas (avec juge), pour le budget LLM : la baseline enregistrée reste
  celle de V15.
