# Commentaire — Spec v0.1

## Le problème

Les systèmes conversationnels sont inadaptés à l'annotation de texte. Trois contraintes structurelles les disqualifient : la duplication de contexte (il faut citer le passage pour le commenter), le modèle requête-réponse synchrone (chaque input déclenche une réponse), et l'obligation de linéarité (les messages s'empilent dans l'ordre chronologique, pas dans l'ordre du texte). Or commenter un texte, c'est un flux asynchrone, désordonné, discontinu, où la pensée saute, revient, complète.

## Ce que Commentaire fait

Commentaire est un outil de lecture assistée par IA. L'utilisateur importe un document ou le produit via une conversation classique avec un LLM. Dès que le document existe, l'interface bascule en mode Commentaire : le texte devient un espace partagé persistant, et l'interaction se fait par commentaires vocaux ancrés spatialement dans le texte. L'IA est un co-lecteur silencieux qui n'intervient que quand l'utilisateur le décide.
## Deux points d'entrée

1. Import direct : l'utilisateur charge un document (PDF, texte, article web, markdown). Le système passe immédiatement en mode Commentaire.

2. Conversation → document : l'utilisateur démarre une conversation classique avec le LLM. Quand un document substantiel est produit, l'interface bascule en mode Commentaire. La conversation initiale est réinterprétée comme séquence de décisions éditoriales et transformée en notes de commit sur le document initial (commit de genèse).

## Architecture — quatre sous-systèmes

### 1. Tracker de position de lecture

Suit où en est l'utilisateur dans le document. Signaux : position du curseur, scroll, vélocité de défilement. Enregistre une timeline de positions (pas juste la position courante), ce qui permet de savoir ce qui a été lu, survolé, relu. Pas d'eye-tracking (dépendance hardware qui tue l'adoption), le curseur + scroll suffit pour ancrer un commentaire au bon passage à ±1 paragraphe.

### 2. Capture vocale et interprétation

Le micro est actif en continu. Le speech-to-text transcrit en temps réel. Deux traitements sur la transcription brute :

Segmentation : découper le flux vocal en unités de commentaire. Heuristique temporelle (silence > N secondes = fin de segment) combinée à l'ancrage spatial (si le curseur a bougé significativement entre deux segments, ce sont deux commentaires distincts). En première approche, tout est stocké comme commentaire brut, l'utilisateur qualifie ou supprime ensuite. Le mode d'échec d'un filtre trop agressif (perdre un vrai commentaire) est pire que celui d'un filtre trop lâche (garder du bruit).

Classification d'intention : chaque segment est classé comme note pour soi, question au LLM, demande de modification, réaction, signalement d'incohérence. Ça conditionne le routing vers le système de raisonnement.
### 3. Contexte et raisonnement — deux systèmes séparés

C'est le cœur de l'architecture. Deux systèmes distincts, l'un alimente l'autre.

Le premier système est l'assembleur de contexte. Il prend les signaux bruts (position du curseur, segments vocaux transcrits, état courant du document et de ses versions) et produit une représentation structurée de la situation de lecture. Exemple : "l'utilisateur lit le paragraphe 14, il a commenté les paragraphes 3, 7 et 12, son dernier commentaire porte sur une incohérence entre le paragraphe 7 et le 14, le document a été modifié deux fois depuis la version originale, voici les diffs pertinents." Ce système n'est pas nécessairement un LLM lourd, c'est du traitement de signal et de la logique de fenêtrage contextuel, avec éventuellement un modèle léger pour classifier l'intention du commentaire vocal. Il ne raisonne pas, il cadre.

Le second système est le LLM qui raisonne. Il reçoit en entrée non pas le document entier plus tous les commentaires, mais le contexte assemblé par le premier système. Ça résout la taille du contexte (on n'envoie pas 50 pages à chaque appel) et la pertinence (le LLM reçoit ce qui est saillant, pas tout ce qui existe).

Le contexte assemblé n'est pas montré à l'utilisateur pour validation. Si c'est pas fluide, autant demander à l'opérateur d'être rigoureux, ce qu'il n'a pas envie d'être (sinon il ne voudrait pas cette app). La transparence passe par la réponse elle-même : le LLM reformule ce qu'il a compris de la situation ("tu relèves une tension entre le paragraphe 7 et ce que tu lis maintenant"), et si c'est décalé, le commentaire suivant de l'utilisateur corrige naturellement le tir sans mode spécial.

### 4. Trois modes de déclenchement du LLM

Mode explicite : l'utilisateur clique un bouton ou donne une commande vocale ("qu'est-ce que t'en penses"). Trivial.

Mode détection de silence : le système écoute en continu, et quand il détecte un silence après un segment qui ressemble à une demande (intonation montante, marqueurs linguistiques), il traite ça comme un signal d'activation. Le coût du faux positif est faible parce que le LLM ne fait que préparer une réponse sans l'afficher.

Mode réflexion continue : le LLM réfléchit en arrière-plan, en permanence, et le résultat n'est visible que quand l'utilisateur le demande. Le LLM consomme du compute en continu, mais l'utilisateur ne subit jamais d'attente. C'est un modèle pull, pas push. La "permission" n'est pas une permission d'exécuter, c'est une permission d'afficher puis d'agir sur le texte.
## Versioning — git sous le capot

La donnée sous-jacente est un repo git. L'interface est un timeline.

L'utilisateur ne fait pas de commits manuels. Chaque modification (qu'elle vienne de l'utilisateur ou du LLM après validation) crée un commit automatique. Les branches correspondent aux propositions du LLM non encore acceptées. Accept/reject = merge ou discard. L'historique est navigable visuellement, comme un slider temporel sur le document, pas comme un log git.

Les notes de commit sont critiques : elles constituent le RAG interne de l'app. Chaque note capture l'intention qui a produit la modification (quel commentaire l'a déclenchée, quel raisonnement l'a soutenue, quel état du document elle suppose). La génération des notes de commit est elle-même une tâche LLM (modèle moyen). Le graph git + ces notes sémantiques = un RAG spécialisé où le corpus est l'historique du travail sur le document.

Le LLM peut faire trois choses distinctes sous contrôle de l'utilisateur : répondre (texte éphémère, pas versionné), annoter (ajouter ses propres commentaires ancrés au texte, distincts visuellement de ceux de l'utilisateur, supprimables individuellement), ou modifier (proposer des changements au document source, modèle diff/accept/reject par segment).

## Tiers de modèles LLM

Huit types d'appels, trois tiers de modèle. Volume estimé : 80% léger, 15% moyen, 5% fort.

Modèle léger (ou classifieur spécialisé) :
- Transcription → commentaire structuré (segmentation, normalisation)
- Classification d'intention (routing)
- Détection de demande implicite dans les silences

Modèle moyen :
- Assemblage du contexte (fenêtrage, pertinence sémantique)
- Génération des notes de commit (diff + commentaire → note sémantique)
- Réinterprétation conversation → document (ponctuel, une fois par document)

Modèle fort (Opus ou équivalent) :
- Raisonnement de fond (réponse à une question, analyse, synthèse)
- Proposition de modification du texte (qualité d'écriture, compréhension fine)
## Compute — chaque utilisateur utilise son propre Claude

L'app embarque ou pilote Claude Code en sous-processus. Claude Code s'authentifie via le compte Claude de l'utilisateur (OAuth, pas de clé API à manipuler). L'utilisateur se connecte une fois via le navigateur, et ensuite l'app pilote le CLI en arrière-plan. L'utilisateur ne voit jamais un terminal.

L'app lance `claude` en sous-processus avec les bons flags (mode non-interactif, output structuré en JSON), lui passe le contexte assemblé comme prompt, récupère la réponse. Le coût en compute est porté par l'abonnement Claude de l'utilisateur.

Le mode réflexion continue nécessite un throttling intelligent : ne réfléchir que quand il y a eu un nouveau commentaire ou un déplacement significatif dans le texte. L'abonnement Claude Pro a des limites de messages par période, le système doit respecter ce budget.

## Mode d'échec principal

Surcharge cognitive. Si le système stocke trop de commentaires bruts, si l'IA ajoute des annotations non sollicitées, si les versions s'empilent, le document devient illisible. Le levier de design : l'IA reste silencieuse par défaut et la densité d'information visible à l'écran est toujours contrôlée par l'utilisateur, pas par le système.

## Décisions prises

- Pas de validation manuelle du contexte assemblé (la fluidité prime sur le contrôle)
- Git sous le capot, timeline en surface
- Notes de commit = RAG interne (qualité critique)
- Trois modes de déclenchement (explicite, silence, continu) coexistent
- Le modèle fort n'est utilisé que pour le raisonnement de fond et les modifications de texte
- Chaque utilisateur porte son propre coût compute via son compte Claude
- Pas d'eye-tracking, le curseur + scroll suffit