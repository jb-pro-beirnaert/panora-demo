# V10 — Sécurité et conformité

Branche : `v10-security-compliance` (créée depuis `v9-scale-resilience`).
Spec : [`specs/v10-security-compliance.md`](../../specs/v10-security-compliance.md).

## Ce qui a été fait

### Authentification et droits

- **Connexion des courtiers** (comptes du seed, mot de passe `DEMO_BROKER_PASSWORD` haché en scrypt
  au seed) : `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `GET /auth/demo-accounts`
  (mode démo seulement). Session côté Core : table `Session` (seul un hash SHA-256 du jeton est
  stocké), cookie `httpOnly`, `SameSite=Lax`, durée `SESSION_TTL_HOURS`.
- **Garde globale** (`AuthGuard`, `APP_GUARD`) : session de courtier, ou jeton d'administration en
  mode démo (simulateur, evals, tests de charge) qui agit pour un courtier nommé dans `x-broker-id`.
  Hors mode démo, le jeton d'administration n'ouvre rien.
- **Filtrage par cabinet** de chaque requête : liste, compteurs, courtiers, détail (un dossier d'un
  autre cabinet répond 404), décision et relance (403), flux SSE (événements porteurs du
  `brokerageId`, filtrés par principal).
- `brokerCode` porté de Core à Mastra puis dans le jeton MCP (depuis V2) : vérifié par les tests MCP.
- **Jetons de service distincts** : passerelle d'e-mails → Core (`INBOUND_EMAIL_TOKEN`), Core →
  Mastra (`MASTRA_API_TOKEN`, middleware sur `/api/*`, `/maintenance/*`, `/resilience-stats` ; le
  Studio garde l'accès en dev depuis sa propre origine), Mastra → Core (`CORE_SERVICE_TOKEN`),
  Mastra → MCP (`read` / `write` signés), simulateur → `/admin/*` (`ADMIN_TOKEN`).
- UI : page de connexion (comptes de démo cliquables), nom du courtier et « Se déconnecter » dans
  l'en-tête, cookies envoyés à Core (`credentials: 'include'`, `EventSource` `withCredentials`).

### Tests de cloisonnement (CI)

- Core (`test/isolation.int-spec.ts`) : sans session → 401 ; mauvais mot de passe → 401 ; un
  courtier ne liste et ne lit que son cabinet (l'autre → 404) ; ne décide ni ne relance chez un autre
  (403, même en nommant un courtier) ; le flux SSE ne porte que ses événements ; une session ne
  donne accès ni aux routes internes, ni à l'admin, ni à `POST /emails` ; le jeton d'admin n'ouvre
  pas les routes internes ; déconnexion ; hors `DEMO_MODE` : pas de `/admin/*`, pas de comptes de
  démo, jeton d'admin refusé.
- MCP (`apps/mcp-extranet/src/isolation.int.test.ts`, vraie base `extranet_test`) : un cabinet lit
  ses contrats ; le jeton d'un cabinet ne lit aucun contrat d'un autre (`get_policy`,
  `list_coverages`, `get_claim_history` → access denied, `search_policy` ne le renvoie pas) ; un
  jeton `read` ne voit ni n'appelle `file_claim` ; jeton absent ou forgé → 401.
- `ci.yml` : le job d'intégration lance les deux suites (`npm run test:integration`).

### Données et RGPD

- `AuditLog` en écriture seule (depuis V3, testé : aucune route PUT/PATCH/DELETE).
- **Purge planifiée** (`PurgeService`, tâche BullMQ répétée `purge`, toutes les `PURGE_EVERY_MS`) :
  pour les dossiers clos depuis plus de `RETENTION_DAYS`, Core demande à Mastra
  (`POST /maintenance/purge`) de supprimer les snapshots du workflow (et des sous-workflows) et les
  traces Langfuse, marque `Case.purgedAt` et écrit `data_purged` dans l'audit. Testée côté Core
  (seuil, idempotence) et côté Mastra (suppression de chaque snapshot, validation des ids).
- README : données traitées, durées de conservation, ce qu'il faudrait en production.

## Vérification sur la stack réelle (agents simulés, 0 $)

Connexion d'un courtier Delorme → `GET /auth/me` ; sans session : 401 ; Mastra sans jeton : 401 ;
4 e-mails envoyés (plusieurs cabinets) → le courtier n'en voit qu'un (le sien) ; décision par
session → `claim_filed`, audit au nom du courtier ; pages `/fr/login` et `/en/login` servies.

## Variables d'environnement

Nouvelles et **obligatoires** : `INBOUND_EMAIL_TOKEN` (Core, simulateur, evals),
`MASTRA_API_TOKEN` (Core ; Mastra l'applique dès qu'il est défini). Facultatives :
`SESSION_TTL_HOURS`, `COOKIE_SECURE`, `DEMO_BROKER_PASSWORD`, `RETENTION_DAYS`, `PURGE_EVERY_MS`.
