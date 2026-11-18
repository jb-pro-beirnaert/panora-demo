# V8 — Coût, latence et comparaison de modèles

**Résultat attendu** : chaque choix de modèle est justifié par un tableau chiffré : précision, coût par dossier et latence.

**Services touchés** : `apps/agents`, `evals/`, `compose.yaml` (+ Ollama, profil `ollama`), README.

## Comparaisons

- Modèle configurable par agent via variables d'environnement.
- Qwen via Ollama ajouté comme alternative locale (profil `ollama`).
- `npm run evals -- --matrix` : exécute le jeu d'evals pour chaque combinaison retenue et produit un tableau :

| Colonne | Source |
| --- | --- |
| Agent, modèle | configuration |
| Score (global et par langue) | scorers V7 |
| Coût moyen par dossier | tokens Langfuse |
| Latence p50 / p95 | traces Langfuse |

- Comparaison d'architecture : un agent unique qui fait tout contre les trois agents spécialisés.

## Optimisations mesurées

- Prompt caching sur les instructions longues et stables.
- Contexte réduit : seulement les pages utiles des pièces jointes.
- Petit modèle là où le score reste au-dessus du seuil.
- Chaque optimisation : mesure avant / après dans le tableau.

## Critères d'acceptation

- [ ] Tableau comparatif d'au moins 3 modèles par agent dans le README.
- [ ] Comparaison un agent contre trois agents, chiffrée.
- [ ] Au moins une optimisation qui réduit le coût sans faire baisser le score sous le seuil.
