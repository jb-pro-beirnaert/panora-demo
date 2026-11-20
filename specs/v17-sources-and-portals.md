# V17 — Ce que l'agent a consulté, le courtier peut l'ouvrir

**Résultat attendu** : le courtier dispose de deux nouveaux onglets, **« Extranet assureur »** (contrats, garanties, conditions générales, sinistres) et **« Clients »** (la base du cabinet). Chaque source citée par un agent dans le déroulé d'un dossier est un lien. Il ouvre la donnée telle qu'elle est aujourd'hui, avec la partie utilisée surlignée, et un encart montre ce que l'agent a reçu au moment où il l'a consultée.

**Services touchés** : `apps/web`, `apps/core-api`, `apps/mcp-extranet`, `apps/agents`, `packages/shared`.

**Prérequis** : V16.

## 1. Onglet « Extranet assureur »

L'extranet est la base d'un autre service (`extranet`) : le web n'y accède jamais directement.

- **Accès** : Core expose des routes en lecture `/insurer/*` et appelle l'extranet par HTTP avec un jeton `read` du cabinet. Le navigateur ne détient aucun jeton. Le cloisonnement par cabinet s'applique comme pour les agents : un contrat d'un autre cabinet donne « accès refusé ».
- **Extranet** : nouvelles routes REST en lecture `/portal/*` (mêmes jetons que MCP, `read` suffit). Chaque appel est journalisé dans `CallLog`, avec un canal `portal` pour le distinguer des appels `mcp` des agents.
- **Pages** :
  - `/insurer` : liste des contrats du cabinet chez les assureurs. Recherche par numéro ou par assuré ; colonnes assureur, produit, statut, échéance, résiliation programmée.
  - `/insurer/policies/[number]` : un contrat. Il comporte quatre sections :
    - en-tête (assuré, SIREN, produit, assureur, dates, statut, motif de fin) ;
    - **garanties** (`#coverages` : libellé, plafond, franchise, exclusions, lien vers la clause) ;
    - **conditions générales** applicables (liens) ;
    - **sinistres** (`#claims` : numéro, date, nature, montant, statut, déclaré par le cabinet ou non).
  - `/insurer/insurers/[id]/clauses` : les conditions générales d'un assureur, en texte intégral, une ancre par clause (`#CG-AT-7.1`), dans la langue de l'assureur.
- **Comparaison** : sur la page d'un contrat, le statut connu du cabinet (`knownStatus`) est affiché à côté de celui de l'assureur. Un écart est surligné en rouge : c'est le cas phare (contrat résilié).

## 2. Onglet « Clients »

Les données viennent de la base de Core.

- `/clients` : liste des clients du cabinet (raison sociale, SIREN, contact, e-mail, nombre de contrats et de dossiers), avec recherche.
- `/clients/[id]` : fiche client en trois sections :
  - coordonnées ;
  - **contrats gérés par le cabinet** (`#policies` : numéro, assureur, produit, statut connu, échéance, date de résiliation enregistrée), chacun avec un lien vers sa page dans l'extranet ;
  - **dossiers** (`#cases` : référence, date, type, statut, lien).

## 3. Des sources cliquables

### Ce que les agents enregistrent

- `StepSource` reçoit un champ facultatif `link`, construit par le code Mastra et jamais par le LLM. Il prend l'une de ces formes :
  - `{ type: 'policy', policyNumber, section?: 'coverages' | 'claims' }` ;
  - `{ type: 'clause', clauseRef, insurerId }` ;
  - `{ type: 'client', clientId, section?: 'policies' | 'cases' }` ;
  - `{ type: 'policy_search', query }` ;
  - `{ type: 'attachment', attachmentId, page? }`.
- Correspondance par source :

| Source | Lien |
| --- | --- |
| `get_policy` | page du contrat |
| `list_coverages` | contrat, section garanties |
| `get_claim_history` | contrat, section sinistres |
| `search_policy` | liste des contrats filtrée |
| clause citée (`read_clause`) | conditions générales, ancre de la clause, extrait surligné |
| `find_client` | fiche client |
| `find_client_cases` | fiche client, section dossiers |
| pièce jointe (`constat.pdf p.1`) | texte extrait de la pièce dans le dossier, ancré sur la page, et « Ouvrir » le PDF |

- Les lignes « en direct » du déroulé (« Agent Garanties consulte le contrat F-77102 ») sont aussi des liens.

### « Ce que l'agent a vu »

- Mastra enregistre, sur chaque événement d'appel d'outil (`tool_call`), un **résumé du résultat** : le JSON renvoyé, tronqué à 8 Ko. Core le stocke dans `AgentEvent.result`. Le résultat de `find_client`, appel à Core, est enregistré de la même façon.
- Le lien d'une source porte le dossier et l'événement : `?case=<id>&event=<eventId>`. La page ouverte affiche alors un encart « Ce que l'agent a reçu le 20/11 à 09:55:45 (CASE-0001) » avec ce résultat, rendu lisiblement (champs clés, pas du JSON brut).
- Si la donnée a changé depuis, l'encart le signale : « Le statut était `active`, il est maintenant `active` avec une résiliation programmée au 28/09/2027 ». Ça arrive quand une action validée l'a modifiée, par exemple une résiliation ou un sinistre déclaré.
- Un extrait de clause cité est surligné dans le texte intégral (recherche de l'extrait mot pour mot).

## 4. Navigation

- En-tête : « Boîte de réception · Extranet assureur · Clients · Evals ».
- Depuis la page d'un dossier, le client et le contrat de l'en-tête deviennent des liens vers leurs fiches.
- Toutes les pages sont traduites (`fr.json` / `en.json`). Les textes des clauses restent dans leur langue d'origine, avec un badge de langue.

## Critères d'acceptation

- [ ] L'onglet « Extranet assureur » liste les contrats du cabinet et ouvre chaque contrat avec ses garanties, ses clauses et ses sinistres. Un sinistre déclaré ou une résiliation enregistrée pendant la démo y apparaît.
- [ ] L'onglet « Clients » liste les clients et ouvre leur fiche (contrats gérés, dossiers).
- [ ] Le web n'appelle que Core. Core appelle l'extranet avec un jeton `read`, et ces appels apparaissent dans `CallLog` avec le canal `portal`.
- [ ] Dans le déroulé d'un dossier, chaque source (clause, `get_policy`, `list_coverages`, `get_claim_history`, `find_client`, `find_client_cases`, pièce jointe) est un lien vers la bonne page et la bonne section.
- [ ] Un clic sur la clause `CG-AT-7.1` ouvre les conditions générales de l'assureur sur cette clause, avec l'extrait surligné.
- [ ] Un clic depuis un dossier affiche « Ce que l'agent a reçu », et signale une donnée qui a changé depuis.
- [ ] Le cas phare (contrat résilié que le cabinet croit actif) montre l'écart sur la page du contrat.

## Hors périmètre

- Modifier une donnée depuis ces onglets : ils sont en lecture seule.
- Les autres cabinets et l'authentification : la démo reste mono-courtier (V12).
- Les assureurs « réels » : l'extranet reste simulé.
