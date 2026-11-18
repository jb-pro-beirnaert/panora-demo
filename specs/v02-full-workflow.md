# V2 — Workflow complet avec validation humaine

**Résultat attendu** : le workflow propose une action, se suspend, et reprend selon la décision du courtier, donnée à la main dans Mastra Studio.

**Services touchés** : `apps/agents`, `apps/mcp-extranet`, `packages/shared`.

## Workflow

1. `prepare` (code) : normalise l'e-mail et le texte des pièces.
2. `triage` (`triageAgent`).
3. Branche : `requestType !== 'claim'` → `classify` (code), fin du workflow.
4. Sous-workflow `handle-claim` :
    1. `analyze-coverage` (`coverageAgent`).
    2. Boucle `dountil` autour de `draft` + `approval`, jusqu'à une décision « approuvé ».
    3. `execute` (code).

## `draftingAgent`

- Modèle intermédiaire, aucun outil.
- Instructions en anglais dans `prompts/drafting.ts`.
- Entrée : `CoverageVerdict` + commentaire éventuel du courtier en cas de refus.
- Sortie `ProposedAction` :
  - `actionType` : `request_documents`, `file_claim`, `notify_denial` ;
  - `clientEmailDraft` : rédigé dans la langue de l'e-mail reçu ;
  - `internalNote` : rédigée dans la langue du cabinet.

## Étape `approval`

- `suspend({ action })` tant qu'aucune décision n'est reçue ; snapshot persisté dans la base `agents`.
- `resumeSchema` : `{ approved: boolean, comment?: string, brokerId: string }`.
- Refus : le commentaire est renvoyé à `draftingAgent` au tour suivant.

## Étape `execute`

- Si `actionType === 'file_claim'` : appel de l'outil MCP `file_claim` avec le client MCP **write**.
- Les autres actions passent au statut `ready_to_send` (l'envoi réel d'e-mail est hors périmètre de la démo).

## Serveur MCP

- Nouvel outil `file_claim` : `policyNumber`, `date`, `nature`, `amount`, `documents` → numéro de sinistre.
- Deux jetons : `read` (5 outils de lecture) et `write` (tous les outils). Un appel d'écriture avec un jeton `read` est refusé.
- Cloisonnement : le jeton porte un `brokerCode` ; un contrat d'un autre cabinet renvoie « access denied ».

## Critères d'acceptation

- [ ] Un e-mail hors sinistre s'arrête après `classify`, sans appel à `coverageAgent` ni `draftingAgent`.
- [ ] Un sinistre se suspend sur `approval` avec une action proposée lisible.
- [ ] Serveur Mastra redémarré pendant la pause : la reprise fonctionne quand même.
- [ ] Un refus avec commentaire produit une nouvelle proposition qui en tient compte.
- [ ] Une validation crée le sinistre dans la base extranet.
- [ ] Un jeton `read` ne peut pas appeler `file_claim` ; un autre cabinet ne voit pas le contrat.

**Hors périmètre** : interface, Core, files, tracing.
