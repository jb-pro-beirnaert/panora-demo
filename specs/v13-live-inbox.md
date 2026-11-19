# V13 — Boîte de réception vivante

**Résultat attendu** : en regardant l'écran, on voit sans explication qu'un e-mail arrive, quel agent travaille dessus et ce qu'il fait, quand un dossier attend le courtier, et quand il est terminé. Mastra et Langfuse sont accessibles en un clic depuis chaque dossier.

**Services touchés** : `apps/web`, `apps/core-api` (événements et statuts), `apps/agents` (événements de début d'étape), `packages/shared`.

**Prérequis** : V12 (un seul courtier, Langfuse local).

## 1. Un statut lisible par dossier

Aujourd'hui, un dossier est `received`, `processing` ou `awaiting_approval`. On ne sait pas quel agent tourne, ni si le dossier attend dans la file.

- Nouveau **statut d'affichage**, calculé par Core à partir des étapes et des événements et envoyé dans `CaseSummary` :

| Statut d'affichage | Quand | Rendu |
| --- | --- | --- |
| `queued` | e-mail reçu, tâche en file (derrière le limiteur) | sablier gris |
| `triage_running` | `triageAgent` en cours | spinner + « Triage » |
| `coverage_running` | `coverageAgent` en cours | spinner + « Analyse de couverture » + outil MCP en cours |
| `drafting_running` | `draftingAgent` en cours (y compris une révision après refus) | spinner + « Rédaction » (+ « révision 2 ») |
| `awaiting_approval` | proposition en attente | pastille orange pulsante « À valider » |
| `executing` | exécution après validation | spinner + « Déclaration chez l'assureur » |
| `done` | `claim_filed`, `ready_to_send` ou `classified` | coche verte + résultat |
| `failed` | échec | croix rouge + « Relancer » |

- Mastra envoie un callback **au début** de chaque étape (`triage.started`, `coverage.started`, `drafting.started`, `execute.started`). Aujourd'hui, il n'envoie qu'en fin d'étape.
- Les événements `case.agent_event` (appels d'outils MCP) alimentent « l'outil en cours » en direct, par exemple `read_clause CG-HZ-12.1`.

## 2. Boîte de réception façon messagerie

- **Arrivée d'un e-mail** :
  - la ligne glisse en haut de la liste avec un surlignage bref ;
  - un point « non lu » reste affiché tant que le dossier n'a pas été ouvert (état local au navigateur) ;
  - un toast « Nouvel e-mail de {client} : {objet} » s'affiche ;
  - le titre de l'onglet porte le nombre de dossiers à valider, par exemple « (3) Boîte de réception ».
- **Mini-pipeline sur chaque ligne** : 5 pastilles Triage → Couverture → Rédaction → Validation → Exécution. Chaque pastille est grise (à venir), animée (en cours), verte (fait), orange (attend le courtier) ou rouge (échec). C'est l'élément central de la version.
- **Onglets de filtre** avec compteurs : Tous · En cours (agents) · À valider · Traités · En erreur. Le compteur de « À valider » est mis en avant : c'est la file de travail du courtier.
- **Vue tableau** (par défaut) **et vue colonnes** (kanban en lecture seule), avec les colonnes File · Agents · À valider · Traités. En vue colonnes, les cartes changent de colonne en direct pendant le traitement, ce qui est très parlant en rafale.
- **Son de notification** : désactivé par défaut, avec un interrupteur dans l'en-tête. Il joue à l'arrivée d'une proposition à valider, pas à chaque e-mail : un son par e-mail serait insupportable en rafale.

## 3. Panneau « Agents en direct »

Un bandeau ou une colonne latérale montre les 3 agents. Ça rend Mastra visible sans quitter l'UI.

- Pour chaque agent :
  - le nombre de dossiers en cours ;
  - le dernier dossier traité et l'outil qu'il appelle en ce moment ;
  - le modèle utilisé (`gpt-5-nano`, `gpt-6-luna`…).
- Une petite animation « réfléchit » quand l'agent attend une réponse du LLM ; une autre « appelle l'extranet » pendant un appel MCP.
- Le nombre de dossiers en file et de dossiers en attente du courtier, pour montrer que le workflow est suspendu et ne consomme rien.

## 4. Page d'un dossier

- **Stepper en haut de page** : le même pipeline que la ligne de la boîte de réception, en grand, avec la durée de chaque étape.
- **Timeline en direct** : l'étape en cours affiche « en cours… » avec un spinner. Chaque appel d'outil MCP apparaît au moment où il part, puis se complète avec sa durée et son résultat.
- **Bloc « Sous le capot »**, avec trois liens et des chiffres :
  - « Voir le run dans Mastra Studio » (`workflowRunId`, URL de Studio à vérifier selon la version de Mastra) ;
  - « Voir la trace dans Langfuse » ;
  - jetons, coût et latence du dossier (les jetons sont déjà dans les étapes ; le coût se lit dans Langfuse, comme dans les evals).
- **Révisions** : après un refus, l'ancienne et la nouvelle proposition sont côte à côte. Ça montre que le commentaire du courtier a été pris en compte.

## 5. Panneau de démo

- Bouton **« Scénario phare »** : envoie l'e-mail du scénario 2 (contrat résilié). Pour la vidéo et pour une démo commentée.
- Les compteurs actuels restent ; le débit est ajouté sous forme de mini-graphique sur la dernière minute.

## Critères d'acceptation

- [ ] Un e-mail envoyé avec « Envoyer 1 e-mail » apparaît en moins d'une seconde avec une animation et un toast ; sa ligne passe en direct par Triage → Couverture → Rédaction → À valider, avec l'agent en cours visible.
- [ ] Pendant `coverageAgent`, la ligne et la page du dossier affichent l'outil MCP en cours.
- [ ] Un dossier en attente de validation est identifiable d'un coup d'œil (pastille orange, onglet « À valider », compteur dans le titre de l'onglet).
- [ ] En rafale, la vue colonnes reste fluide : pas de rendu de 1 000 lignes animées (virtualisation, ou animations coupées au-delà d'un seuil).
- [ ] Depuis un dossier, un clic ouvre le run dans Mastra Studio, un autre ouvre la trace dans Langfuse.
- [ ] Tous les nouveaux textes passent par `fr.json` / `en.json`.

## Hors périmètre

- Les notifications du navigateur (API Notification), les notifications par e-mail et le temps réel mobile.
- Toute modification du workflow ou des agents, sauf les callbacks de début d'étape.
