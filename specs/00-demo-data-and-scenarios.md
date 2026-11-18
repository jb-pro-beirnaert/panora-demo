# Données et scénarios de la démo

> Ce que contient le monde généré, les types d'e-mails qui arrivent pendant la démo, et le résultat attendu pour chacun.
> Les noms de champs sont ceux du code (anglais) ; les valeurs textuelles sont en français jusqu'à V3, en français et en anglais à partir de V4.
> Toutes les données sont fictives.

## 1. Les types de données

### Données du monde (créées au seed)

| Type | Où | Exemple |
| --- | --- | --- |
| Cabinet (`Brokerage`) | base core | Delorme Courtage, `brokerCode: DLM-075`, `locale: fr` |
| Courtier (`Broker`) | base core | Sophie Marchal, `s.marchal@delorme-courtage.fr` |
| Client (`Client`) | base core | Boulangerie Martin SARL, SIREN 812 456 931 |
| Contrat vu par le cabinet (`Policy`) | base core | C-48213, Assurances Horizon, multirisque pro, `knownStatus: active` |
| Assureur (`Insurer`) | base extranet | Assurances Horizon, Mutuelle Atlas, Northbridge Insurance (anglais, V4) |
| Contrat vu par l'assureur (`Policy`) | base extranet | C-48213, `status: terminated`, `endReason: non_payment`, `endDate: 2026-10-01` |
| Garantie (`Coverage`) | base extranet | Dégât des eaux, `limit: 30000`, `deductible: 300`, `clauseRef: CG-HZ-4.2` |
| Clause (`Clause`) | base extranet | CG-HZ-4.2 : « Sont garantis les dommages causés par les fuites accidentelles… Sont exclus les dommages résultant d'un défaut d'entretien de la toiture. » |
| Sinistre déjà déclaré (`Claim`) | base extranet | S-2026-0412 sur F-77102, bris de glace, 680 €, réglé |

### Données qui arrivent pendant la démo

| Type | Envoyé par | Exemple |
| --- | --- | --- |
| E-mail entrant (`InboundEmail`) | simulateur → Core | « Dégât des eaux dans le fournil », de contact@boulangerie-martin.fr |
| Pièce jointe (`Attachment`) | avec l'e-mail | `constat.pdf`, `facture_plombier.pdf` (texte simulé) |

### Données produites par le système

| Type | Produit par | Exemple |
| --- | --- | --- |
| Dossier (`Case`) | Core | CASE-0001, `status: awaiting_approval` |
| Étape d'agent (`AgentStep`) | Mastra → Core | `stepType: coverage.policy_checked`, `params: { policyNumber: "C-48213", status: "terminated" }` |
| Action proposée (`ProposedAction`) | `draftingAgent` | `actionType: notify_denial`, brouillon d'e-mail, note interne |
| Journal d'audit (`AuditLog`) | Core | `actor: broker`, `action: action_approved`, Sophie Marchal, 10:05 |
| Trace (Langfuse, V5) | Mastra | arbre des appels LLM et MCP, tokens, coût |
| Vérité terrain | générateur | `{ verdict: "not_covered", reason: "policy_terminated", clause: "CG-HZ-12.1" }` |

## 2. Catalogue des scénarios

Chaque e-mail du flux est tiré dans ce catalogue. Le générateur fixe à l'avance la bonne réponse (vérité terrain), ce qui sert aux evals.

