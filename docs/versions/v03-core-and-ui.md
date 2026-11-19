# V3 — Core API + Next.js bilingue + simulateur

Branche : `v3-core-and-ui` (créée depuis `v2-full-workflow`).
Spec : [`specs/v03-core-and-ui.md`](../../specs/v03-core-and-ui.md).

## Ce qui a été fait

### Nouveaux services

| Service | Créé avec | Rôle |
| --- | --- | --- |
| `apps/core-api` (port 3001) | `nest new core-api --strict` (Nest 12 : ESM, Vitest, oxlint) | métier, audit, files BullMQ, SSE |
| `apps/web` (port 3000) | `create-next-app` (Next 16) puis `shadcn init` + `shadcn add …` | UI courtier FR/EN + panneau de démo |
| Redis (6379) | `compose.yaml`, `--save '' --appendonly no` | files BullMQ, sans persistance |

`infra/postgres/init.sql` crée maintenant la base `core` en plus de `extranet` et `agents`.

### Core API (`apps/core-api`)

- **Prisma** (`prisma/schema.prisma`, migration `init`) : `Brokerage`, `Broker`, `Client`, `Policy`
  (`knownStatus`), `InboundEmail`, `Attachment`, `Case`, `AgentStep`, `ProposedAction`, `AuditLog`.
  Migrations appliquées au démarrage (`prisma migrate deploy` dans `dev` et `start`).
- **API publique** : `POST /emails`, `GET /brokers`, `GET /cases`, `GET /cases/stats`,
  `GET /cases/:id`, `POST /cases/:id/decision`, `GET /realtime` (SSE), `GET /health`.
- **Routes internes** (jeton `CORE_SERVICE_TOKEN`, appelées par Mastra) :
  `POST /internal/cases/:id/{steps,proposed-action,executed-action,failed}` et
  `GET /internal/clients?email=&brokerCode=` (outil `find_client`).
  Un rappel pour un dossier inexistant renvoie `{ status: 'ignored' }`.
- **Admin** (`/admin/seed`, `/admin/reset`) : module enregistré **seulement** si `DEMO_MODE=true`
  (`AppModule.register({ demoMode })`), protégé par `ADMIN_TOKEN`. Le reset fait un `TRUNCATE …
  RESTART IDENTITY` (les dossiers repartent à `CASE-0001`), vide les deux files et émet `demo.reset`.
- **Files BullMQ** (`@nestjs/bullmq`) :
  - `process-email` : `createRun` sur Mastra → enregistre `workflowRunId` + statut `processing` →
    `start` (Mastra exécute en arrière-plan) → retour immédiat. L'identifiant de tâche est l'id de
    l'e-mail ; un job rejoué ne relance pas un deuxième run.
  - `resume-workflow` : `resume-no-wait` sur Mastra avec `{ approved, comment?, brokerId }`.
  - Relances : 3 tentatives, délai exponentiel.
- **Validation** : toutes les entrées passent par les schémas Zod de `@demo/shared`, via
  `StandardSchemaValidationPipe` de Nest 12 (`@Body({ schema })`).
