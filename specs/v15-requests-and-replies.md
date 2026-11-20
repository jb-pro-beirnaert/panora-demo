# V15 — Toutes les demandes, une réponse au client, et ce qui reste au courtier

**Résultat attendu** : chaque e-mail reçu aboutit à l'une de ces trois issues, visible d'un coup d'œil :

1. **Traité par les agents** : une action et une réponse au client sont proposées, puis validées par le courtier.
2. **À traiter par vous** : les agents n'ont pas pu aller au bout ; le panneau dit pourquoi et propose un accusé de réception.
3. **Classé** : l'e-mail est sans rapport (spam, newsletter, facture fournisseur) ; ni réponse ni action.

De nouveaux cas de figure couvrent la résiliation (avec écriture chez l'assureur après validation), les demandes d'information, les e-mails sans rapport, les pièces partielles, les relances et plusieurs sortes de doublons.

**Services touchés** : `packages/shared`, `packages/world-generator`, `apps/mcp-extranet`, `apps/agents`, `apps/core-api`, `apps/web`, `apps/simulator`, `evals`.

**Prérequis** : V14 (démo scénarisée, vrais PDF).

## 1. Types de demande

`requestType` (sortie de `triageAgent`) devient :

| `requestType` | Exemples | Suite du workflow |
| --- | --- | --- |
| `claim` | déclaration de sinistre | `handle-claim` (inchangé, sauf §4 et §6) |
| `cancellation` | « nous souhaitons résilier le contrat C-… » | `handle-cancellation` (§5) |
| `information` | question sur une garantie, demande d'attestation | `handle-information` (§6) |
| `quote_request` | demande de devis | à traiter par vous (§3) |
| `follow_up` | « suite à mon e-mail… », réponse à un e-mail du cabinet | `handle-follow-up` (§7) |
| `unrelated` | spam, newsletter, facture d'un fournisseur du cabinet | classé, fin du workflow |

- `triageAgent` renvoie aussi `subtype` quand c'est utile : `coverage_question` ou `certificate` pour `information` ; `spam`, `newsletter` ou `supplier_invoice` pour `unrelated`.
- `other` disparaît : tout ce qui n'entre dans aucune case devient « à traiter par vous » avec le motif `unclassified`.

## 2. Une réponse au client pour chaque demande traitée

- Toute proposition (`ProposedAction`) contient un brouillon de réponse au client, dans la langue de l'e-mail, qui dit ce qui a été fait ou ce qui manque. C'est déjà le cas pour les sinistres ; V15 l'étend aux nouveaux types.
- **Réponse finale après exécution** : quand l'action écrit chez l'assureur (`file_claim`, `request_cancellation`), le brouillon contient des marqueurs (`{{claimNumber}}`, `{{effectiveDate}}`) que l'étape `execute` remplit avec la réponse de l'assureur, sans appel au LLM. Le courtier voit le brouillon final, prêt à envoyer, sur la page du dossier.
- **Commentaire à la validation** : aujourd'hui, un commentaire saisi en validant est ignoré (seul un refus relance la rédaction). En V15, un commentaire à la validation est transmis à `draftingAgent`, qui retouche **uniquement le brouillon** (pas l'action) avant l'exécution. Le dossier passe par une étape « retouche du brouillon » visible dans la timeline.
- Nouveaux types d'action (`ActionType`) :

| Action | Quand | Exécution après validation |
| --- | --- | --- |
| `file_claim` | sinistre couvert | `file_claim` (MCP write), réponse finale avec le numéro de sinistre |
| `notify_denial` | sinistre non couvert | réponse prête à envoyer |
| `request_documents` | pièce manquante, doute | réponse prête à envoyer |
| `cancel_policy` | résiliation recevable | `request_cancellation` (MCP write), réponse finale avec la date d'effet |
| `answer_question` | question sur une garantie | réponse prête à envoyer |
| `send_status` | relance | réponse prête à envoyer |
| `acknowledge` | dossier à traiter par vous | accusé de réception prêt à envoyer ; le dossier reste à traiter par vous |

L'envoi réel de l'e-mail reste hors périmètre : « prêt à envoyer » est l'état final, comme aujourd'hui.

## 3. « À traiter par vous »

- Nouveau statut de dossier `needs_broker`, avec un **motif** stocké en `type` + `params` (rendu par clé de traduction, comme les étapes) :

