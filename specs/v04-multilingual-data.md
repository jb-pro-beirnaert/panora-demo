# V4 — Données générées en anglais (multilingue)

**Résultat attendu** : la démo mélange des dossiers en français et en anglais ; les agents les traitent tous avec les mêmes prompts, et chaque réponse part dans la bonne langue.

**Services touchés** : `packages/world-generator`, `apps/simulator`, `apps/core-api`, `apps/mcp-extranet` (données seulement), `apps/agents` (règles de langue), `apps/web`.

## Ce qui est généré en anglais

- **Cabinets** : un cabinet anglophone (`Brokerage.locale = 'en'`) en plus des deux francophones.
- **Clients** : une part des clients écrit en anglais (sociétés étrangères implantées en France, clients du cabinet anglophone).
- **Assureurs** : un assureur fictif dont les contrats et clauses sont en anglais (`Insurer.locale = 'en'`).
- **E-mails** et pièces jointes simulées : dans la langue du client.
- **Vérité terrain** : ajoute `emailLanguage`, `expectedDraftLanguage`, `expectedNoteLanguage`.

Cas mixtes volontaires :
- e-mail en anglais, clauses en français ;
- e-mail en français, clauses en anglais ;
- cabinet francophone, client anglophone (note en français, brouillon en anglais).

## `world-generator`

- `generateWorld({ seed, locales: ['fr', 'en'], mix: { en: 0.3 } })`.
- Faker avec les locales `fr` et `en` ; modèles d'e-mails et de clauses écrits dans les deux langues.
- Les identifiants (numéros de contrat, références de clause) restent indépendants de la langue.

## Prompts des agents

Décision (voir `00-overview.md`, section Langues) : **un seul prompt par agent, en anglais**, déjà en place depuis V1. En V4, on renforce seulement les règles de langue :

- `triageAgent` : détecte la langue de l'e-mail (`emailLanguage`) ; extrait les champs quelle que soit la langue ; valeurs de sortie neutres.
- `coverageAgent` : raisonne sur des clauses dans n'importe quelle langue ; recopie les citations dans leur langue d'origine.
- `draftingAgent` : `clientEmailDraft` dans `emailLanguage` ; `internalNote` dans `Brokerage.locale`.

Les langues attendues sont passées explicitement à l'agent dans son entrée (pas devinées par le prompt seul).

## Interface

- Badge de langue sur chaque dossier dans la boîte de réception.
- Filtre par langue.
- La timeline et l'audit restent dans la langue de l'interface (déjà le cas depuis V3).

## Simulateur

- Réglage du mélange de langues dans le panneau de démo (par exemple 70 % FR / 30 % EN).

## Critères d'acceptation

- [ ] Le flux de démo contient des dossiers en français et en anglais.
- [ ] Un e-mail en anglais reçoit un brouillon de réponse en anglais ; la note interne suit la langue du cabinet.
- [ ] Les cas mixtes (e-mail et clauses de langues différentes) donnent le bon verdict, avec les citations dans la langue de la clause.
- [ ] Aucun prompt dupliqué par langue.

**Hors périmètre** : d'autres langues que FR et EN.
