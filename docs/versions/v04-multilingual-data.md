# V4 — Données générées en anglais (multilingue)

Branche : `v4-multilingual-data` (créée depuis `v3-core-and-ui`).
Spec : [`specs/v04-multilingual-data.md`](../../specs/v04-multilingual-data.md).

## Ce qui a été fait

### `packages/shared`

- `LocaleSchema` = `fr | en`.
- `TriageResult.emailLanguage` : langue détectée par `triageAgent`.
- Vérité terrain : `emailLanguage`, `expectedDraftLanguage` (= langue de l'e-mail),
  `expectedNoteLanguage` (= `Brokerage.locale`) sur toutes les variantes.
- `detectLanguage` : mots outils anglais ajoutés (tests FR/EN).

### `packages/world-generator`

- `generateWorld({ seed, locales: ['fr', 'en'], mix: { en: 0.3 } })` (l'ancien
  `{ seed, locale: 'fr' }` marche toujours).
- **Le monde français ne change pas** : la partie anglaise est ajoutée après, avec son propre Faker
  (`createEnglishRandom`), donc mêmes clients, contrats et e-mails français (testé).
- Partie anglaise :
  - cabinet anglophone **Hartley & Finch Brokers** (`HTF-092`, `locale: en`) et 2 courtiers ;
  - assureur anglophone **Northbridge Insurance** (`CG-NB-*`), conditions générales et garanties
    rédigées en anglais (`catalog/english.ts`) ;
  - clients anglophones (≈ 30 % des clients) : la plupart chez Hartley & Finch (contrats chez
    Northbridge ou chez un assureur français), d'autres chez les cabinets français (sociétés
    étrangères implantées en France) ;
  - deux clients francophones dont le contrat est chez Northbridge (e-mail FR, clauses EN) ;
  - pièges sur les données anglaises : un contrat résilié par Northbridge que le cabinet croit
    actif, des sinistres passés et un sinistre ouvert récent (doublon).
- E-mails et pièces jointes en anglais (`attachments-en.ts`, `writeEn`, devis/factures/constats,
  hors sinistre et client inconnu en anglais).
- Scénario 13 (vitrine) : Brightwave Solutions, `facilities@brightwave-solutions.com`, contrat
  `C-51877` chez Assurances Horizon (clauses en français), cabinet Delorme (francophone). Placé juste
  après le catalogue (12ᵉ e-mail), donc présent même dans un petit lot.
  - Écart volontaire avec le texte de la spec : l'e-mail joint aussi un constat, sinon il
    manquerait une pièce obligatoire pour un dégât des eaux et le bon verdict serait `uncertain`
    (l'agent l'a d'ailleurs détecté lors du premier essai réel).
- `generateEmails(world, { mix })` : les 11 premiers e-mails parcourent le catalogue en français,
  puis chaque e-mail tire sa langue selon `mix.en`.

### Agents (`apps/agents`)

- Toujours **un seul prompt par agent, en anglais**. Règles renforcées :
  - triage : détecter `emailLanguage` ;
  - coverage : raisonner sur des clauses dans n'importe quelle langue, ne jamais les traduire ;
  - drafting : les langues sont passées **explicitement** dans l'entrée (« clientEmailDraft :
    English (the language of the inbound e-mail, "en") », « internalNote : French (brokerage locale
    "fr") »).
- `draftLanguage` envoyé à Core = `triage.emailLanguage` ; `noteLanguage` = `Brokerage.locale`.

### Core, simulateur, interface

- Core : migration `english_locale` (`ALTER TYPE "Locale" ADD VALUE 'en'`).
- Simulateur : monde FR + EN ; flux qui tire la langue de chaque e-mail selon la part d'anglais
  (`SIMULATOR_ENGLISH_SHARE`, réglable en direct par `POST /language-mix { en }`).
- UI : réglage « E-mails en anglais » dans le panneau de démo, filtre par langue dans la boîte de
  réception (le badge de langue existait depuis V3), pourcentages formatés selon la langue.

## Tests

- Générateur (13 tests) : monde FR identique, clauses Northbridge en anglais, vitrine scénario 13,
  mélange FR/EN dont la langue détectée correspond à la langue déclarée, cas mixtes (e-mail EN sur
  clauses FR et sur clauses EN), cohérence « couvert ⇒ aucune pièce manquante ».
- Simulateur : tirage de la langue et ordre par langue, 0 % / 100 % d'anglais.
- Shared : détection FR/EN.
- Tous les tests V3 (unitaires + intégration) repassent.

### Vérification de bout en bout (vrais modèles)

Scénario 13 envoyé à Core : `client_found` (Brightwave) → `emailLanguage: en` → contrat actif →
`covered`, plafond 20 000 €, franchise 300 €, indemnité estimée 2 000 € → `file_claim` avec un
**brouillon en anglais**, une **note interne en français** et des **citations en français**
(CG-HZ-4.2, CG-HZ-3.1) → validation → sinistre `S-2026-9647` créé dans l'extranet.

## Variables d'environnement

- Nouvelle : `SIMULATOR_ENGLISH_SHARE=0.3`.
- Conseillé : `SIMULATOR_EMAIL_COUNT=40` (avec 10, le lot ne contient que le catalogue français et
  la vitrine anglaise n'y figure pas).
