# V3 — Core API + Next.js bilingue + simulateur : démo de bout en bout

**Résultat attendu** : un courtier voit les e-mails arriver dans l'interface (en français ou en anglais), suit le traitement de chaque dossier et valide ou refuse l'action proposée. Le panneau de démo pilote le flux d'e-mails.

**Services touchés** : `apps/core-api` (nouveau), `apps/web` (nouveau), `apps/agents`, `apps/simulator`, `compose.yaml` (+ Redis sans persistance).

**Langue des données** : toujours en français. **Interface** : FR et EN.

## Base core (Prisma)

| Table | Contenu principal |
| --- | --- |
| `Brokerage` | `name`, `brokerCode`, `locale` (`fr` pour l'instant) |
| `Broker` | `brokerageId`, `name`, `email`, `preferredLocale` |
| `Client` | `brokerageId`, `companyName`, `siren`, `email` |
| `Policy` | `number`, `clientId`, `insurerName`, `product`, `knownStatus`, `renewalDate` |
| `InboundEmail` | `from`, `subject`, `body`, `receivedAt`, `language` |
| `Attachment` | `emailId`, `fileName`, `type`, `extractedText` |
| `Case` | `brokerageId`, `emailId`, `clientId`, `policyNumber`, `status`, `workflowRunId` |
| `AgentStep` | `caseId`, `agent`, `stepType`, `params` (JSON), `sources`, `model`, `durationMs`, `costUsd` |
| `ProposedAction` | `caseId`, `actionType`, `clientEmailDraft`, `internalNote`, `status` (`pending`, `approved`, `rejected`), `decidedBy`, `comment` |
| `AuditLog` | `caseId`, `actor` (`system`, `agent`, `broker`), `action`, `params` (JSON), `source`, `createdAt` — écriture seule |

`AgentStep` et `AuditLog` stockent un **type + des paramètres**, pas une phrase : l'interface les traduit (voir Internationalisation).

## API publique (Web)

- `POST /emails` : réception d'un e-mail ; crée le dossier et met une tâche `process-email` en file.
- `GET /cases`, `GET /cases/:id` (avec étapes, action, audit).
- `POST /cases/:id/decision` : `{ approved, comment? }` ; met une tâche `resume-workflow` en file.
- `GET /realtime` : flux SSE (`case.created`, `case.step`, `case.action_proposed`, `case.closed`, `demo.reset`).
- Authentification V3 : un courtier choisi dans un sélecteur (vraie authentification en V10).

## Routes internes (Mastra, jeton de service)

- `POST /internal/cases/:id/steps`
- `POST /internal/cases/:id/proposed-action` (avec le `workflowRunId`)
- `POST /internal/cases/:id/executed-action`
- `GET /internal/clients?email=` (outil `find_client` de `triageAgent`)

Un rappel pour un dossier inexistant (après un reset) est ignoré.

## Routes d'administration (mode démo)

- `POST /admin/seed` : importe la partie cabinet du monde.
- `POST /admin/reset` : vide les tables métier et les files BullMQ, émet `demo.reset` en SSE.
- Actives seulement avec `DEMO_MODE=true` et un jeton d'administration.

## Files BullMQ

| File | Déclenchée par | Le worker fait |
| --- | --- | --- |
| `process-email` | `POST /emails` | démarre le workflow sur Mastra, enregistre le `workflowRunId`, n'attend pas la fin |
| `resume-workflow` | `POST /cases/:id/decision` | reprend l'exécution avec la décision |

## Côté Mastra

- Les étapes appellent les routes internes de Core à chaque fin d'étape, avant la suspension et après l'exécution.
- L'outil `find_client` de `triageAgent` appelle Core.

## Simulateur

- Au démarrage : seed de Core en plus du serveur MCP.
- Flux d'e-mails vers `POST /emails` de Core, à cadence réglable, avec un peu d'aléa entre deux envois.
- API de pilotage : `GET /state`, `POST /start`, `/pause`, `/resume`, `/speed`, `/send-one`, `/reset`, `/auto-validation`.
- Reset : arrête le flux, appelle `POST /admin/reset` de Core et du MCP, puis refait le seed.
- Validation automatique (option) : écoute les actions proposées, appelle `POST /cases/:id/decision` après un délai, taux de refus réglable.

## Interface (Next.js + shadcn/ui)

- **Boîte de réception** : liste des dossiers, statut, mise à jour en direct.
- **Vue dossier** : e-mail et pièces, timeline des étapes avec sources, action proposée et brouillon, boutons Valider / Refuser avec commentaire.
- **Journal d'audit** du dossier.
- **Panneau de démo** (barre en haut de l'écran) : Démarrer, Pause, Reprendre, Reset ; cadence (e-mails par minute) ; « Envoyer 1 e-mail » ; validation automatique ; compteurs en direct (envoyés, en cours, en attente de validation, traités).

## Internationalisation de l'interface

- **next-intl**, routes préfixées `/fr/...` et `/en/...`, langue par défaut `fr`.
- Fichiers `apps/web/messages/fr.json` et `en.json` ; clés en anglais (`inbox.title`, `case.approve`…).
- Sélecteur de langue dans l'en-tête ; choix mémorisé (cookie).
- Dates, montants et devises formatés selon la langue (`Intl`).
- **Contenu généré par les agents** :
  - étapes et audit : rendus à partir de leur `type` + `params` (`"coverage.policy_checked": "Contrat {policyNumber} consulté"` / `"Policy {policyNumber} checked"`), donc toujours dans la langue de l'interface ;
  - verdicts et types d'action : valeurs neutres (`not_covered`) traduites par l'interface ;
  - texte libre (brouillon d'e-mail, note interne, extraits de clauses) : affiché tel quel, dans sa langue d'origine, avec un badge de langue.
- Aucun texte d'interface en dur dans les composants : un test vérifie que `fr.json` et `en.json` ont les mêmes clés.

## Critères d'acceptation

- [ ] `npm run dev` démarre les 5 apps, Postgres et Redis ; les bases sont remplies automatiquement.
- [ ] « Démarrer » fait arriver des e-mails dans l'interface sans recharger la page ; « Pause » les arrête.
- [ ] La timeline se remplit au fil des étapes ; l'action proposée s'affiche.
- [ ] Valider exécute l'action ; refuser produit une nouvelle proposition.
- [ ] Chaque étape et chaque décision figurent dans le journal d'audit.
- [ ] « Reset » remet l'interface et les bases à l'état initial en quelques secondes.
- [ ] Toute l'interface bascule entre FR et EN, timeline et audit compris.
- [ ] Le worker `process-email` termine en quelques millisecondes, sans attendre le workflow.

**Hors périmètre** : données en anglais, tracing, evals, authentification réelle.