- **Idempotence** : même `messageId` → même dossier (y compris en cas de course, code Prisma
  `P2002`) ; même révision de proposition rejouée → rien ne change (pas de doublon d'audit).
- **Décision** : mise à jour conditionnelle (`updateMany where status = pending`), donc deux
  décisions simultanées ne peuvent pas gagner toutes les deux ; un courtier d'un autre cabinet
  reçoit 403.
- **Audit** : `AuditService.record()` ne fait que des `create` ; aucune route ne modifie ou ne
  supprime l'audit (testé). Chaque étape, proposition, décision, reprise et exécution y est écrite
  sous forme `action + params`.
- **Écart cabinet / assureur** : à la réception de l'étape `coverage.policy_checked`, Core ajoute
  `knownStatus` (ce que croit le cabinet) aux paramètres ; l'UI met l'écart en évidence.

### Mastra (`apps/agents`)

- `ProcessEmailInput` a un `caseId` optionnel : sans lui (Mastra Studio), rien n'est rapporté.
- `core-callbacks/core-client.ts` : client des routes internes (3 tentatives, timeout 5 s ; un échec
  est loggé, jamais propagé au workflow).
- `core-callbacks/step-reports.ts` : fonctions pures qui transforment les sorties structurées des
  agents en étapes métier `stepType + params + sources` (testées).
- Outil `find_client` (`tools/find-client.ts`) donné à `triageAgent` : appelle Core, rapporte
  `triage.client_found` / `triage.client_not_found`, garde le résultat dans le `RequestContext`.
  Si le modèle oublie l'outil, l'étape `triage` fait la recherche elle-même. Le résultat est passé
  à `coverageAgent` (contrats connus du cabinet, utile quand l'e-mail ne donne pas de numéro).
- Rapports : `prepare.completed`, `triage.*`, `coverage.policy_checked`, `coverage.verdict`,
  `drafting.proposed`, `execute.*` ; `approval` envoie `proposed-action` juste avant `suspend()`.
- Résultat final et échecs : via les callbacks `onFinish` / `onError` du workflow `process-email`.
- Prompts : consigne `find_client` (triage), alerte `unknown_client` (coverage, drafting).

### Données (`packages/shared`, `packages/world-generator`)

- `packages/shared/src/core.ts` : seed Core, rappels Mastra → Core, décision, événements SSE,
  vues de l'API (`CaseSummary`, `CaseDetail`…), statuts, types d'étapes et d'audit.
- `packages/shared/src/language.ts` : petit détecteur de langue par mots outils (FR seulement en
  V3, l'anglais arrive en V4).
- Scénario 10 « client inconnu » : nouvelle alerte `unknown_client`, nouvelle vérité terrain
  `UnknownClientGroundTruth`, e-mail écrit par une entreprise absente du monde.
- `toCoreSeed(world)` : partie cabinet du monde pour `POST /admin/seed` de Core.

### Simulateur (`apps/simulator`)

- Seed de Core **et** du MCP au démarrage (attente de `/health`, relances).
- `stream/email-stream.ts` : flux à cadence réglable, aléa ±40 % entre deux envois, premier
  e-mail immédiat ; après un tour complet du pool, les `messageId` reçoivent un suffixe.
- `control/routes.ts` : `GET /state`, `POST /start`, `/pause`, `/resume`, `/speed`, `/send-one`,
  `/reset`, `/auto-validation` (CORS pour l'UI).
- `auto-validation/auto-validator.ts` : courtier simulé, écoute le SSE de Core, décide après un
  délai (80 % de validations par défaut, refus avec commentaire, au plus 2 refus par dossier).

### Interface (`apps/web`)

- next-intl : routes `/fr/…` et `/en/…` (`src/proxy.ts`, ex-middleware en Next 16), langue par
  défaut `fr`, cookie `NEXT_LOCALE`, sélecteur dans l'en-tête.
- `messages/fr.json` / `en.json` : aucune chaîne en dur dans les composants.
- Boîte de réception en direct (SSE), vue dossier (e-mail + pièces, déroulé avec sources,
  propositions successives avec badges de langue, Valider / Refuser avec commentaire, audit),
  bandeau « le cabinet croit le contrat actif, l'assureur le dit résilié », panneau de démo.
- `src/lib/render.ts` : rend `stepType + params` et `action + params` dans la langue de l'UI
  (valeurs neutres traduites, montants en euros et dates formatés selon la langue).
- Sélection du courtier (V3) : liste du seed, mémorisée dans le navigateur, envoyée en `x-broker-id`.

## Tests

| Où | Type | Ce qui est couvert |
| --- | --- | --- |
| `apps/core-api/src/**/*.spec.ts` | unitaires (Vitest) | env, vues des dossiers |
| `apps/core-api/test/cases-flow.int-spec.ts` | intégration, vrai Postgres (`core_test`) + Redis (db 1) | cycle complet d'un dossier, idempotence, jetons, cloisonnement de la décision, rappels ignorés, échec, reset, pas de route d'écriture sur l'audit, pas d'`/admin` sans `DEMO_MODE` (16 tests) |
| `apps/agents/src/**/*.test.ts` | unitaires | construction des rapports d'étapes |
| `apps/simulator/src/**/*.test.ts` | unitaires | cadence, pause/reprise, cycles, erreurs, décision simulée, parseur SSE |
| `apps/web/src/lib/messages.test.ts` | unitaires | mêmes clés FR/EN, une traduction pour chaque valeur stockée, rendu des étapes en FR et EN |
| `packages/world-generator` | unitaires | nouveau scénario, seed Core cohérent |

Commandes : `npm test` (unitaires) et `npm run test:integration` (demande `docker compose up -d
postgres redis`).

### Vérification de bout en bout (vrais modèles OpenAI, un seul dossier)

Scénario 2 (Boulangerie Martin, contrat C-48213) envoyé à `POST /emails` :
`client_found` → `triage.completed` → `policy_checked` (assureur `terminated`, cabinet `active`) →
verdict `not_covered` + `policy_terminated` → proposition `notify_denial` (note interne en
français qui signale l'écart en premier). Refus avec « Ajoute le numéro de contrat dans l'objet » →
proposition 2 avec « … – contrat C-48213 » dans l'objet → validation → `ready_to_send`. Reset du
simulateur : < 0,1 s, interface et bases vides puis re-remplies.

## Choix et écarts

- Nest 12 génère un projet ESM + Vitest + oxlint : gardés tels quels (installateur par défaut).
- Le front appelle Core et le simulateur directement (CORS) plutôt que via un proxy Next : le SSE
  passe sans tampon.
- `cacheComponents` du template Next désactivé : les pages sont des composants clients qui lisent
  Core en direct.
- Statuts de dossier : `received`, `processing`, `awaiting_approval`, `classified`, `claim_filed`,
  `ready_to_send`, `failed` (ajout de `failed`, rapporté par `onError`).
- Ajout d'une route `POST /internal/cases/:id/failed` (non listée dans la spec) pour qu'un dossier
  en échec ne reste pas « en traitement ».

## Variables d'environnement ajoutées

`REDIS_PORT`, `CORE_API_PORT`, `CORE_DATABASE_URL`, `REDIS_URL`, `CORE_API_URL`,
`CORE_SERVICE_TOKEN` (obligatoire, sans valeur par défaut), `MASTRA_URL`, `WEB_ORIGIN`,
`SIMULATOR_EMAILS_PER_MINUTE`, `NEXT_PUBLIC_CORE_API_URL`, `NEXT_PUBLIC_SIMULATOR_URL` ;
`SIMULATOR_EMAIL_COUNT` passe à 40 par défaut. Voir `.env.example`.
