# V17 — Ce que l'agent a consulté, le courtier peut l'ouvrir

Branche : `v17-sources-and-portals` (créée depuis `v16-realistic-documents`).
Spec : [`specs/v17-sources-and-portals.md`](../../specs/v17-sources-and-portals.md).

## Ce qui a été fait

- Extranet : routes REST en lecture `/portal/policies`, `/portal/policies/:number`,
  `/portal/clauses/:ref` (jetons MCP, cloisonnement par cabinet), journalisées dans `CallLog` avec
  le canal `portal` (migration `20261120150000_call_channel`).
- Core : `/insurer/policies`, `/insurer/policies/:number` (avec le statut connu du cabinet),
  `/insurer/clauses/:ref`, `/clients`, `/clients/:id`. Core appelle l'extranet avec un jeton
  `read` émis depuis `MCP_TOKEN_SECRET`. `AgentEvent.result` stocke ce qu'un outil a renvoyé à
  l'agent (migration `20261120150000_agent_event_result`).
- Agents : chaque appel d'outil transmet son résultat (tronqué à 8 Ko) ; chaque source d'étape
  porte un `link` (contrat, section garanties, clause, client, pièce jointe).
- Web : onglets « Extranet assureur » et « Clients », page d'un contrat (garanties, conditions,
  sinistres, écart avec le cabinet), conditions générales avec la clause encadrée et l'extrait
  surligné, fiche client ; sources et lignes du déroulé cliquables ; encart « Ce que l'agent a
  reçu », qui signale ce qui a changé depuis.

## Vérifié

- `lint`, `typecheck`, `test`, `test:integration` (Core 31, extranet 10 dont 3 tests du portail).
- Stack redémarrée, deux e-mails traités par les vrais modèles, `/insurer/policies` répond via Core.

## Non vérifié

- Le parcours dans le navigateur (clic sur une source, encart « Ce que l'agent a reçu »).
