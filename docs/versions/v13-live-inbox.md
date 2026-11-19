# V13 — Boîte de réception vivante

Branche : `v13-live-inbox` (créée depuis `v12-single-broker`).
Spec : [`specs/v13-live-inbox.md`](../../specs/v13-live-inbox.md).

## Ce qui a été fait

### Statut lisible par dossier

- Mastra annonce le **début** de chaque étape : nouvel événement d'agent `step_started`
  (`params.step` = `triage`, `coverage`, `drafting` ou `execute`, avec le modèle et le numéro de
  révision). Il apparaît aussi dans le déroulé (« Agent Garanties démarre (modèle gpt-6-luna) »).
- Core garde l'étape en cours et le dernier outil appelé (`Case.currentStep` / `currentTool`,
  migration `20261119130000_live_stage`) et expose dans `CaseSummary` : `stage` (`queued`,
  `triage`, `coverage`, `drafting`, `awaiting_approval`, `execute`, `done`, `failed`),
  `currentTool` (« read_clause CG-HZ-12.1 ») et `revision`.
- `GET /agents/activity` : pour chaque agent, dossiers en cours, modèle, dernier dossier et outil ;
  dossiers en file, en attente du courtier et en exécution.

### Boîte de réception

- Mini-pipeline sur chaque ligne (Tri → Garanties → Rédaction → Validation → Exécution) : gris,
  bleu animé, vert, orange pulsant (attend le courtier), rouge ; libellé de l'étape et outil MCP
  en cours.
- Onglets avec compteurs (Tous, En cours, À valider, Traités, En erreur), vue **Liste** ou
  **Colonnes** (kanban en lecture seule, 25 cartes par colonne), choix mémorisé dans le navigateur.
- Arrivée d'un e-mail : ligne surlignée et animée, point « non lu » jusqu'à l'ouverture, toast
  « Nouvel e-mail de … » ; au-delà de 5 arrivées d'un coup (rafale), ni toast ni animation.
- Titre de l'onglet : « (3) Pôle sinistres » tant que 3 dossiers attendent la validation.
- Son facultatif (bouton dans l'en-tête, coupé par défaut) quand un dossier passe « à valider »,
  au plus un toutes les 2 s.
- Les événements d'agent mettent à jour la ligne sur place ; les autres rechargent la liste au
  plus une fois toutes les 400 ms (fluide en rafale).

### Panneau « Agents en direct »

- Les trois agents : modèle, nombre de dossiers en cours, dossier et outil en cours (« appelle
  read_clause CG-HZ-4.2 ») ou « réfléchit… » pendant l'appel au LLM ; dossiers en file, en attente
  du courtier (workflows suspendus, aucun jeton consommé) et en exécution.

### Page d'un dossier

- Stepper en haut de page avec la durée de chaque étape (calculée à partir des événements).
- Dernière ligne du déroulé tant qu'un agent travaille : « Agent Garanties en cours… dernier
  outil : … ».
- Bloc « Sous le capot » : liens vers le run dans **Mastra Studio**
  (`/workflows/processEmailWorkflow/graph/<runId>`) et vers la trace **Langfuse** ; jetons, temps
  LLM, modèles, identifiant du run.
- Après un refus, les propositions s'affichent côte à côte.

### Panneau de démo

- Bouton **« Scénario phare »** : le simulateur (`POST /send-showcase`) envoie l'e-mail du
  scénario 2 (contrat C-48213 résilié que le cabinet croit actif), comme un nouveau message à chaque
  clic.
- Mini-graphique du débit (dossiers traités par minute).

### Divers

- Core : `forceCloseConnections` à l'arrêt ; sans cela, un rechargement en mode watch restait
  bloqué tant qu'un navigateur gardait le flux SSE ouvert.

## Tests

- Core : `caseStage` (tous les statuts) ; intégration : `step_started` puis `tool_call` →
  `stage: coverage`, `currentTool`, et `/agents/activity` ; `awaiting_approval` et `revision` après
  une proposition.

## Vérifications

- `lint`, `typecheck`, `test`, `test:integration`, `format:check` : verts.
- Stack réelle (vrais modèles) : « Scénario phare » → toast, ligne animée, puis en direct « Tri en
  cours » (find_client), « Analyse de couverture » (get_policy, list_coverages, read_clause…),
  « Rédaction », « À valider » (titre « (1) … », onglet orange) ; validation → stepper entièrement
  vert avec durées ; vue Colonnes en FR et en EN ; lien Mastra Studio ouvert sur le run.
- Non vérifié : la rafale de 1 000 dossiers avec la nouvelle UI (budget LLM) ; à essayer avec
  `AGENTS_MODE=simulated`.

## Variables d'environnement

Nouvelle : `NEXT_PUBLIC_MASTRA_STUDIO_URL` (par défaut `http://localhost:4111`).