| Motif | Exemple |
| --- | --- |
| `certificate_request` | demande d'attestation : aucun outil ne permet de la produire |
| `quote_request` | demande de devis : la tarification est hors du périmètre des agents |
| `policy_not_found` | contrat introuvable chez l'assureur ou chez le cabinet |
| `policy_of_other_client` | le contrat cité appartient à un autre client |
| `question_not_answerable` | aucune clause ne répond à la question |
| `follow_up_unmatched` | relance sans dossier d'origine identifiable |
| `unclassified` | demande que le tri ne sait pas classer |
| `workflow_failed` | échec après les reprises automatiques |

- Pour ces dossiers, `draftingAgent` propose quand même un **accusé de réception** (`acknowledge`) : « nous avons bien reçu votre demande, votre courtier revient vers vous ». Le courtier peut le valider, le refuser avec commentaire ou l'ignorer.
- **Page du dossier** : un bandeau orange en haut, « À traiter par vous », avec le motif en clair et ce que les agents ont déjà trouvé (client, contrat, statut chez l'assureur). Un bouton **« Marquer comme traité »** (commentaire facultatif) ferme le dossier : statut `handled_manually`, ligne d'audit `case_handled_manually` au nom du courtier.
- **Boîte de réception** :
  - nouvel onglet « À traiter par vous », avec compteur, à côté de « À valider » ;
  - le pipeline du dossier montre une pastille orange « vous » à l'étape où les agents se sont arrêtés ;
  - le titre de l'onglet du navigateur compte les dossiers à valider **et** à traiter.
- Un dossier `failed` (V9) passe en `needs_broker` / `workflow_failed` après les reprises automatiques ; le bouton « Relancer » reste disponible sur la page.

## 4. Doublons

Un doublon peut venir de l'assureur (un sinistre déjà déclaré) ou du cabinet (une demande déjà reçue et pas encore exécutée). Les agents vérifient les deux.

- Nouvel outil de lecture **côté Core** pour les agents : `find_client_cases(email | clientId)`. Il renvoie les dossiers récents du client (référence, type, statut, contrat, date du sinistre, nature, montant), sans le contenu des e-mails. Jeton de service en lecture, comme `find_client`.
- Doublons couverts :

| Cas | Détection | Résultat |
| --- | --- | --- |
| Sinistre déjà déclaré chez l'assureur (actuel) | `get_claim_history` | `uncertain` + `duplicate_claim`, `request_documents` (demande de confirmation) |
| Même sinistre renvoyé pendant la démo | `find_client_cases` (dossier ouvert) ou `get_claim_history` (s'il a déjà été déclaré) | idem, la réponse cite la référence du premier dossier |
| Résiliation d'un contrat déjà résilié | `get_policy` : `terminated` | alerte `already_terminated`, `send_status` (« votre contrat est résilié depuis le … ») |
| Résiliation déjà demandée | `get_policy` : résiliation programmée à une date future | alerte `cancellation_already_requested`, `send_status` (« la résiliation prendra effet le … ») |
| Même e-mail reçu deux fois (même `messageId`) | Core, à la réception (existant) | aucun nouveau dossier |

## 5. Résiliation (`handle-cancellation`)

- Nouvel agent **`policyServiceAgent`** (modèle fort), outils en lecture seulement : `find_client`, `find_client_cases`, `get_policy`, `search_policy`, `read_clause`.
- Vérifications, dans l'ordre :
  1. **Le contrat existe** et **appartient à l'expéditeur** : le numéro cité doit figurer dans les contrats que `find_client` renvoie pour cet expéditeur, puis `get_policy` doit le trouver chez l'assureur. Sinon : à traiter par vous (`policy_not_found` ou `policy_of_other_client`).
  2. **Statut chez l'assureur** : déjà résilié ou résiliation déjà programmée → doublon (§4).
  3. **Préavis** : la clause de résiliation par l'assuré (nouvelle clause générale de chaque assureur, par exemple « préavis de deux mois avant l'échéance ») est lue avec `read_clause`. Si le préavis est respecté, la date d'effet est la prochaine échéance ; sinon, l'échéance suivante, avec l'alerte `notice_period_not_met` et la clause citée.
- Sortie structurée : contrat, statut, date d'effet proposée, alertes, citations.
- `draftingAgent` propose `cancel_policy` avec une confirmation au client (date d'effet en marqueur) et une note au courtier.
- **Validation manuelle obligatoire** : comme pour les sinistres, rien n'est écrit sans la décision du courtier.
- **Exécution** : nouvel outil MCP d'écriture **`request_cancellation(policyNumber, effectiveDate, reason)`**, jeton `write` uniquement.
  - Extranet : le contrat reste `active` jusqu'à la date d'effet ; `endDate = effectiveDate`, `endReason = client_request`, `cancellationRequestedAt = now`. Ligne `CallLog`.
  - Refus de l'assureur si le contrat est déjà résilié ou si la date d'effet ne tombe pas sur une échéance ; idempotent si la même résiliation est déjà enregistrée (`alreadyRequested: true`).
  - Core : `Policy.cancellationEffectiveDate` est renseigné (le cabinet sait désormais que le contrat se termine), statut du dossier `cancellation_filed`, ligne d'audit avec la source `mcp:request_cancellation`.
- Le monde généré ajoute pour chaque assureur la clause générale de résiliation par l'assuré, et au moins un contrat dont la résiliation est déjà programmée.

## 6. Demande d'information (`handle-information`)

- **Question sur une garantie** (`coverage_question`) : `policyServiceAgent` identifie le contrat, lit les garanties (`list_coverages`) et les clauses (`read_clause`), et produit une réponse citée (plafond, franchise, exclusions). `draftingAgent` propose `answer_question` ; les citations restent dans leur langue d'origine. Si aucune clause ne répond, le dossier est à traiter par vous (`question_not_answerable`).
- **Attestation** (`certificate`) : pas d'outil pour la produire. Le tri identifie le client et le contrat, puis le dossier passe directement à traiter par vous (`certificate_request`), avec un accusé de réception proposé. Le panneau indique le contrat concerné et son statut chez l'assureur, pour que le courtier n'ait pas à le chercher.

## 7. Relances (`handle-follow-up`)

- `InboundEmailInput` accepte `inReplyTo` (en-tête `In-Reply-To`, facultatif).
- **Rattachement par Core, à la réception** :
  - si `inReplyTo` correspond au `messageId` d'un e-mail connu, le nouvel e-mail est rattaché au dossier de cet e-mail ;
  - sinon, Core crée un dossier comme aujourd'hui, et si le tri le classe `follow_up`, l'agent cherche le dossier d'origine avec `find_client_cases` (même expéditeur, sujet, référence citée). Un seul dossier plausible : rattachement. Zéro ou plusieurs : à traiter par vous (`follow_up_unmatched`).
- **Modèle** : un dossier peut avoir plusieurs e-mails (`InboundEmail.caseId`, plusieurs par dossier, ordonnés ; le premier reste l'e-mail d'origine). La contrainte « un e-mail = un dossier » disparaît.
- **Traitement** : le workflow principal du dossier n'est pas touché (il peut être suspendu en attente de validation). Un workflow court `handle-follow-up` lit l'état du dossier (statut, action en attente ou exécutée, numéro de sinistre) et `draftingAgent` propose `send_status` : « votre dossier est en cours d'analyse », « votre sinistre S-… a été déclaré le … », etc.
  - Si la relance apporte des pièces jointes (par exemple les documents demandés), le dossier signale « nouvelles pièces reçues » et propose au courtier de **relancer l'analyse** (bouton), qui repart de `analyze-coverage` avec toutes les pièces du dossier.
- **UI** : la page du dossier affiche le fil des e-mails ; la boîte de réception remonte le dossier avec un badge « Relance » et l'onglet « À valider ».

## 8. Pièces partielles

- Nouveau scénario `partial_documents` : un sinistre avec une partie seulement des pièces (par exemple la facture sans le constat). Résultat attendu : `uncertain` + `missing_document`, `request_documents`, et la réponse au client ne demande **que** les pièces manquantes, en nommant celles déjà reçues.

## 9. Script de démo (V15)

Le script V14 passe à environ 24 e-mails, dans cet ordre :

| # | Cas | Pièces | Issue attendue |
| --- | --- | --- | --- |
| 1 | Sinistre couvert | constat + facture | `file_claim` → déclaré, réponse avec n° de sinistre |
| 2 | Contrat résilié ★ | rapport + devis | `notify_denial` |
| 3 | Pièce manquante | aucune | `request_documents` |
| 4 | Pièces partielles | facture seule | `request_documents` (constat seulement) |
| 5 | Exclusion | constat + devis | `notify_denial` |
| 6 | Plafond dépassé | rapport + devis | `file_claim` plafonné |
| 7 | Franchise | constat + facture | `file_claim`, montant net |
| 8 | Doublon chez l'assureur | constat + facture | `request_documents` (confirmation) |
| 9 | Champ illisible | facture masquée | `request_documents` |
| 10 | Déclaration tardive | constat + facture | `request_documents` |
| 11 | Client inconnu | aucune | `request_documents` |
| 12 | Résiliation recevable | aucune | `cancel_policy` → résiliation enregistrée, date d'effet |
| 13 | Résiliation d'un contrat déjà résilié | aucune | `send_status` + `already_terminated` |
| 14 | Résiliation hors préavis | aucune | `cancel_policy`, échéance suivante + `notice_period_not_met` |
| 15 | Question sur une garantie | aucune | `answer_question` avec citation |
| 16 | Demande d'attestation | aucune | à traiter par vous + `acknowledge` |
| 17 | Demande de devis | aucune | à traiter par vous + `acknowledge` |
| 18 | Spam | aucune | classé |
| 19 | Newsletter d'un assureur | aucune | classé |
| 20 | Facture d'un fournisseur du cabinet | PDF | classé |
| 21 | Relance du n° 3 avec les pièces (`In-Reply-To`) | constat + facture | rattachée au n° 3, `send_status` + « relancer l'analyse » |
| 22 | Relance sans en-tête (« suite à mon e-mail du … ») sur le n° 1 | aucune | rattachée par l'agent, `send_status` |
| 23 | Même sinistre que le n° 7, renvoyé | constat + facture | `request_documents` + `duplicate_claim` (cite le n° 7) |
| 24 | Sinistre couvert, en anglais, clauses en français | constat + devis | `file_claim`, brouillon en anglais |

- Le catalogue de `00-demo-data-and-scenarios.md` est mis à jour avec ces scénarios et leur vérité terrain.

## 10. Evals

- La vérité terrain (`GroundTruth`) couvre les nouveaux types : `requestType`, `subtype`, issue attendue (`action` | `needs_broker` + motif | `classified`), alertes, date d'effet pour une résiliation, dossier d'origine pour une relance.
- Nouveaux scores : exactitude du `requestType`, de l'issue, du motif « à traiter par vous », et de la date d'effet. Le juge LLM note aussi la réponse au client (elle dit bien ce qui a été fait ou ce qui manque).
- Le jeu de données est régénéré avec les nouveaux scénarios et pondérations ; la baseline est ré-enregistrée. Les nouveaux scores ont un seuil dans `thresholds.json`.

## Critères d'acceptation

- [ ] Les 24 e-mails du script aboutissent chacun à l'issue du tableau §9 (test d'intégration en `AGENTS_MODE=simulated`, plus une démo réelle).
- [ ] Chaque dossier traité par les agents a une réponse au client ; après `file_claim` ou `request_cancellation`, elle contient le numéro de sinistre ou la date d'effet réels.
- [ ] Une résiliation validée modifie le contrat dans l'extranet (`endDate`, `endReason`) et dans Core (`cancellationEffectiveDate`) ; une résiliation refusée par le courtier ne modifie rien.
- [ ] Résilier un contrat déjà résilié ne déclenche aucune écriture et produit `already_terminated`.
- [ ] Les dossiers « à traiter par vous » ont leur onglet, leur motif en clair et un bouton « Marquer comme traité » qui écrit une ligne d'audit.
- [ ] Une relance avec `In-Reply-To` est rattachée au dossier d'origine sans créer de dossier ; une relance sans en-tête est rattachée par l'agent ou passe à traiter par vous.
- [ ] Un commentaire saisi en validant retouche le brouillon avant l'exécution.
- [ ] Les e-mails sans rapport sont classés sans brouillon ni appel MCP.
- [ ] Les agents n'ont toujours que des outils de lecture ; `request_cancellation`, comme `file_claim`, n'est appelé que par l'étape `execute`, avec le jeton `write`.
- [ ] Les evals couvrent les nouveaux scénarios et passent leurs seuils.
- [ ] Tous les nouveaux textes passent par `fr.json` / `en.json`.

## Hors périmètre

- L'envoi réel des e-mails au client (SMTP).
- La production d'attestations ou de devis.
- La fusion automatique de deux dossiers déjà créés.
- La détection de spam par des règles ou des listes noires : seul le tri par l'agent classe un e-mail comme sans rapport.
