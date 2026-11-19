# Message à Panora — brouillon à personnaliser

> Brouillon : les passages entre crochets sont à compléter par toi (je ne connais pas les détails
> de Doctoride). Ton direct et honnête : c'est une démo construite pour eux, pas un produit.

Bonjour [prénom],

Je candidate au poste de Founding Senior Full Stack Engineer.

**Le projet dont je suis le plus fier : Doctoride.** [En deux ou trois phrases : le problème, ce que
tu as construit, ton rôle, un chiffre (utilisateurs, volume, délai), et ce que tu en as appris.]

**Pour cette candidature, j'ai construit une démo de votre métier**, pour vous montrer comment je
travaille plutôt que de le raconter. Un e-mail de sinistre arrive dans un cabinet de courtage ;
trois agents (tri, garanties, rédaction) l'analysent et interrogent l'extranet de l'assureur via un
serveur MCP ; le courtier valide l'action proposée avant qu'elle soit exécutée et auditée. C'est une
démo, avec des données entièrement fictives, mais construite comme je construirais en production :

- architecture découpée (NestJS, Mastra, MCP, Next.js), files BullMQ, une base par service ;
- moindre privilège : agents en lecture seule, écriture après validation humaine, cloisonnement
  entre cabinets testé en CI ;
- qualité mesurée : tracing Langfuse, evals par agent et par langue, PR bloquée si un prompt régresse,
  comparaison chiffrée des modèles (0,0034 $ par dossier) ;
- résilience : 1 000 dossiers en rafale, extranet instable, instance tuée en cours de route, zéro
  perte.

- Démo en ligne : [URL] — compte : [e-mail] / [mot de passe]
- Vidéo (2 min) : [URL]
- Code : [URL du dépôt] — le README se lit en 2 minutes.

Je serais ravi d'en parler.

[Signature]
