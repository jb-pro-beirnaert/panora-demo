# V12 — Un seul courtier, Langfuse en local

**Résultat attendu** : la démo s'ouvre directement sur la boîte de réception, sans connexion. Tous les e-mails envoyés arrivent chez un seul cabinet et un seul courtier, et sont visibles et traités. `npm run dev` démarre Langfuse en local, et le lien « Voir la trace » ouvre la trace sur `localhost`.

**Pourquoi** : le but de la démo est de montrer le travail des agents, Mastra, les evals et Langfuse. Le multi-cabinet et la connexion (V10) compliquent la démo sans rien montrer de ces sujets.

**Services touchés** : `packages/world-generator`, `apps/core-api`, `apps/web`, `apps/simulator`, `apps/agents` (callbacks uniquement), `evals`, `compose.yaml`, `.env.example`, scripts racine.

**Remplace** : la partie « Authentification et droits » de V10 côté courtier. Les jetons de service et les jetons MCP sont conservés.

## 1. Un seul cabinet, un seul courtier

- Le monde généré ne contient plus qu'**un cabinet** : Delorme Courtage (`DLM-075`, `locale: fr`, `sinistres@delorme-courtage.fr`). Il a **un seul courtier**, Sophie Marchal. Vasseur & Associés et Hartley & Finch Brokers sont retirés.
- Tous les clients appartiennent à Delorme, y compris les clients anglophones. Le volume de clients et de contrats reste suffisant pour que le flux tire tous les scénarios du catalogue.
- Le scénario 10 (client inconnu) envoie lui aussi l'e-mail à Delorme.
- Scénarios multilingues :
  - le scénario 14 (cabinet francophone, client anglophone) reste le cas bilingue de référence ;
  - le cas « cabinet anglophone, note interne en anglais » disparaît ;
  - la note interne est toujours en français (`Brokerage.locale`) ; le brouillon client suit toujours la langue de l'e-mail.
- `specs/00-demo-data-and-scenarios.md` est mis à jour en conséquence.

## 2. Plus de connexion

- **Supprimés** :
  - la page `/[locale]/login` ;
  - les routes `/auth/*` (`login`, `logout`, `me`, `demo-accounts`) ;
  - la table `Session` et `Broker.passwordHash` ;
  - le cookie de session ;
  - le bouton « Se déconnecter » ;
  - `DEMO_BROKER_PASSWORD`, `SESSION_TTL_HOURS`, `COOKIE_SECURE`.
- **Plus de filtrage par cabinet** dans Core : liste, compteurs, détail, décision, relance et flux SSE renvoient tout. Les contrôles « autre cabinet » (404 / 403) disparaissent.
- **Le courtier est implicite.** Core connaît le courtier unique et l'utilise pour toute décision et relance : il est enregistré dans `ProposedAction.decidedBy` et dans `AuditLog`. Le header `x-broker-id` n'existe plus. `POST /cases/:id/decision` ne prend que `{ approved, comment? }`.
- **En-tête de l'UI** : affichage fixe « Sophie Marchal · Delorme Courtage », sans menu ni déconnexion.
- **Ce qui reste protégé**, car c'est invisible pour l'utilisateur et fait partie de l'architecture :
  - jetons de service passerelle → Core, Core → Mastra et Mastra → Core ;
  - jetons MCP `read` / `write` avec `brokerCode` (moindre privilège) ;
  - jeton d'administration sur `/admin/*` (uniquement avec `DEMO_MODE=true`).

## 3. Validation automatique

- Le courtier simulé décide au nom de Sophie Marchal, en passant par le jeton d'administration.
- Toute décision prise par le simulateur est marquée comme automatique, par exemple avec `AuditLog.params.auto = true`. L'UI affiche un badge « auto » à côté de la décision : on distingue ainsi un clic humain d'une décision simulée.

## 4. Langfuse en local par défaut

**Aujourd'hui** :
- `npm run dev` ne démarre pas Langfuse ;
- `.env.example` pointe vers Langfuse Cloud (`LANGFUSE_BASE_URL` et `NEXT_PUBLIC_LANGFUSE_URL`) ;
- le lien « Voir la trace » ouvre donc `cloud.langfuse.com`, même sans clés Cloud ;
- le Langfuse local n'existe qu'avec `npm run dev:langfuse` et 5 lignes de `.env` à changer.

**V12** :
- `npm run dev` démarre Langfuse auto-hébergé (profil Compose `langfuse`).
- Les valeurs par défaut de `.env.example` pointent vers `http://localhost:3100`, avec les clés et l'id de projet locaux (`pk-lf-local-demo`, `sk-lf-local-demo`, `panora-demo`). Le lien « Voir la trace » ouvre donc la trace locale.
- Langfuse Cloud devient l'alternative documentée, en commentaire dans `.env.example`.
- `npm run dev:lite` démarre la stack sans Langfuse, pour une machine peu puissante. Le tracing est alors désactivé.
- Le bouton « Voir la trace » est masqué quand `NEXT_PUBLIC_LANGFUSE_URL` est vide : plus de lien vers un Langfuse qui n'a pas la trace.
- La page de connexion de Langfuse (`demo@panora-demo.local` / `demo-password`) est rappelée dans le README.

## 5. Tests et evals

- Supprimés : les tests de cloisonnement Core (`test/isolation.int-spec.ts`) et les tests de session et de mot de passe.
- Conservés : les tests d'isolation du serveur MCP. L'extranet de l'assureur sert plusieurs cabinets dans la réalité : un jeton d'un autre `brokerCode` (fixture de test) reçoit toujours « access denied ».
- Nouveaux tests :
  - une décision sans aucun en-tête d'identité est enregistrée au nom du courtier unique ;
  - toutes les routes publiques de Core répondent sans cookie.
- Evals :
  - régénérer `evals/datasets/seed-7.json` avec le monde à un seul cabinet ;
  - relancer un échantillon, puis enregistrer une nouvelle `baseline.json` ;
  - les seuils (`thresholds.json`) restent inchangés.

## Critères d'acceptation

- [ ] `npm run dev` puis `http://localhost:3000` affiche directement la boîte de réception, sans page de connexion.
- [ ] Chaque e-mail envoyé par le simulateur (flux, « Envoyer 1 e-mail », rafale) crée un dossier visible dans la boîte de réception et traité jusqu'au bout.
- [ ] Valider ou refuser enregistre « Sophie Marchal » dans l'audit ; une décision automatique porte le badge « auto ».
- [ ] Avec `npm run dev`, « Voir la trace » ouvre `http://localhost:3100/project/panora-demo/traces/<id>` et la trace existe.
- [ ] Avec `npm run dev:lite`, le bouton « Voir la trace » n'apparaît pas.
- [ ] `fr.json` et `en.json` n'ont plus aucune clé liée à la connexion, et ont toujours des clés identiques.
- [ ] CI verte, evals au-dessus des seuils avec la nouvelle baseline.

## Hors périmètre

- Toute refonte visuelle de la boîte de réception et des statuts (V13).
- Une démo en ligne : la démo tourne uniquement en local (`localhost`). Sa protection n'est donc pas traitée, et le guide de déploiement (`docs/deployment.md`) n'est plus à maintenir.
