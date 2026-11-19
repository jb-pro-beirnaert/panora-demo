# V9 — Échelle et résilience

Branche : `v9-scale-resilience` (créée depuis `v8-cost-latency`).
Spec : [`specs/v09-scale-resilience.md`](../../specs/v09-scale-resilience.md).

## Ce qui a été fait

### Charge

- Simulateur : `POST /burst { count, concurrency? }` (`stream/burst.ts`) — e-mails uniques plus ~5 %
  de doublons d'e-mails déjà envoyés (pour prouver la déduplication) ; bouton « Rafale (1 000) » et
  progression dans le panneau de démo, avec débit (traités/min), files en attente et erreurs en
  direct (`GET /cases/metrics` de Core).
- Workers BullMQ : `WORKER_CONCURRENCY`, limiteur `WORKER_RATE_MAX` / `WORKER_RATE_DURATION_MS`
  aligné sur le quota LLM (`queues/worker-options.ts`).
- Déduplication : identifiant de tâche = id de l'e-mail (déjà en V3) **et** prise atomique du
  dossier par le worker (`updateMany where status = received and workflowRunId = null`) : deux
  tâches pour le même dossier ne lancent qu'un run (testé).
- Mastra en 2 instances : `MASTRA_URL` accepte une liste ; Core fait du round robin avec bascule
  sur erreur réseau, timeout ou 5xx. Le stockage étant partagé (base `agents`), une reprise ou un
  redémarrage peut s'exécuter sur n'importe quelle instance.

### Résilience

- Relances BullMQ avec délai exponentiel (3 tentatives) sur le démarrage et la reprise.
- Relances des étapes Mastra : `retryConfig` sur `process-email` et `handle-claim`
  (`WORKFLOW_STEP_ATTEMPTS`).
- Relance de chaque appel d'outil MCP (`resilience.ts`, `MCP_RETRY_ATTEMPTS`) sur erreurs
  transitoires (timeout, 429, 5xx, « temporarily unavailable ») ; compteurs exposés par
  `GET /resilience-stats` sur chaque instance Mastra.
- Délais explicites : MCP (`MCP_TIMEOUT_MS`), appels LLM (`LLM_TIMEOUT_MS`, `abortSignal`), Core →
  Mastra (10 s), Mastra → Core (5 s).
- MCP « extranet capricieux » (`apps/mcp-extranet/src/chaos/`) : `CHAOS_LATENCY_MIN_MS`,
  `CHAOS_LATENCY_MAX_MS`, `CHAOS_ERROR_RATE`, `CHAOS_RATE_LIMIT_PER_SECOND` ; n'affecte que les
  `tools/call` ; statistiques dans `/health`.
- **Watchdog** (`queues/watchdog.service.ts`, tâche BullMQ répétée toutes les 30 s, file
  `maintenance`) : relance les dossiers jamais démarrés (sans tâche en attente), redémarre depuis
  leur dernier snapshot (`/workflows/:id/restart`) les runs sans activité depuis
  `STUCK_CASE_AFTER_MS`, renvoie les reprises perdues, et passe le dossier en échec après 3
  redémarrages.
- Dossiers en échec : raison affichée, bouton « Relancer » (`POST /cases/:id/retry`, nouveau run,
  historique conservé, audit `workflow_retried`).
- `AGENTS_MODE=simulated` : remplaçants déterministes des 3 agents (`simulated/agents.ts`) qui
  passent par le vrai workflow et les vrais appels MCP — tests de charge sans coût LLM (budget).

## Mesures

`npm run load-test -w apps/simulator -- --count 1000` (`src/load-test.ts`) ; résultats JSON dans
[`docs/load-tests/`](../load-tests/), synthèse dans le README.

Exécution de référence : 2 instances Mastra (agents simulés, 4 s par agent), 5 % d'erreurs et
50–400 ms de latence côté extranet, 300 démarrages/min, **une instance tuée (`kill -9`) 8 s après le
début de la rafale** :

- 1 000 dossiers créés, **1 000 traités, 0 échec**, 1 000 runs distincts (aucun traité deux fois) ;
  43 doublons envoyés, 0 dossier en trop ;
- débit 299 dossiers/min (= limiteur), durée par dossier p50 86 s / p95 191 s (attente dans la
  file) ;
- 104 runs interrompus par l'arrêt de l'instance, redémarrés par le watchdog ;
- 205 erreurs injectées par l'extranet, taux de relance MCP 2,9 %, 0 échec définitif ;
- coût LLM : 0 $ (simulé) ; ≈ 3,40 $ avec les vrais modèles (0,0034 $/dossier mesuré en V8).

Test ciblé « arrêt d'instance » (300 dossiers) : 100 runs interrompus, tous redémarrés, 300/300
traités.

## Bugs trouvés par les tests de charge et corrigés

1. Le watchdog re-mettait en file des dossiers qui attendaient simplement derrière le limiteur
   (≈ 220 tâches en trop pendant la première rafale, sans double traitement grâce au garde du
   worker) → il ignore désormais les dossiers ayant une tâche en attente, et le worker prend le
   dossier de façon atomique.
2. À l'arrêt (SIGTERM), Core attendait indéfiniment la fin des flux SSE ouverts : le processus ne
   recevait plus de connexions mais gardait celle du simulateur (courtier simulé bloqué) → les flux
   SSE se terminent à l'arrêt (`beforeApplicationShutdown`), et le client SSE se reconnecte après
   45 s sans message (le heartbeat passe toutes les 15 s).

## Tests

- MCP : chaos (passage de `tools/list`, taux d'erreur, limite de débit).
- Agents : relance avec délai croissant, abandon après la dernière tentative, erreurs transitoires
  vs erreurs métier.
- Core (intégration, 22 tests) : relance d'un dossier en échec, watchdog (redémarrages puis échec,
  pas de remise en file d'un dossier en attente), deux tâches → un seul run, métriques.
- Simulateur : plan de rafale (uniques + doublons), comptage.
- Web : traductions des nouvelles actions d'audit.

## Variables d'environnement

Core : `WORKER_CONCURRENCY`, `WORKER_RATE_MAX`, `WORKER_RATE_DURATION_MS`, `STUCK_CASE_AFTER_MS`,
`MASTRA_URL` (liste possible). MCP : `CHAOS_*`. Mastra : `MCP_TIMEOUT_MS`, `MCP_RETRY_ATTEMPTS`,
`LLM_TIMEOUT_MS`, `WORKFLOW_STEP_ATTEMPTS`, `AGENTS_MODE`, `SIMULATED_LLM_LATENCY_MS`.
