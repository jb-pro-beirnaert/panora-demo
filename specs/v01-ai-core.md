# V1 — Noyau IA, sans interface

**Résultat attendu** : un workflow Mastra lancé depuis Mastra Studio lit un e-mail de sinistre, consulte l'extranet via MCP et rend un verdict sourcé.

**Services touchés** : `packages/world-generator`, `apps/simulator` (seed seulement), `apps/mcp-extranet`, `apps/agents`, `packages/shared`, `compose.yaml` (Postgres seul), `package.json` racine.

**Langue des données** : français uniquement. **Prompts** : en anglais (voir `00-overview.md`, section Langues).

## Socle

- Monorepo npm workspaces + Turborepo, TypeScript strict, ESLint, Prettier.
- `compose.yaml` : un Postgres en `tmpfs`, sans volume ; `infra/postgres/init.sql` crée les bases `extranet` et `agents`.
- `npm run dev` : recrée Postgres vide, puis lance le serveur MCP, le serveur Mastra et le simulateur en mode watch.
- `.env.example` à la racine.

## Générateur et simulateur (premier jet)

### `packages/world-generator`

Librairie pure, sans accès aux bases. À partir d'une graine, elle produit :

- **le monde** : 2 cabinets (`Brokerage`), 3 assureurs fictifs (`Insurer`), 30 clients, 40 contrats (`Policy`) avec garanties (`Coverage`) et clauses (`Clause`) ;
- **des e-mails de sinistre** : expéditeur, objet, corps, texte des pièces jointes simulées ;
- **la vérité terrain** de chaque e-mail : type, contrat, montant, verdict, raison, clause à citer.

Au moins 10 e-mails, dont 3 pièges : contrat résilié, garantie exclue, plafond dépassé.

Exports principaux :

```ts
generateWorld(options: { seed: number; locale: 'fr' }): World
generateEmails(world: World, options: { seed: number; count: number }): GeneratedEmail[]
// GeneratedEmail = { email: InboundEmailInput; groundTruth: GroundTruth }
```

### `apps/simulator` (version minimale)

- Au démarrage : attend `GET /health` du serveur MCP, génère le monde (graine fixe), l'envoie à `POST /admin/seed` du MCP.
- `GET /emails` : liste des e-mails générés, pour les copier dans Mastra Studio.

## Serveur MCP extranet + base extranet

### Modèle Prisma

| Table | Colonnes principales |
| --- | --- |
| `Insurer` | `id`, `name`, `locale` |
| `Policy` | `number`, `insurerId`, `holderName`, `holderSiren`, `brokerCode`, `product`, `status` (`active`, `suspended`, `terminated`), `endReason`, `endDate` |
| `Coverage` | `policyNumber`, `label`, `limit`, `deductible`, `exclusions`, `clauseRef` |
| `Clause` | `ref`, `text` |
| `Claim` | `number`, `policyNumber`, `date`, `nature`, `amount`, `status` |
| `CallLog` | `brokerCode`, `tool`, `params`, `result`, `createdAt` |

### Routes

- `POST /mcp` : transport Streamable HTTP.
- `GET /health`.
- `POST /admin/seed`, `POST /admin/reset` : importent ou effacent la partie assureurs du monde (actives seulement avec `DEMO_MODE=true`).
- Migrations Prisma appliquées au démarrage.

### Outils en lecture

| Outil | Paramètres | Renvoie |
| --- | --- | --- |
| `search_policy` | `number` ou `holderName` | contrats correspondants |
| `get_policy` | `number` | statut, dates, produit, motif de fin |
| `list_coverages` | `policyNumber` | garanties, plafonds, franchises, exclusions, références de clause |
| `read_clause` | `ref` | texte exact de la clause |
| `get_claim_history` | `policyNumber` | sinistres déjà déclarés |

- Descriptions d'outils rédigées en anglais, pour le LLM.
- Réponses allégées (seulement les champs utiles).
- Erreurs rédigées pour un LLM : « No policy with this number. Try `search_policy` with the holder's name. »
- Chaque appel écrit une ligne dans `CallLog`.

## Serveur Mastra

- Projet créé par `npm create mastra@latest` dans `apps/agents`.
- Stockage `PostgresStore` sur la base `agents`.
- Client MCP vers `http://localhost:3002/mcp`.

### `triageAgent`

- Modèle léger.
- Instructions en anglais dans `prompts/triage.ts`.
- Sortie structurée `TriageResult` :
  - `requestType` : `claim`, `quote_request`, `cancellation`, `other` ;
  - `policyNumber`, `incidentDate`, `nature`, `location`, `amount` ;
  - `documentsPresent[]`, `documentsMissing[]` ;
  - pour chaque champ : `source` (pièce, page) et `confidence`.

### `coverageAgent`

- Modèle puissant.
- Instructions en anglais dans `prompts/coverage.ts`.
- Outils : les 5 outils MCP en lecture.
- Sortie structurée `CoverageVerdict` :
  - `verdict` : `covered`, `not_covered`, `uncertain` ;
  - `coverage`, `limit`, `deductible` ;
  - `citations[]` (référence de clause + extrait) ;
  - `alerts[]` : `policy_terminated`, `exclusion`, `limit_exceeded`, `late_declaration`, `missing_document`, `duplicate_claim`.

### Workflow `process-email` (V1)

`prepare` (code) → `triage` → `analyze-coverage`.

Schémas `TriageResult` et `CoverageVerdict` dans `packages/shared`.

## Critères d'acceptation

- [ ] `npm run dev` démarre Postgres, le serveur MCP, le serveur Mastra et le simulateur ; la base extranet est remplie sans action manuelle.
- [ ] Relancer `npm run dev` repart d'une base vide, re-remplie à l'identique (même graine).
- [ ] Le serveur MCP liste ses 5 outils, testable avec l'inspecteur MCP ou Claude Desktop.
- [ ] Dans Mastra Studio, le workflow traite les 10 e-mails sans erreur.
- [ ] Le cas « contrat résilié » ressort en `not_covered`, avec la clause citée.
- [ ] Les sorties des deux agents respectent leur schéma Zod.
- [ ] Tout le code est en anglais.

**Hors périmètre** : interface, Core, files, écriture dans l'extranet, tracing, données en anglais.
