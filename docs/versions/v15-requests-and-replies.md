# V15 — Toutes les demandes, une réponse au client, et ce qui reste au courtier

Branche : `v15-requests-and-replies` (créée depuis `v14-scripted-demo`).
Spec : [`specs/v15-requests-and-replies.md`](../../specs/v15-requests-and-replies.md).

## Ce qui a été fait

### Types de demande et issues

- `requestType` : `claim`, `cancellation`, `information`, `quote_request`, `follow_up`,
  `unrelated` (`other` supprimé), avec `subtype` (`coverage_question`, `certificate`, `spam`,
  `newsletter`, `supplier_invoice`) et `caseReference`.
- Workflow `process-email` : sinistre → `handle-claim` ; résiliation ou question → nouveau
  `handle-service` ; relance sans en-tête → `match-follow-up` ; devis ou attestation → `handover` ;
  sans rapport → `classify`.
- Nouvelles issues : `handover` (statut `needs_broker` + motif), `cancellation_filed`, `merged`.
  Nouveaux statuts : `needs_broker`, `handled_manually`, `cancellation_filed`, `merged`.

### Résiliation et questions (`policyServiceAgent`)

- Nouvel agent, outils en lecture seulement (`find_client_cases`, outils MCP de lecture). Il
  vérifie que le contrat appartient à l'expéditeur, son statut chez l'assureur et le préavis
  (nouvelle clause générale 12.3, deux mois avant l'échéance) ; sortie `ServiceAnalysis`.
- L'action est choisie par le code (`cancel_policy`, `send_status`, `answer_question`) ;
  `draftingAgent` n'écrit que la réponse.
- Extranet : `Policy.renewalDate` et `cancellationRequestedAt` (migration
  `20261120120000_cancellation`) ; `get_policy` les renvoie ; nouvel outil d'écriture
  **`request_cancellation`** (jeton `write`, idempotent, refuse un contrat résilié ou une date
  hors échéance), appelé uniquement par l'étape `execute-service` après validation.
- Core : `Policy.cancellationEffectiveDate` renseignée à l'exécution.

### Réponse au client

- Placeholders `{{claimNumber}}` / `{{effectiveDate}}` remplis par l'étape `execute` avec la
  réponse de l'assureur ; un commentaire saisi en validant est appliqué au brouillon
  (`drafting.polished`). Le brouillon final est stocké sur la proposition
  (`finalDraftSubject` / `finalDraftBody`) et affiché « Réponse finale, prête à envoyer ».
- Réponses autonomes (`awaitsWorkflow: false`) : accusé de réception d'un dossier « à traiter par
  vous » et état du dossier après une relance. Les valider les rend prêtes à envoyer ; les refuser
  avec un commentaire relance leur rédaction (nouveau workflow Mastra `draft-reply`, démarré par
  Core). Unicité des propositions : `(caseId, workflowRunId, revision)`.

### « À traiter par vous »

- Bandeau orange avec le motif, la marche à suivre et « Marquer comme traité » (`POST
/cases/:id/handled`, audit `case_handled_manually`). Onglet et colonne « À traiter par vous »
  (les dossiers en échec y apparaissent aussi), pastille « vous » dans le pipeline, compteur dans
  le titre de l'onglet.

### Relances et doublons

- `In-Reply-To` : Core rattache l'e-mail au dossier (`InboundEmail.followUpOfCaseId`), sans créer de
  dossier, et demande une réponse d'état. Sans en-tête : le tri détecte la relance, l'étape
  `match-follow-up` retrouve le dossier avec `find_client_cases` ; le dossier temporaire passe en
  `merged`.
- Fil des relances sur la page du dossier, avec « Relancer l'analyse » quand elles apportent des
  pièces (`POST /cases/:id/reanalyze` : nouveau run avec toutes les pièces).
- `find_client_cases` (Core, lecture) est aussi donné à `coverageAgent` : un sinistre renvoyé est
  repéré comme doublon avant même d'être déclaré chez l'assureur.

### Données, démo, evals

- Générateur : 12 nouveaux scénarios (`requests.ts`), un contrat dont la résiliation est déjà
  programmée, la clause 12.3 en français et en anglais ; le script de démo passe à **25 e-mails**.
- Evals : vérité terrain `RequestGroundTruth` ; nouveaux scores `workflow/outcome`,
  `workflow/handover_reason`, `workflow/effective_date` (seuils ajoutés) ; jeu de données `seed-7`
  régénéré.
- Mode simulé : tri, analyse de service et rédaction couvrent les nouveaux types.

## Vérifié

- `format:check`, `lint`, `typecheck`, `test`, `test:integration` (Core : 29 tests, dont relance
  `In-Reply-To`, réponse autonome, « à traiter par vous », résiliation, fusion ; extranet : 7 tests,
  dont `request_cancellation`).
- Script complet en mode simulé, puis toutes les propositions validées : 2 résiliations
  enregistrées chez l'assureur et dans Core (dont F-15998 hors préavis, demandée pour le
  27/12/2026, enregistrée pour le 27/12/2027), placeholders remplis.
- Script complet avec les vrais modèles : les 24 dossiers ont l'issue attendue. Dans
  l'interface : « Relancer l'analyse » sur le dossier 3 (pièce manquante → couvert, `file_claim`),
  validation d'une résiliation avec commentaire (appliqué à la réponse finale, date d'effet
  remplie), bandeau « À traiter par vous ».
- Baseline des evals sur 21 cas (un par scénario) : 20/21 entièrement corrects, nouveaux scores à
  100 %, 0,0025 $ par cas.

## Écarts par rapport à la spec

- Un dossier en échec garde le statut `failed` (et son bouton « Relancer ») mais apparaît dans
  l'onglet « À traiter par vous ».
- Le rattachement d'une relance sans en-tête est fait par une étape de code (référence citée,
  sinon le dossier le plus récent du même expéditeur), pas par un agent.

## Non vérifié

- Les evals en anglais et le jeu complet de 60 cas (budget LLM).
