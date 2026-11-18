# V5 — Tracing Langfuse Cloud et timeline en direct

**Résultat attendu** : chaque exécution est tracée dans Langfuse Cloud, et la timeline du dossier se remplit pendant que l'agent travaille, tour de boucle par tour de boucle.

**Services touchés** : `apps/agents`, `apps/core-api`, `apps/web`.

## Tracing

- Observabilité Mastra activée avec l'exportateur Langfuse ; clés et URL en variables d'environnement.
- Métadonnées sur chaque trace : `caseId`, `brokerageId`, `model`, `promptVersion`, `emailLanguage`.
- Une session Langfuse par dossier (traitement initial + reprises).
- L'identifiant de trace remonte à Core dans les rappels ; colonne `traceId` sur `Case`.

## Timeline en direct

- Rappel exécuté à chaque tour de boucle des agents (`onStepFinish` ou équivalent) : outil appelé, paramètres, résumé du résultat.
- Nouvelle route interne `POST /internal/cases/:id/agent-events`, poussée en SSE à l'UI (`case.agent_event`).
- Stockage structuré (`eventType` + `params`), rendu par next-intl : « Agent Garanties consulte le contrat C-48213 » / « Coverage agent checks policy C-48213 ».

## Répartition Core / Langfuse

- **Core** garde une ligne par étape significative, en langage métier : c'est l'audit.
- **Langfuse** garde le détail technique : prompts, réponses, tokens, coûts.
- Bouton « Voir la trace » dans l'audit, vers Langfuse.

## Critères d'acceptation

- [ ] Une trace par dossier dans Langfuse Cloud, avec un span par étape, appel LLM et appel d'outil MCP.
- [ ] Coût et tokens visibles par étape.
- [ ] La timeline affiche les appels d'outils en direct, en FR et en EN.
- [ ] Si Langfuse est injoignable, le workflow continue normalement.

**Hors périmètre** : evals, auto-hébergement.
