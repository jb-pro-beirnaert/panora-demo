# V10 — Sécurité et conformité

**Résultat attendu** : le cloisonnement entre cabinets est prouvé par des tests automatisés et la rétention des données est maîtrisée.

**Services touchés** : tous.

## Authentification et droits

- Connexion des courtiers dans l'UI (comptes du seed), session côté Core.
- Chaque requête de Core est filtrée par cabinet ; le `brokerCode` est porté jusqu'à Mastra puis au jeton MCP.
- Jetons de service distincts : Core → Mastra, Mastra → Core, Mastra → MCP (`read` / `write`), simulateur → routes `/admin/*`.

## Tests de cloisonnement (CI)

- Un courtier ne voit ni ne modifie un dossier d'un autre cabinet, via l'UI ou l'API.
- Un jeton MCP d'un cabinet ne lit aucun contrat d'un autre cabinet.
- Les routes internes et d'administration refusent tout appel sans jeton.
- Les routes `/admin/*` n'existent pas quand `DEMO_MODE` est désactivé.

## Données et RGPD

- `AuditLog` en écriture seule : aucune route de modification ni de suppression.
- Purge planifiée (tâche BullMQ répétée) : snapshots des workflows terminés et traces après un délai configurable.
- Section README : données traitées, durées de conservation, ce qui serait ajouté en production (chiffrement au repos, hébergement en France, revue d'accès).

## Critères d'acceptation

- [ ] Suite de tests de cloisonnement verte en CI.
- [ ] Purge vérifiée par un test.
- [ ] Aucune route ne permet de modifier l'audit.
