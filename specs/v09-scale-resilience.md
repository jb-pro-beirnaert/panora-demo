# V9 — Échelle et résilience

**Résultat attendu** : 1 000 dossiers envoyés en rafale sont tous traités malgré un extranet instable, avec débit et taux d'erreur chiffrés.

**Services touchés** : `apps/core-api`, `apps/agents`, `apps/mcp-extranet`, `apps/simulator`, `apps/web`.

## Charge

- Mode rafale du simulateur : `POST /burst { count: 1000 }`, déclenché depuis le panneau de démo, avec la validation automatique activée.
- Workers BullMQ : concurrence configurable, limiteur de débit aligné sur les quotas de l'API LLM.
- Déduplication : identifiant de tâche = identifiant de l'e-mail.
- Serveur Mastra lancé en 2 instances ; une reprise peut s'exécuter sur l'autre instance.
- Panneau de démo : débit en direct, files en attente, erreurs.

## Résilience

- Relances BullMQ avec délai croissant sur le démarrage et la reprise.
- Relances configurées sur les étapes Mastra (appels LLM et MCP).
- Délais d'attente explicites sur tous les appels HTTP et MCP.
- Serveur MCP en mode « extranet capricieux » (`apps/mcp-extranet/src/chaos/`), réglable par variables d'environnement : latence aléatoire, taux d'erreur, limite de débit.
- Dossiers en échec définitif visibles dans l'UI avec leur raison, et relançables.

## Mesures (README)

- Débit (dossiers par minute), durée p50 / p95 par dossier, taux de relance, taux d'échec définitif, coût total du test.

## Critères d'acceptation

- [ ] 1 000 dossiers traités, aucun traité deux fois.
- [ ] Avec 5 % d'erreurs côté extranet, moins de 1 % d'échecs définitifs.
- [ ] Arrêt d'une instance Mastra pendant le test sans perte de dossier.
- [ ] Résultats chiffrés dans le README.
