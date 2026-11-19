# V12 — Un seul courtier, Langfuse en local

Branche : `v12-single-broker` (créée depuis `v11-finishing`).
Spec : [`specs/v12-single-broker.md`](../../specs/v12-single-broker.md).

## Ce qui a été fait

### Un seul cabinet, un seul courtier

- `world-generator` : le monde ne contient plus que Delorme Courtage (`DLM-075`, `fr`) et Sophie
  Marchal. Vasseur & Associés et Hartley & Finch sont retirés ; tous les clients, y compris les
  anglophones, sont chez Delorme. Le scénario 14 (cabinet francophone, client anglophone) reste le
  cas bilingue de référence ; la note interne est donc toujours en français.

### Plus de connexion

- Core : suppression du garde global, des sessions (`Session`, `Broker.passwordHash`, migration
  `20261119120000_single_broker`), des routes `/auth/*`, du filtrage par cabinet et de
  `x-broker-id`. `GET /brokers` devient `GET /broker` (le courtier unique). Toute décision et toute
  relance sont enregistrées au nom de ce courtier.
- Une décision envoyée avec le jeton d'administration (le courtier simulé de la validation
  automatique) est marquée `params.auto = true` dans l'audit ; l'UI affiche un badge « auto » sur
  la proposition et sur la ligne d'audit.
- Web : page de connexion supprimée ; l'en-tête affiche « Courtier : Sophie Marchal — Delorme
  Courtage » ; plus de cookies ni de `withCredentials`.
- Conservés : jetons de service (passerelle → Core, Core → Mastra, Mastra → Core), jetons MCP
  `read` / `write` avec `brokerCode`, jeton d'administration sur `/admin/*`.

### Langfuse en local par défaut

- `npm run dev` démarre Langfuse auto-hébergé (profil `langfuse`) ; `.env.example` pointe vers
  `http://localhost:3100` avec les clés et le projet locaux. Langfuse Cloud est l'alternative en
  commentaire.
- `npm run dev:lite` : sans Langfuse (`TRACING_DISABLED=true`, `NEXT_PUBLIC_LANGFUSE_URL` vide) ;
  les liens « Voir la trace » sont alors masqués. `npm run dev:langfuse` est supprimé.
- Les liens de trace des rapports d'evals ouvrent la trace du projet (`/project/<id>/traces/<id>`).

## Tests

- Supprimés : `test/isolation.int-spec.ts` (Core) et les tests de mot de passe.
- Core (`cases-flow.int-spec.ts`) : `GET /broker` et `GET /cases` sans cookie ; décision humaine
  sans marqueur ; décision avec le jeton d'administration marquée `auto` au nom de Sophie Marchal.
- MCP : l'isolation reste testée avec un `brokerCode` étranger (`OTHER-000`) qui ne lit aucun
  contrat de Delorme.

## Vérifications

- `lint`, `typecheck`, `test`, `test:integration`, `format:check` : verts.
- Stack réelle (`npm run dev`) : `/fr` s'ouvre directement sur la boîte de réception, `/fr/login`
  renvoie 404 ; un e-mail réel traité jusqu'à `claim_filed` avec validation manuelle (audit sans
  badge) ; un autre validé automatiquement (badge « auto ») ; « Voir la trace » ouvre la trace dans
  le Langfuse local (24 k jetons, 0,002 $).
- Evals : jeu `seed-7` régénéré (60 cas, 37 FR / 23 EN) ; nouvelle référence sur 10 cas (tous FR,
  budget limité) : 9/10 dossiers entièrement corrects, 0,0030 $ par dossier. Le cas en échec
  (`eval-7-004`, exclusion) est un verdict faux du modèle, pas une régression de V12.

## Variables d'environnement

Supprimées : `SESSION_TTL_HOURS`, `COOKIE_SECURE`, `DEMO_BROKER_PASSWORD`. Nouvelle (posée par
`npm run dev:lite` uniquement) : `TRACING_DISABLED`. Valeurs par défaut de Langfuse passées en local.