| # | Scénario | Ce qui le provoque dans les données | Verdict attendu | Action attendue | Depuis |
| --- | --- | --- | --- | --- | --- |
| 1 | Sinistre couvert | contrat actif, garantie applicable, montant sous le plafond | `covered` | `file_claim` | V1 |
| 2 | Contrat résilié | le cabinet croit le contrat actif, l'assureur l'a résilié | `not_covered` + alerte `policy_terminated` | `notify_denial` | V1 |
| 3 | Garantie exclue | la clause exclut la cause décrite dans l'e-mail | `not_covered` + alerte `exclusion` | `notify_denial` | V1 |
| 4 | Plafond dépassé | montant réclamé supérieur au plafond | `covered` + alerte `limit_exceeded` | `file_claim` plafonné | V1 |
| 5 | Franchise à déduire | montant faible, franchise significative | `covered` | `file_claim`, montant net indiqué | V1 |
| 6 | Pièce manquante | e-mail sans constat ni facture | `uncertain` + alerte `missing_document` | `request_documents` | V1 |
| 7 | Doublon | un sinistre identique est déjà déclaré | `uncertain` + alerte `duplicate_claim` | `request_documents` (demande de confirmation) | V1 |
| 8 | Hors sinistre | demande de devis ou de résiliation | aucun (pas d'analyse) | classé, workflow terminé | V2 |
| 9 | Champ illisible | montant ou date absent ou ambigu | `uncertain`, confiance faible | `request_documents` | V1 |
| 10 | Client inconnu | expéditeur absent de la base du cabinet | `uncertain` | note au courtier : client à identifier | V3 |
| 11 | Déclaration tardive | sinistre déclaré après le délai prévu par la clause | `uncertain` + alerte `late_declaration` | note au courtier | V1 |
| 12 | E-mail en anglais | client anglophone, assureur anglophone | selon le cas | brouillon en anglais | V4 |
| 13 | Langues croisées | e-mail en anglais, clauses en français (ou l'inverse) | selon le cas | brouillon dans la langue de l'e-mail, citations dans leur langue | V4 |
| 14 | Cabinet francophone, client anglophone | `Brokerage.locale = fr`, e-mail en anglais | selon le cas | brouillon en anglais, note interne en français | V4 |

Répartition par défaut du flux : environ 35 % de cas simples (1, 5), 50 % de pièges (2, 3, 4, 6, 7, 9, 10, 11), 15 % hors sinistre (8).

## 3. Déroulé détaillé de quatre scénarios

### Scénario 1 — Sinistre couvert

**E-mail reçu**

> De : contact@transports-lefevre.fr
> Objet : Bris de glace camion AB-456-EF
> Bonjour, le pare-brise de notre camion AB-456-EF a été fissuré par un projectile sur l'A1 le 15/11. Ci-joint la facture du réparateur (420 €). Contrat F-77102.
> Pièce jointe : `facture_vitrage.pdf`

**Ce qui se passe**

1. `triageAgent` : `requestType: claim`, contrat F-77102, date 15/11/2026, nature bris de glace, montant 420 €, pièces : facture.
2. `coverageAgent` via MCP : `get_policy` (actif), `list_coverages` (bris de glace, franchise 0 €), `get_claim_history` (un ancien sinistre en septembre, autre véhicule).
3. Verdict : `covered`, garantie bris de glace, citation de la clause CG-AT-7.1.
4. `draftingAgent` : `file_claim`, brouillon au client (« nous déclarons le sinistre auprès de Mutuelle Atlas… »), note interne.
5. Le dossier passe en « en attente de validation ».

**Résultat attendu** : le courtier valide ; l'outil `file_claim` crée le sinistre S-2026-xxxx dans l'extranet ; le dossier est clos ; l'audit contient chaque étape, la validation et le numéro de sinistre.

### Scénario 2 — Contrat résilié

**E-mail reçu**

> De : contact@boulangerie-martin.fr
> Objet : Dégât des eaux dans le fournil
> Bonjour, une fuite au plafond a inondé le fournil cette nuit. Vous trouverez le constat et la facture du plombier (1 450 €).
> Pièces jointes : `constat.pdf`, `facture_plombier.pdf`

**Ce qui se passe**

1. `triageAgent` : client trouvé par l'e-mail via `find_client`, contrat C-48213, dégât des eaux, 1 450 €.
2. `coverageAgent` : `get_policy` renvoie `terminated` depuis le 01/10/2026 (non-paiement), alors que le cabinet le croit actif. `read_clause CG-HZ-12.1` : aucune garantie après la date de résiliation.
3. Verdict : `not_covered`, alerte `policy_terminated`, clause citée.
4. `draftingAgent` : `notify_denial` ; brouillon prudent au client ; note interne : « Le contrat est résilié côté assureur depuis le 01/10 alors qu'il apparaît actif chez nous : à vérifier en priorité. »

**Résultat attendu** : dans la timeline, l'étape « contrat résilié » est mise en avant ; le courtier voit l'écart entre ce que le cabinet croyait et la réalité. C'est le scénario phare de la vidéo.

### Scénario 6 — Pièce manquante, puis refus du courtier

**E-mail reçu**

> De : direction@garage-bernard.fr
> Objet : Incendie atelier
> Bonjour, un départ de feu dans notre atelier hier soir. Que devons-nous faire ?
> (aucune pièce jointe)

**Ce qui se passe**

1. `triageAgent` : sinistre incendie, pas de montant, pièces manquantes : constat, devis ou facture, rapport des pompiers.
2. `coverageAgent` : contrat actif, garantie incendie présente, mais montant inconnu → `uncertain`, alerte `missing_document`.
3. `draftingAgent` : `request_documents`, brouillon listant les pièces à fournir.
4. Le courtier **refuse** avec le commentaire : « Ajoute qu'il ne faut pas jeter les éléments endommagés avant l'expertise. »
5. `draftingAgent` refait le brouillon avec cette consigne ; le workflow se suspend de nouveau.

**Résultat attendu** : deux propositions successives visibles dans le dossier ; le refus et son commentaire figurent dans l'audit ; la seconde version est validée et passe au statut `ready_to_send`.

### Scénario 13 — Langues croisées (V4)

**E-mail reçu**

> From: facilities@brightwave-solutions.com
> Subject: Water damage in our Lyon office
> Hello, a pipe burst in our Lyon office last night and damaged two workstations. Repair quote attached (2,300 EUR). Policy C-51877.
> Attachment: `repair_quote.pdf`

Le contrat C-51877 est chez un assureur français : les clauses sont en français. Le cabinet est francophone.

**Ce qui se passe**

1. `triageAgent` : `emailLanguage: en`, sinistre dégât des eaux, 2 300 €.
2. `coverageAgent` : garantie dégât des eaux, franchise 300 €, clause citée **en français**.
3. `draftingAgent` : `file_claim` ; brouillon au client **en anglais** ; note interne **en français**.

**Résultat attendu** : dans l'interface en français, la timeline est en français ; le brouillon s'affiche en anglais avec un badge « EN » ; la citation de clause reste en français. En basculant l'interface en anglais, la timeline passe en anglais, le reste ne bouge pas.

## 4. Ce que montre le panneau de démo

| Action | Résultat attendu |
| --- | --- |
| Démarrer | les e-mails arrivent à la cadence choisie, les dossiers apparaissent en direct |
| Pause | plus aucun nouvel e-mail ; les dossiers en cours continuent |
| Envoyer 1 e-mail | un e-mail tiré au hasard dans le catalogue |
| Validation automatique | un courtier simulé décide après quelques secondes (par défaut 80 % de validations, 20 % de refus avec commentaire) |
| Mélange de langues (V4) | proportion FR / EN des nouveaux e-mails |
| Rafale (V9) | 1 000 e-mails d'un coup, compteurs de débit et d'erreurs |
| Reset | interface vide, bases re-remplies à l'identique en quelques secondes |

## 5. Ce qui se passe en cas de problème (V9)

| Situation | Résultat attendu |
| --- | --- |
| L'extranet répond lentement | l'étape attend jusqu'au délai maximal, la timeline indique l'attente |
| L'extranet renvoie une erreur | relance automatique ; visible dans la trace, invisible pour le courtier si la relance réussit |
| L'API LLM est indisponible | relances avec délai croissant ; après échec définitif, dossier « en erreur », relançable depuis l'UI |
| Le serveur Mastra redémarre pendant une validation en attente | la reprise fonctionne normalement après le redémarrage |
| Le même e-mail arrive deux fois | un seul dossier traité |
