# V14 — Démo scénarisée et vrais PDF

**Résultat attendu** : une démo a un début et une fin. On prépare à l'avance une liste fixe d'e-mails qui couvre tous les cas de figure, on les envoie un par un, et le bandeau affiche « 7/14 e-mails de la démo ». Les pièces jointes sont de vrais PDF qu'on peut ouvrir dans l'UI ; les agents n'en reçoivent que le texte extrait.

**Services touchés** : `packages/world-generator`, nouveau `packages/documents`, `packages/shared`, `apps/simulator`, `apps/core-api`, `apps/web`, `evals`.

**Prérequis** : V13 (boîte de réception vivante).

## 1. Une démo finie : le script de démo

Aujourd'hui, le simulateur tire des e-mails au hasard, sans fin, et propose une rafale de 1 000 e-mails. Pour une démo commentée, il faut au contraire une liste connue, dans un ordre pensé, qui montre chaque cas une fois.

- **Script de démo** (`DEMO_SCRIPT` dans `packages/world-generator`) : une liste ordonnée d'environ 14 entrées en V14, 24 en V15. Chaque entrée donne :
  - le scénario (`covered`, `policy_terminated`…) ;
  - la langue de l'e-mail ;
  - le cas échéant, une contrainte (contrat ciblé, entrée dont elle dépend…).
- Le script est généré avec la graine fixe du monde : mêmes e-mails, mêmes PDF, à chaque démarrage.
- **Ordre en V14** (les cas actuels) :

| # | Scénario | Langue | Pièces jointes |
| --- | --- | --- | --- |
| 1 | Sinistre couvert | fr | constat + facture (PDF), photos |
| 2 | Contrat résilié ★ | fr | rapport + devis (PDF) |
| 3 | Pièce manquante | fr | aucune |
| 4 | Exclusion | fr | constat + devis (PDF) |
| 5 | Plafond dépassé | fr | rapport + devis (PDF) |
| 6 | Franchise | fr | constat + facture (PDF) |
| 7 | Doublon (sinistre déjà déclaré chez l'assureur) | fr | constat + facture (PDF) |
| 8 | Champ illisible | fr | facture au montant masqué (PDF) |
| 9 | Déclaration tardive | fr | constat + facture (PDF) |
| 10 | Hors sinistre : résiliation | fr | aucune |
| 11 | Hors sinistre : devis | fr | aucune |
| 12 | Client inconnu | fr | aucune |
| 13 | Sinistre couvert | en | constat + facture (PDF, en anglais) |
| 14 | Langues croisées (e-mail en anglais, clauses en français) | en | constat + devis (PDF) |

- Le générateur aléatoire (`generateEmails`) reste : il sert aux evals et au test de charge.

## 2. Pilotage de la démo

### Simulateur

- **États** : `ready` (0/X, rien envoyé), `running`, `paused`, `finished` (X/X).
- **Routes conservées ou modifiées** :
  - `GET /state` renvoie en plus `sent`, `total` et le prochain e-mail (`next: { index, scenario, subject }`) ;
  - `POST /start`, `/pause`, `/resume` ;
  - `POST /speed` règle l'intervalle entre deux e-mails (défaut 20 s : le temps qu'un e-mail passe le tri et l'analyse) ;
  - `POST /send-one` envoie **le prochain e-mail du script**, que la lecture soit en pause ou non ; sans effet à X/X ;
  - `POST /reset` vide les bases, refait le seed et remet le compteur à 0/X, en pause.
- **Routes supprimées** : `/burst`, `/auto-validation`, `/language-mix`, `/send-showcase`. Le scénario phare est le n° 2 du script ; il n'a plus besoin d'un bouton à part.
- Au démarrage, le simulateur fait le seed et reste en `ready` : la démo ne commence que quand on clique sur « Lecture » ou « Envoyer 1 e-mail ».
- Le compteur `sent` est en mémoire (comme le reste du simulateur) : un redémarrage du simulateur sans reset repart du nombre de dossiers déjà présents dans Core (`GET /admin/stats`), pour ne pas renvoyer deux fois le même e-mail.

### Suppression de la validation automatique et de la rafale

- La **validation automatique** était un courtier simulé qui validait ou refusait les propositions à la place de l'utilisateur. Elle n'a de sens qu'avec un flux sans fin ou une rafale ; dans une démo finie, c'est le courtier qui décide. On supprime :
  - `AutoValidator` dans le simulateur ;
  - le chemin « décision avec le jeton d'administration » de `POST /cases/:id/decision` et le marqueur `auto` de l'audit ;
  - le badge « auto » dans l'UI.
- La **rafale** disparaît de l'UI et des routes du simulateur. Le test de charge reste disponible en ligne de commande (`npm run load-test -w apps/simulator`, V9) : aujourd'hui il passe par `/burst` et `/auto-validation`. Il devient autonome : il génère ses e-mails avec `generateEmails`, les envoie lui-même à `POST /emails`, et valide chaque proposition en appelant `POST /cases/:id/decision`, comme le courtier.

### UI

- **Bandeau supérieur** : « Démo · 7/14 e-mails envoyés » avec une barre de progression ; à X/X : « Démo terminée · 14/14 ». Le texte précédent du bandeau est remplacé.
- **Panneau de démo** : boutons Lecture/Pause, « Envoyer 1 e-mail » (avec en info-bulle le sujet du prochain e-mail), sélecteur de vitesse, « Réinitialiser ». La liste du script est visible en dépliant le panneau : numéro, scénario, langue, et une coche pour les e-mails déjà envoyés.
- Les compteurs et le mini-graphique de débit restent.

## 3. Vrais PDF

### Génération (`packages/documents`)

- Nouveau package partagé `@demo/documents` :
  - `renderPdf(document)` : produit un PDF à partir d'un modèle de document (titre, en-tête de l'émetteur, blocs de champs, tableau de lignes, pied de page), avec **pdfmake**. Les métadonnées de date sont fixées par la graine pour que le même script produise des PDF identiques octet pour octet.
  - `extractText(pdf)` : extrait le texte page par page avec une bibliothèque de lecture de PDF (**unpdf**, basée sur pdf.js, sans dépendance native). Le résultat garde les marqueurs `--- page N ---` que le prompt de `triageAgent` connaît déjà.
