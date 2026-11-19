# V11 — Finitions pour la candidature

Branche : `v11-finishing` (créée depuis `v10-security-compliance`).
Spec : [`specs/v11-finishing.md`](../../specs/v11-finishing.md).

## Ce qui a été fait

- **README** réécrit (anglais, résumé en français en tête) : le problème et le parcours d'un
  dossier, l'architecture (schéma Mermaid + tableau des services), les choix et leurs compromis
  (microservices, trois agents, Mastra en mode framework, moindre privilège, prompts en anglais pour
  une démo bilingue, Langfuse auto-hébergeable, modèles bon marché mesurés), les résultats chiffrés
  (evals, coûts, charge, cloisonnement), le lancement, puis les sections détaillées des versions 6 à
  10 (tracing, tableau de comparaison des modèles, charge, sécurité et RGPD).
- **Deux commandes** : `npm install` puis `npm run dev`. Au premier lancement,
  `scripts/ensure-env.mjs` crée `.env` depuis `.env.example` avec des secrets aléatoires (il ne
  touche jamais un `.env` existant) ; il reste à renseigner `OPENAI_API_KEY` (ou
  `AGENTS_MODE=simulated` pour tout essayer sans LLM). Testé sur un dossier vierge.
- **Docker** : `npm run start:docker` (profil `apps`) ; les 5 images se construisent
  (`turbo prune --docker`) ; URLs publiques du front passées en arguments de build ; rapports d'evals
  copiés dans l'image (écran Evals) ; Mastra démarre directement sa sortie de build. Images testées
  une à une : Core (migrations + `/health`), web (`/fr/login`, `/en/evals`), agents (`/health`, API
  refusée sans jeton).
- **Déploiement** : guide Dokploy pas à pas ([`docs/deployment.md`](../deployment.md)) : domaines
  sur le même domaine parent (cookie de session), variables, services à ne pas exposer, budget.
- **Vidéo de 2 minutes** : script minuté ([`docs/video-script.md`](../video-script.md)).
- **Message à Panora** : brouillon à compléter ([`docs/message-panora.md`](../message-panora.md)).
- Journal des versions : [`docs/versions/README.md`](README.md).

## Ce qui reste à faire par toi

- Mettre le dépôt en ligne (rien n'a été poussé).
- Enregistrer la vidéo (script prêt).
- Déployer sur un VPS (je n'ai pas d'accès serveur) en suivant `docs/deployment.md`.
- Compléter le message (partie Doctoride, liens).
- Le `docker compose --profile apps up` complet n'a pas été lancé ici : il lit ton `.env`, qui doit
  d'abord recevoir les nouvelles variables (voir la liste dans le message final).
