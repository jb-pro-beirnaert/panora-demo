# V6 — Langfuse auto-hébergé

Branche : `v6-tracing-self-hosted` (créée depuis `v5-tracing-cloud`).
Spec : [`specs/v06-tracing-self-hosted.md`](../../specs/v06-tracing-self-hosted.md).

## Ce qui a été fait

- `compose.yaml`, profil `langfuse`, adapté du `docker-compose.yml` officiel de Langfuse (images v4) :
  `langfuse-web` (port **3100**), `langfuse-worker`, `langfuse-clickhouse`, `langfuse-minio`,
  `langfuse-redis`. **Aucun volume** : ClickHouse, MinIO et Redis en `tmpfs` / sans persistance ;
  les métadonnées Langfuse vont dans une base `langfuse` du Postgres partagé (`init.sql`).
- **Initialisation sans clic** (`LANGFUSE_INIT_*`) : organisation, projet `panora-demo`, clés
  `pk-lf-local-demo` / `sk-lf-local-demo` et un compte `demo@panora-demo.local` sont créés au
  démarrage, donc une base vide est immédiatement utilisable.
- Healthcheck du web sur `http://$HOSTNAME:3000/api/public/health` (le serveur n'écoute pas sur
  127.0.0.1 dans le conteneur).
- Scripts : `npm run infra:reset:langfuse`, `npm run dev:langfuse` (infra + Langfuse + les apps) ;
  `npm run dev` ne change pas ; `infra:down` arrête aussi le profil `langfuse`.
- Bascule Cloud ↔ local **uniquement par `.env`** : même code (V5), autre `LANGFUSE_BASE_URL` et
  autres clés (bloc commenté dans `.env.example`).
- `README.md` (premier jet) : section « pourquoi auto-héberger en secteur réglementé et ce que ça
  coûte ».

## Vérification

- `npm run infra:reset:langfuse` : tout est sain en ~20 s (premier lancement : téléchargement des
  images, ~6 min).
- `npm run dev:langfuse` + scénario 1 (vrais modèles), validé par le courtier → sinistre déclaré.
  Dans Langfuse local (API publique v2) :
  - **une seule trace** pour le traitement initial et la reprise (89 observations : spans de
    workflow et d'étapes, 3 agents, 6 générations LLM, 6 appels d'outils MCP) ;
  - **session** = id du dossier ; métadonnées de la trace : `caseId`, `brokerCode`,
    `emailLanguage` ; `promptVersion` et `model` sur les spans des agents ;
  - jetons et coût calculés par appel LLM (≈ 0,0035 $ pour tout le dossier).
- Tests unitaires et d'intégration : inchangés et verts.

## Variables d'environnement

Optionnelles (valeurs par défaut dans `compose.yaml`) : `LANGFUSE_PORT`,
`LANGFUSE_LOCAL_PUBLIC_KEY`, `LANGFUSE_LOCAL_SECRET_KEY`, `LANGFUSE_LOCAL_PROJECT_ID`,
`LANGFUSE_LOCAL_USER_EMAIL`, `LANGFUSE_LOCAL_USER_PASSWORD`. Pour utiliser l'instance locale, mettre
dans `.env` les valeurs locales de `LANGFUSE_BASE_URL`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`,
`NEXT_PUBLIC_LANGFUSE_URL`, `NEXT_PUBLIC_LANGFUSE_PROJECT_ID`.
