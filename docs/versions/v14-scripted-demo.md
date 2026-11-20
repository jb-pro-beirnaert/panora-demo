# V14 — Démo scénarisée et vrais PDF

Branche : `v14-scripted-demo` (créée depuis `v13-live-inbox`).
Spec : [`specs/v14-scripted-demo.md`](../../specs/v14-scripted-demo.md).

## Ce qui a été fait

### Une démo finie

- `packages/world-generator` : `DEMO_SCRIPT` (14 entrées : les 12 cas du catalogue en français,
  dont résiliation et devis, puis un sinistre en anglais et le cas « langues croisées ») et
  `generateDemoScript(world, seed)`. Le premier e-mail de chaque scénario de sinistre est sa version
  « vitrine » quand le monde en a une ; le scénario phare (contrat résilié) est le n° 2.
- Simulateur : `DemoPlayer` remplace le flux sans fin. États `ready` → `running` / `paused` →
  `finished` ; `POST /send-one` envoie **le prochain e-mail du script** ; `POST /speed` règle
  l'intervalle (`intervalSeconds`, 20 s par défaut) ; `POST /reset` revient à 0/X. Au démarrage, il
  reprend au nombre de dossiers déjà présents dans Core (redémarrage en mode watch). `GET /state`
  renvoie `sent`, `total`, `next` et la liste du script.
- Supprimés : routes `/burst`, `/auto-validation`, `/language-mix`, `/send-showcase` ; le badge et
  le marqueur d'audit « auto » ; la décision « simulée » de Core (le jeton d'administration n'a plus
  d'effet sur `POST /cases/:id/decision`).
- Le test de charge (`npm run load-test`) devient autonome : il génère ses e-mails et leurs PDF, les
  envoie directement à Core et lance son propre courtier simulé (`AutoValidator` et `Burst` ne
  servent plus qu'à lui).
- Panneau de démo : « Démo · 7/14 e-mails envoyés » avec barre de progression, Lecture/Pause,
  « Envoyer 1 e-mail » (sujet du prochain en info-bulle), intervalle, « Réinitialiser », liste
  dépliable du script (coche pour les e-mails envoyés, prochain surligné).

### Vrais PDF

- Nouveau package `@demo/documents` :
  - `renderPdf` : met en page le texte d'un document (titre, champs `Libellé : valeur` en gras, une
    page PDF par marqueur `--- page N ---`) avec **pdfmake** et les polices PDF standard (pas de
    fichier de police, ~3 Ko par PDF). Date de métadonnées fixe : même texte, mêmes octets (testé).
  - `extractText` : texte page par page avec **unpdf** (pdf.js), mêmes marqueurs, pieds de page
    retirés, 8 000 caractères au plus par pièce.
  - `toRawEmail` / `extractEmail` / `extractAttachment` ; photos : une image JPEG générique fixe,
    jamais analysée (« [image not analyzed: …] »).
- `POST /emails` reçoit maintenant `{ fileName, contentType, contentBase64 }` (PDF, JPEG, PNG ;
  2 Mo et 5 pièces au plus). Core extrait le texte à la réception et stocke le fichier
  (`Attachment.content`, `sizeBytes`, `pageCount`, `extractionStatus` ; migration
  `20261120090000_attachment_files`). Un PDF illisible crée quand même le dossier, avec la pièce
  marquée « illisible ».
- `GET /cases/:id/attachments/:attachmentId/file` sert le fichier (`inline`). La purge de rétention
  vide aussi les fichiers ; le texte extrait reste lisible dans le dossier.
- Page du dossier : chaque pièce jointe affiche son nombre de pages, sa taille, un lien « Ouvrir »
  et, dépliable, le texte extrait transmis aux agents.
- Les agents ne voient toujours que du texte : le workflow Mastra et les prompts sont inchangés.
- Evals : le jeu de données garde les pièces en texte ; le lanceur les met en page en PDF avant
  `POST /emails`, Core en extrait le texte comme pour la démo.

## Vérifié

- `format:check`, `lint`, `typecheck`, `test` (dont 4 tests `@demo/documents`, 5 tests du lecteur
  de démo, le test du script) et `test:integration` (Core : dossier reçu avec PDF, texte extrait,
  fichier servi) au vert.
- Démo réelle (`npm run dev`, gpt-5-nano / gpt-6-luna) : bandeau « 0/14 », envoi du n° 1 → « 1/14 »,
  liste du script cochée ; l'agent de tri cite `facture_vitrage.pdf p.1` comme source, le dossier
  affiche « 1 page · 2 Ko », le texte extrait et un PDF valide (`application/pdf`, `inline`).

## Non vérifié

- Les evals complètes sur le chemin PDF (la baseline n'a pas été ré-enregistrée, pour le budget LLM).
- Le test de charge à 1 000 e-mails avec PDF.

## Variables d'environnement

- Supprimées : `SIMULATOR_EMAIL_COUNT`, `SIMULATOR_EMAILS_PER_MINUTE`.
- Nouvelle : `SIMULATOR_INTERVAL_SECONDS=20`.
- `SIMULATOR_ENGLISH_SHARE` ne règle plus que la part de clients anglophones du monde.
