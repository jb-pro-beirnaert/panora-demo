# V7 — Evals et non-régression

Branche : `v7-evals` (créée depuis `v6-tracing-self-hosted`).
Spec : [`specs/v07-evals.md`](../../specs/v07-evals.md).

## Ce qui a été fait

### Jeu d'evals (`evals/`, nouveau workspace `@demo/evals`)

- `npm run gen:evals -- --seed 7 --count 60` → `evals/datasets/seed-7.json` : 60 cas avec vérité
  terrain, produits par `packages/world-generator` (mêmes pièges que la démo), monde FR + EN avec
  40 % d'anglophones. Répartition obtenue : couvert 10, résilié 5, pièce manquante 6, exclusion 6,
  plafond 7, franchise 5, doublon 4, champ illisible 5, déclaration tardive 3, hors sinistre 7,
  client inconnu 2 ; 45 FR / 15 EN (dont cas mixtes). Graine fixe : même jeu à chaque fois (testé).
  Les `messageId` sont préfixés `eval-` pour ne jamais entrer en collision avec la démo.

### Exécution (`npm run evals`)

- `run-evals.ts` passe par **la vraie stack** (`npm run dev` doit tourner) : seed de Core et de
  l'extranet avec le monde des evals (remplace les données de démo), envoi de chaque e-mail à
  `POST /emails`, attente de la première proposition, lecture du dossier (`lib/observed.ts`).
  Options : `--limit`, `--language fr|en`, `--concurrency`, `--no-judge`, `--judge-model`,
  `--gate`, `--baseline`, `--save-baseline`.
- Scorers (`scorers/`, fonctions pures testées) :

| Agent    | Scorer                           | Méthode                                                                                                       |
| -------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| triage   | `request_type`, `email_language` | exact                                                                                                         |
| triage   | `fields`                         | champ par champ (contrat et date seulement s'ils sont lisibles)                                               |
| coverage | `verdict`                        | exact                                                                                                         |
| coverage | `alerts`                         | Jaccard                                                                                                       |
| coverage | `limit_deductible`               | numérique                                                                                                     |
| coverage | `citations`                      | règle : la clause existe, l'extrait y figure mot pour mot (donc dans sa langue), la clause décisive est citée |
| coverage | `citations_judge`                | LLM-as-judge : la clause dit bien ce qui justifie le verdict                                                  |
| drafting | `action_type`                    | exact                                                                                                         |
| drafting | `amounts`                        | règle : tout montant écrit est un montant connu du dossier                                                    |
| drafting | `languages`                      | détection de langue du brouillon et de la note                                                                |
| drafting | `tone_completeness_judge`        | LLM-as-judge                                                                                                  |
| workflow | `case_correct`                   | toutes les vérifications strictes du dossier passent                                                          |

- Juge : un appel par dossier à l'API OpenAI (`gpt-5-nano` par défaut, `EVAL_JUDGE_MODEL`),
  indépendant des agents testés ; désactivable.
- Rapport : `evals/reports/<runId>.json`, `latest.json`, `latest.md` (scores par agent, par
  scorer et **par langue**, cas en échec avec lien vers la trace, coût moyen et latence p50/p95).
- Langfuse : chaque score est attaché à la trace du dossier (`POST /api/public/scores`) ; le coût
  par dossier est lu dans Langfuse (somme des générations).

### Non-régression

- `lib/gate.ts` : échec si un score passe sous son seuil (`evals/thresholds.json`) ou baisse de plus
  de 2 points par rapport à la référence ; affiche avant / après.
- `.github/workflows/ci.yml` : format, lint, typecheck, tests unitaires ; tests d'intégration avec
  Postgres + Redis en services.
- `.github/workflows/evals.yml` : sur les PR qui touchent `apps/agents`, `evals` ou `packages/shared`
  — démarre Postgres/Redis, Core, MCP et Mastra, lance les evals avec `--gate` contre
  `evals/reports/baseline.json` **de la branche main**, publie le rapport dans le résumé du job et
  en artefact. Secrets requis : `OPENAI_API_KEY` (et facultativement les clés Langfuse).
- Mise à jour de la référence : `npm run evals -- --save-baseline` puis commit sur main.

### Interface

- Écran **Evals** (`/fr/evals`, `/en/evals`, lien dans l'en-tête) : dernière exécution (score par
  agent, par scorer, FR et EN), cas en échec avec lien vers la trace, historique des exécutions
  (dossiers entièrement corrects, coût). Lecture côté serveur des rapports (`EVALS_REPORTS_DIR`,
  par défaut `evals/reports`).

## Vérifications

- Tests : scorers (cas correct, verdict faux, montant inventé, mauvaise langue, hors sinistre),
  règle de citation (paraphrase rejetée, clause inexistante, clause décisive manquante), lecture
  des montants FR/EN, porte (seuil, baisse > 2 points avec avant/après), agrégats par langue,
  reproductibilité du jeu.
- **Exécutions réelles** (vrais modèles, budget limité, donc échantillons) :
  - 6 cas FR (catalogue) : 100 % sur tous les scorers stricts, juge ton/complétude 83 %,
    coût moyen **0,0031 $** par dossier, latence p50 80 s (enregistrée comme `baseline.json`) ;
  - 4 cas EN : 100 % sur tous les scorers stricts, juge 75 %, 0,0031 $ par dossier ;
  - **prompt volontairement dégradé** (« Always choose request_documents ») sur les 6 cas FR :
    la porte échoue — `drafting/action_type` 100 → 50 (sous le seuil de 70), `case_correct`
    100 → 50, avant/après affichés (rapport conservé dans
    [`v07-degraded-prompt-report.json`](v07-degraded-prompt-report.json)) ; prompt restauré.
- Non vérifié : l'exécution du workflow GitHub Actions lui-même (pas de dépôt distant poussé).
- Limite connue : sur 6 cas, un seul dossier qui change de verdict fait bouger un score de
  16 points ; la règle des 2 points n'a de sens que sur le jeu complet (60 cas, ≈ 0,20 $ par
  exécution + juge).

## Variables d'environnement

`EVAL_JUDGE_MODEL` (facultative, `gpt-5-nano` par défaut). Le runner lit le `.env` racine
(`ADMIN_TOKEN`, `OPENAI_API_KEY`, `LANGFUSE_*`, URLs des services).
