# V5 — Tracing Langfuse et timeline en direct

Branche : `v5-tracing-cloud` (créée depuis `v4-multilingual-data`).
Spec : [`specs/v05-tracing-cloud.md`](../../specs/v05-tracing-cloud.md).

## Ce qui a été fait

### Tracing (`apps/agents`)

- Paquets `@mastra/observability` + `@mastra/langfuse`. `src/mastra/observability.ts` construit
  l'observabilité Mastra avec un `LangfuseExporter` à partir de `LANGFUSE_PUBLIC_KEY`,
  `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `LANGFUSE_ENVIRONMENT`. Sans clés : tracing désactivé
  (message au démarrage), rien d'autre ne change.
- **Une trace et une session par dossier** : Core dérive le `traceId` de l'id du dossier (UUID sans
  tirets, 32 caractères hexadécimaux) et le passe dans `tracingOptions` au démarrage **et** à chaque
  reprise ; `metadata.sessionId = caseId` (l'exportateur Langfuse le transforme en session).
  Métadonnées de la trace : `caseId`, `brokerCode`, `emailLanguage`.
- Sur le span de chaque étape d'agent : `agent`, `model`, `promptVersion` (hash court du prompt,
  `prompts/versions.ts`), `emailLanguage` (et `revision` pour la rédaction). Les appels d'agent
  reçoivent le `tracingContext` de l'étape : appels LLM et outils MCP sont des spans enfants.
- Une erreur de tracing ne casse jamais une étape (mise à jour du span dans un `try`), et l'export
  est asynchrone par lots.

### Timeline en direct

- `onStepFinish` de chaque appel d'agent (triage, coverage) → `toolCallEvents()` extrait l'outil
  appelé et les quelques arguments utiles (numéro de contrat, référence de clause, e-mail) →
  `POST /internal/cases/:id/agent-events` → table `AgentEvent` (`eventType` + `params`) → SSE
  `case.agent_event`.
- UI : les appels d'outils s'intercalent dans le déroulé (« Agent Garanties consulte le contrat
  C-48213 chez l'assureur » / « Coverage agent checks policy C-48213 at the insurer »), traduits via
  `events.tool.*`.

### Core / Langfuse

- `Case.traceId`, `AgentStep.inputTokens` / `outputTokens` (migration
  `tracing_and_agent_events`) ; les jetons sont affichés à côté de chaque étape.
- Core garde une ligne d'audit par étape métier ; les appels d'outils (techniques) ne vont **pas**
  dans l'audit (testé) ; prompts, réponses, jetons et coûts détaillés sont dans Langfuse.
- Bouton « Voir la trace » dans l'audit : `NEXT_PUBLIC_LANGFUSE_URL/trace/<traceId>` (ou
  `/project/<id>/traces/<traceId>` si `NEXT_PUBLIC_LANGFUSE_PROJECT_ID` est renseigné).

## Tests

- Agents : `toolCallEvents` (deux formes possibles des appels d'outils, arguments filtrés).
- Core : `caseTracing` (trace et session dérivées du dossier) ; intégration : le worker passe le
  `traceId` et la session à Mastra et les stocke, route `agent-events` (validation, SSE, pas
  d'audit).
- Web : rendu FR/EN d'un appel d'outil, outil inconnu.

### Vérification de bout en bout (vrais modèles, un dossier)

Pas de clés Langfuse Cloud fournies : la stack a tourné avec des clés factices et
`LANGFUSE_BASE_URL=http://localhost:9` (injoignable). Scénario 2 : le dossier est allé jusqu'à
`awaiting_approval` normalement (critère « Langfuse injoignable ⇒ le workflow continue »), avec 7
appels d'outils remontés en direct (`find_client`, `get_policy`, `read_clause` ×3,
`list_coverages`, `get_claim_history`) et les jetons par étape. L'arrivée réelle des traces est
vérifiée en V6 avec Langfuse auto-hébergé (même code, autre URL).

## Variables d'environnement

`LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL`, `LANGFUSE_ENVIRONMENT`,
`NEXT_PUBLIC_LANGFUSE_URL`, `NEXT_PUBLIC_LANGFUSE_PROJECT_ID`.
