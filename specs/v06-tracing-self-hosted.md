# V6 — Langfuse auto-hébergé

**Résultat attendu** : toute la stack tourne sans service tiers hormis l'API du LLM ; les traces restent dans l'infrastructure de la démo.

**Services touchés** : `compose.yaml`, configuration de `apps/agents`, `package.json` racine.

## Contenu

- Langfuse et ses dépendances ajoutés directement dans `compose.yaml` (selon la doc d'auto-hébergement à jour), port 3100, sous un profil Compose `langfuse`, sans volume comme le reste.
- `npm run dev:langfuse` le démarre avec l'infra ; `npm run dev` seul reste sur Langfuse Cloud.
- Bascule par variables d'environnement uniquement : même code, autre URL et autres clés.
- Section README : pourquoi l'auto-hébergement en secteur réglementé (prompts et données clients chez soi) et ce qu'il coûte (plusieurs conteneurs, sauvegardes, mises à jour).

## Critères d'acceptation

- [ ] `npm run dev:langfuse` démarre toute la stack, Langfuse compris.
- [ ] Les traces arrivent dans l'instance locale, avec les mêmes métadonnées qu'en V5.
- [ ] Retour à Langfuse Cloud possible en changeant uniquement le fichier `.env`.
