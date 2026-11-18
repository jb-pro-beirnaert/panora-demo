# V7 — Evals et non-régression

**Résultat attendu** : chaque agent a un score mesuré sur un jeu de cas générés, dans les deux langues, et une PR qui dégrade un prompt est bloquée par la CI.

**Services touchés** : `packages/world-generator`, `evals/`, `apps/agents`, `.github/workflows/`, `apps/web`.

## Jeu d'evals

- `npm run gen:evals -- --seed 7 --count 60` : 60 cas avec vérité terrain, produits par `packages/world-generator` dans `evals/datasets/`. Même librairie que le simulateur, donc les mêmes pièges que dans la démo.
- Répartition des pièges : contrat résilié, garantie exclue, plafond dépassé, franchise à déduire, pièce manquante, doublon de sinistre, e-mail hors sinistre, champ illisible.
- Répartition des langues : FR, EN et cas mixtes (si V4 est faite).
- Graine fixe : le même jeu à chaque exécution.

## Scorers

| Agent | Mesure | Méthode |
| --- | --- | --- |
| Triage | `requestType` correct | comparaison exacte |
| Triage | exactitude de chaque champ extrait | comparaison champ par champ |
| Triage | `emailLanguage` correct | comparaison exacte |
| Coverage | verdict correct | comparaison exacte |
| Coverage | franchise et plafond exacts | comparaison numérique |
| Coverage | citations valides (la clause existe et dit ce qui est affirmé) | règle + LLM-as-judge |
| Drafting | bon `actionType` | comparaison exacte |
| Drafting | montants repris sans erreur | règle |
| Drafting | langue du brouillon et de la note | détection de langue |
| Drafting | ton et complétude du brouillon | LLM-as-judge |
| Workflow | dossier entièrement correct | tous les scores ci-dessus |

Les scores sont aussi présentés **par langue**, pour repérer un écart FR / EN.

## Exécution

- `npm run evals` : exécute le jeu, écrit un rapport JSON et Markdown, envoie les scores dans Langfuse rattachés aux traces.
- `.github/workflows/evals.yml` : lancé sur les PR qui touchent `apps/agents` ; échoue si un score passe sous son seuil ou baisse de plus de 2 points par rapport à la branche principale.
- `.github/workflows/ci.yml` : lint, typecheck, tests unitaires et d'intégration de tous les services.

## Interface

- Écran « Evals » : score par agent, par scorer et par langue ; historique des exécutions ; cas en échec avec lien vers la trace.

## Critères d'acceptation

- [ ] `npm run evals` produit un rapport complet en local.
- [ ] Les scores apparaissent dans Langfuse sur les bonnes traces.
- [ ] Une PR qui dégrade volontairement un prompt est bloquée en CI, avec le score avant / après.
- [ ] L'écran Evals affiche les derniers résultats, en FR et en EN.