- Le générateur produit désormais un **modèle de document** par pièce jointe au lieu d'un texte déjà extrait. Les modèles actuels (constat, constat amiable, facture, devis, récépissé de plainte, rapport des pompiers, en français et en anglais) sont repris avec une vraie mise en page.
- **Champ illisible** (scénario 8) : la valeur est imprimée masquée (« ████ € », ou un champ date laissé vide avec la mention « illisible »), pour que le texte extrait reste sans ambiguïté pour l'agent.
- **Photos** : une petite image JPEG fixe du dépôt (illustration générique). Elles ne sont pas analysées ; le texte transmis aux agents est « [image non analysée : photos_degats.jpg] ».

### Transport et stockage

- `InboundEmailInput.attachments[]` devient `{ fileName, contentType, contentBase64 }` (Zod : types autorisés `application/pdf`, `image/jpeg`, `image/png` ; 2 Mo maximum par pièce, 5 pièces maximum).
- **Core, à la réception**, avant de mettre le job en file :
  - stocke le fichier dans `Attachment.content` (`bytea`) ;
  - extrait le texte des PDF avec `extractText` et le stocke dans `Attachment.extractedText`, avec `pageCount` ;
  - si l'extraction échoue (PDF corrompu, PDF scanné sans texte), `extractedText` est vide et `extractionStatus = failed` ; les agents voient « [pièce jointe illisible : …] » et le traitent comme une pièce présente mais illisible.
- Les agents ne reçoivent **que le texte extrait**, jamais le PDF. Le nombre de caractères envoyés au LLM est limité par pièce (par exemple 8 000) ; au-delà, le texte est tronqué avec une mention explicite.
- Nouvelle route `GET /cases/:id/attachments/:attachmentId/file` : renvoie le fichier avec son type et `Content-Disposition: inline`.
- La purge RGPD (V10) efface aussi `Attachment.content`.

### UI

- Dans « E-mail reçu », chaque pièce jointe a un bouton « Ouvrir » (le PDF dans un nouvel onglet) en plus du texte extrait dépliable, et affiche son nombre de pages et sa taille.

### Evals

- Les evals passent par le même chemin que la démo : le jeu de données contient les PDF (en base64), et le texte est extrait avec `extractText` avant d'appeler le workflow. Les evals mesurent ainsi les agents sur ce qu'ils reçoivent réellement.
- Le jeu de données `seed-7` est régénéré et la baseline est ré-enregistrée.

## Critères d'acceptation

- [ ] Après `npm run dev`, le bandeau affiche « 0/14 » et aucun e-mail n'est envoyé tant qu'on n'a pas cliqué.
- [ ] « Envoyer 1 e-mail » envoie le prochain e-mail du script et le compteur passe à 1/14, 2/14… Lecture envoie les suivants à l'intervalle choisi et s'arrête à 14/14.
- [ ] « Réinitialiser » vide les bases, refait le seed et revient à 0/14. Deux démos de suite produisent les mêmes e-mails et les mêmes PDF (test sur les octets).
- [ ] Il n'y a plus de bouton rafale, de validation automatique ni de badge « auto ».
- [ ] Une pièce jointe PDF s'ouvre depuis le dossier ; c'est un PDF valide, lisible dans un lecteur standard.
- [ ] La trace Langfuse d'un dossier ne contient que le texte extrait des PDF, jamais de base64.
- [ ] Un PDF corrompu envoyé à la main à `POST /emails` crée quand même un dossier, avec la pièce marquée illisible.
- [ ] Les evals tournent sur des PDF extraits et ne baissent pas de plus de 2 points par rapport à la baseline V13.
- [ ] Tous les nouveaux textes passent par `fr.json` / `en.json`.

## Hors périmètre

- La reconnaissance de caractères (OCR) sur des PDF scannés ou des photos, et l'analyse d'images par un modèle multimodal.
- Le dépôt de vrais fichiers par l'utilisateur depuis l'UI.
- Les nouveaux cas de figure : ils arrivent en V15.
