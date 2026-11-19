# V8 — Coût, latence et comparaison de modèles

Branche : `v8-cost-latency` (créée depuis `v7-evals`).
Spec : [`specs/v08-cost-latency.md`](../../specs/v08-cost-latency.md).

## Ce qui a été fait

### Modèles configurables par agent… et par dossier

- Toujours par variables d'environnement (`TRIAGE_MODEL`, `COVERAGE_MODEL`, `DRAFTING_MODEL`).
- Nouveau : **options d'exécution par dossier** (`RunOptions` dans `packages/shared`) : modèles par
  agent, architecture (`three_agents` / `single_agent`), contexte (`full` / `reduced`).
  Chemin : runner d'evals → `POST /emails { …, runOptions }` (refusé hors `DEMO_MODE`, stocké dans
  `Case.runOptions`, migration `run_options`) → entrée du workflow → `RequestContext` → les agents
  choisissent leur modèle par requête (`agent.model` est une fonction, `src/mastra/models.ts`).
  Toute la matrice tourne donc sur un seul serveur Mastra, sans redémarrage.
- **Qwen via Ollama** : `ollama/<modèle>` est servi par l'API compatible OpenAI d'Ollama
  (`OLLAMA_BASE_URL`, pas de clé) ; service `ollama` dans `compose.yaml` (profil `ollama`, `tmpfs`).
  Code seulement : aucun modèle téléchargé, lignes Ollama de la matrice ignorées sans
  `--with-ollama` (choix validé avec toi).

### Architecture à un seul agent (comparaison)

- `singleAgent` (`agents/single.ts`, `prompts/single.ts`) : un seul appel produit triage, verdict et
  premier brouillon, en réutilisant **mot pour mot** les trois prompts (on compare l'architecture,
  pas la rédaction). Branché dans le même workflow : l'étape `triage` appelle l'agent unique, puis
  `analyze-coverage` et `draft` réutilisent le résultat (`precomputed`) ; validation, refus et
  exécution sont inchangés.

### Optimisations

- Contexte réduit : photos retirées des pièces, lignes vides supprimées, pas de pièces jointes pour
  l'agent de rédaction (`usefulAttachments`, `renderEmail`).
- Cache de prompt : automatique chez OpenAI pour les préfixes stables ; mesuré via Langfuse
  (part des jetons d'entrée servis depuis le cache).
- Petit modèle là où le score tient : mesuré dans la matrice.

### Matrice (`npm run evals -- --matrix`)

- `evals/matrix.json` : base, puis un agent à la fois sur 3 modèles par agent, agent unique,
  contexte réduit, Qwen (optionnel). Options `--sample` (⅔ FR, ⅓ EN), `--only`, `--with-ollama`.
- Sortie : `evals/reports/matrix-latest.md` / `.json` ; tableau recopié dans le README avec
  l'analyse.

## Résultats (6 cas par configuration, vrais modèles, ≈ 0,25 $ au total)

| Configuration                               | Score de l'agent | Dossiers corrects | Coût / dossier | Latence p50 |
| ------------------------------------------- | ---------------: | ----------------: | -------------: | ----------: |
| base (gpt-5-nano / gpt-6-luna / gpt-6-luna) |              100 |               100 |       0,0034 $ |        78 s |
| triage gpt-4.1-mini                         |              100 |                67 |       0,0033 $ |        32 s |
| triage gpt-5.4-nano                         |               97 |               100 |   **0,0018 $** |        31 s |
| coverage gpt-5.4-mini                       |               86 |               100 |       0,0082 $ |        63 s |
| coverage gpt-4.1-mini                       |               83 |               100 |       0,0096 $ |        64 s |
| drafting gpt-5-nano                         |               94 |                83 |       0,0047 $ |        97 s |
| drafting gpt-4.1-mini                       |               89 |                83 |       0,0036 $ |        56 s |
| agent unique (gpt-6-luna)                   |              100 |               100 |       0,0015 $ |        42 s |
| contexte réduit                             |               83 |                83 |       0,0030 $ |        60 s |

- Cache : 62 % des jetons d'entrée d'un dossier de base viennent du cache (75 % en contexte réduit).
- `gpt-4.1-nano` a été essayé : **déprécié** chez OpenAI (erreur), remplacé par `gpt-4.1-mini`.
- Critère « une optimisation qui réduit le coût sans passer sous le seuil » : contexte réduit
  (−12 %, 83 % ≥ 50 %) et triage `gpt-5.4-nano` (−47 %, 100 %).
- Recommandation (pas appliquée, à confirmer sur les 60 cas) : passer `TRIAGE_MODEL` à
  `openai/gpt-5.4-nano`.
- Limite : 6 cas par ligne, un dossier qui change fait bouger une colonne de 17 points.

## Tests

- Agents : modèle par requête (surcharge / défaut), résolution `ollama/…`, contexte réduit.
- Core (intégration) : `runOptions` transmises au workflow, refus d'une spec invalide.
- Evals : score par agent et par langue, fusion des surcharges, ligne du tableau.

## Variables d'environnement

`OLLAMA_BASE_URL`, `OLLAMA_PORT` (facultatives).
