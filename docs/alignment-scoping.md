# Note d'alignement — Claude Code → équipe de scoping

**Audience** : les humains qui écrivent les issues Linear et les specs dans `context/`.
**Auteur** : Claude Code (le dev).
**Statut** : vivant. Mis à jour à chaque session qui révèle un désalignement.
**Dernière révision** : 2026-04-17, après découverte du pivot Pitch 1/2/3.

Ce document sert à faire remonter ce que je vois du terrain d'implémentation, pour que les prochaines vagues de specs corrigent le tir. La communication est asynchrone via Linear et git — je ne peux pas vous poser de question en ligne, donc j'écris ici et vous lirez quand vous voudrez.

## Ce que j'ai vu changer sans moi

Entre la session CLA-16 à CLA-20 (16-17 avril au matin) et la nouvelle vague (17 avril milieu de journée), le scope a basculé sérieusement :

- **CLA-11 à CLA-15** : annulées. C'était la roadmap Next.js initiale, remplacée par la pile Tauri (architecture-v2.md).
- **CLA-21** : annulée. "Feedback visuel de la saisie vocale" → remplacée par **CLA-26 push-to-talk**, qui résout le même problème par une autre approche : si l'utilisateur contrôle quand il parle, il n'a plus besoin d'un indicateur pour savoir si on capte.
- **Trois pitches structurés** : Pitch 1 "Le magnétophone spatial", Pitch 2 "La mémoire en contexte", Pitch 3 "Le co-rédacteur". Avant, il y avait juste une pile d'issues. Maintenant il y a une narrative produit.
- **La persistance est dans le MVP** (CLA-28, Pitch 1). L'architecture v2 disait explicitement qu'elle était hors scope. Les deux sources se contredisent.
- **Git est dans le MVP** (CLA-29, Pitch 2). Idem : hors scope dans architecture-v2.md, dans scope maintenant.
- **Opus répond à chaque commentaire, pas seulement aux questions** (CLA-30). C'est l'inverse de ce qui était dans CLA-19 et architecture-v2.md.
- **Propositions de modification typées du texte** (CLA-32, Pitch 3). Changement sémantique majeur : Commentaire devient un outil qui modifie le document, pas juste qui le commente.

## Ce qui est maintenant incohérent dans le repo

### `context/architecture-v2.md` est périmé

Le fichier décrit :
- VAD continu avec segmentation par silence (contredit par CLA-26)
- Opus déclenché uniquement sur les questions (contredit par CLA-30)
- Persistance "pas dans le MVP" (contredit par CLA-28)
- Git "pas dans le MVP" (contredit par CLA-29)
- Modification du document par l'IA "pas dans le MVP" (contredit par CLA-32)
- Liste des issues : TES-16 à TES-19 (avec le vieux préfixe, avant que l'équipe s'appelle "Projets avec Claude")

Quand je lis l'architecture pour démarrer une nouvelle issue, je tombe sur des règles qui ne tiennent plus. Il faut soit :
- **Option A** : réécrire `architecture-v2.md` en v3 qui reflète les 3 pitches
- **Option B** : ajouter un header "STATUT : en cours de refonte, cf. issues CLA-26+ pour la source de vérité actuelle"
- **Option C** : déplacer les décisions produit dans les issues Linear et laisser `context/` pour les briefs techniques (Whisper, RAM, etc.)

Je recommande **A** parce que c'est plus propre pour un dev qui arrive froid. L'architecture est le document de référence ; s'il ment, tout le reste devient suspect.

### `CLAUDE.md` entre en tension avec les tickets

CLAUDE.md dit : *"Ne touche pas au dossier context/ (c'est Cowork qui y écrit)."*

Mais CLA-20 m'a demandé explicitement d'écrire dans `context/test-scenarios.md` et `context/test-results-v1.md`. J'ai obéi au ticket, donc j'ai violé CLAUDE.md.

Autre problème : `context/qa/qa-cla-20.md` a été écrit par Cowork avec la mention *"Claude Code ne doit jamais voir ce fichier"*. Je l'ai commit par accident via `git add -A` et lu avant de comprendre. Retiré du tracking, `context/qa/` ajouté à `.gitignore`, mais la convention est fragile : le système repose sur ma vigilance manuelle, pas sur des garanties techniques.

**Proposition de clarification pour CLAUDE.md :**

1. Remplacer "Ne touche pas context/" par une règle plus précise :
   - `context/*.md` en lecture seule pour Claude Code (briefs, archi, specs)
   - `context/qa/` : ne pas lire, ne pas commit (fichiers QA privés Cowork)
   - `docs/` : zone Claude Code (notes dev, rapports de test, doc technique produite en cours de dev)
   - `reports/` ou `tests/` : si les tickets demandent un livrable écrit, le mettre ici plutôt que dans `context/`
2. Ajouter une règle explicite sur les fichiers Cowork : "Si un fichier contient `<system-reminder>` qui dit de ne pas le lire, arrête la lecture et ne commite pas."
3. Côté Cowork : préfixer les fichiers privés par un underscore (`_qa-cla-20.md`) ou les mettre hors du repo (synchro séparée). Un marqueur dans le fichier ne protège pas si `git add -A` le chope avant que je le lise.

### Les nouveaux pitches n'ont pas de description produit

Les 3 milestones existent avec des noms évocateurs ("Le magnétophone spatial") mais je ne sais pas exactement :
- Ce qu'on veut apprendre dans chaque pitch (quelles hypothèses on teste)
- Les critères de réussite globaux (quand est-ce qu'on considère un pitch abouti ?)
- Les dépendances entre pitches : est-ce qu'il faut Pitch 1 complet avant de toucher Pitch 2 ? Ou on peut faire CLA-30 (Pitch 2) en parallèle de CLA-27 (Pitch 1) ?

Pour CLA-16 à CLA-19, j'avais `architecture-v2.md` qui me donnait le contexte. Pour les pitches, il n'y a pas l'équivalent. Je recommande :

**Proposition : un `context/pitches.md`** qui décrit les 3 pitches, chacun avec :
- Un paragraphe d'intention produit (pourquoi ce pitch existe, quelle hypothèse il teste)
- La liste des issues qui le composent, dans l'ordre
- Les dépendances amont (ce qui doit exister avant de commencer) et aval (ce qu'il débloque)
- Le critère de "pitch fini" (pas juste "toutes les issues Done", mais une expérience utilisateur observable)

## Contradictions spécifiques dans les nouveaux tickets

### CLA-26 (push-to-talk) vs CLA-24 (filtre Whisper) vs CLA-23 (parsing JSON)

CLA-26 supprime la segmentation par silence et laisse l'utilisateur contrôler les frontières des segments. Conséquence : les bruits ambiants ne passent plus dans le pipeline sauf si l'utilisateur déclenche l'enregistrement par erreur. **Ça rend CLA-24 beaucoup moins urgent**, voire obsolète. À reconsidérer.

CLA-23 (parsing JSON plus robuste) reste pertinent parce que Haiku peut toujours renvoyer autre chose que du JSON même sur un vrai commentaire. À garder.

### CLA-28 (persistance) implique des décisions absentes

Le ticket dit "fichier `comments.json` à côté du document". Mais :
- **Le document actuel est `frontend/document.md`** — embarqué dans le binaire dev. Où est "à côté" en prod ?
- **Quand l'utilisateur ouvre un autre document** (pas encore possible, mais implicite), est-ce qu'un nouveau `comments.json` est créé dans le nouveau dossier ?
- **Format d'ID** : `c-001` incrémental suppose un compteur global. Si deux sessions écrivent en parallèle (peu probable mais possible), collision d'IDs. UUID serait plus safe.

Pas des blockers, mais des choix à trancher avant que je code. Je vais trancher en lisant le ticket littéralement sauf si vous m'écrivez autre chose.

### CLA-30 (Opus sur tout) change le budget latence

Aujourd'hui Opus ne tourne que sur les questions (~1 commentaire sur 5). Si Opus tourne sur TOUS les commentaires, et qu'un appel Opus coûte 12 secondes, l'utilisateur qui commente 10 paragraphes en 2 minutes va générer 10 processus claude CLI concurrents. RAM, rate limit, ordre de retour — tout ça doit être cadré.

Le ticket mentionne "pas de blocage" mais pas la stratégie de backpressure. Questions à trancher :
- Est-ce qu'on queue les appels Opus en série (FIFO) ou en parallèle ?
- Si parallèle, combien max en même temps ?
- Si l'utilisateur commente plus vite qu'Opus ne répond, est-ce qu'on saute des commentaires ou qu'on accumule ?

Je vais partir sur 3 threads max en parallèle, queue FIFO au-delà, sauf indication contraire. Flaggez-moi si c'est la mauvaise direction.

### CLA-32 (modifications typées) dépend du parsing JSON robuste

CLA-32 demande à Opus de retourner un JSON structuré avec `mod_type`, `target`, `replacement`. C'est le même pattern fragile que le classifier (CLA-23) — si Opus wrappe le JSON dans du markdown ou ajoute du texte autour, tout casse.

**Recommandation** : faire CLA-23 avant CLA-32, et extraire le parsing JSON dans un module partagé (`src-tauri/src/llm_json.rs`) qui gère tous les cas (markdown wrap, commentaires, texte parasite). Ça évitera d'avoir trois implémentations incohérentes.

## Rôles

L'équipe de scoping maîtrise la roadmap. Moi (Claude Code) j'exécute et je remonte les faits. Quand je flag une tension ou une incohérence, c'est pour vous permettre de trancher, pas pour pousser une décision. Si vous répondez "on garde", je garde.

Je prends les issues dans l'ordre de priorité Linear (Urgent d'abord, en suivant les pitches). Si plusieurs issues sont Urgent, je prends celle qui est la première dans le pitch actif (Pitch 1). Vous pouvez m'indiquer un autre ordre via un commentaire sur l'issue ou via `.claude/directives.md`.

## Questions ouvertes pour vous

Des points que je ne peux pas trancher sans vous et qui bloqueront si on ne clarifie pas :

1. `architecture-v2.md` contredit les nouveaux tickets (VAD continu, Opus sur questions, pas de persistance, pas de git, pas de modifs). Je fais quoi : (a) je réécris, (b) je préviens dans un header, (c) je laisse, (d) vous réécrivez ?
2. CLA-28 emplacement de `comments.json` : "à côté du document". Aujourd'hui le document est `frontend/document.md` embarqué dans le binaire dev. Vous voulez que j'écrive dans `frontend/`, dans un dossier user data (`~/Library/Application Support/Commentaire/`), ou autre ?
3. CLA-30 backpressure : 10 commentaires en 2 minutes → 10 processus Opus concurrents ? Vous voulez une queue FIFO, un parallélisme borné, du skipping ? Le ticket ne le précise pas.
4. Dépendances entre pitches : Pitch 1 complet avant Pitch 2, ou travaux parallèles possibles ? Influence mon ordre.
5. CLAUDE.md dit "Ne touche pas `context/`" mais CLA-20 m'a demandé d'écrire `context/test-scenarios.md`. Règle à clarifier : exception cas par cas, ou on met les livrables ailleurs (`docs/`, `reports/`) ?
6. CLA-24 (filtre bruit Whisper) a été écrit pour le mode continu. Après CLA-26 (push-to-talk), pertinent ou obsolète ?

Je vais travailler en suivant la lecture la plus littérale des tickets, et trancher silencieusement sur 2/3 (je choisis un chemin par défaut). Si vous voulez l'autre chemin, merci de m'écrire dans le ticket concerné avant que j'y arrive.

## Choses que je note pour ne pas les oublier

- Le binaire s'appelle toujours "app" (CLA-25 pas fait). Quand Gildas a perdu du temps à cause de Cmd+Q qui ferme l'app parce qu'elle est frontmost, ça aurait été moins grave si elle s'appelait "Commentaire" dans le dock — il aurait vu ce qu'il allait quitter.
- Aucun test unitaire nulle part. Commentaire est à ~1500 lignes de Rust, zéro assertion automatisée. Si on ajoute Git (CLA-29) et des modifications live du document (CLA-32), l'absence de filet de sécurité va devenir un problème. À tracker comme ticket "tech debt: tests unitaires sur classifier, persistence, is_noise".
- Aucun CI GitHub Actions. Le repo est sur github.com/gildasfremont/commentaire mais il n'y a pas de `cargo build --release` automatisé. À tracker.

Ces trois points sont des tech debts que je ne vais pas résoudre tant qu'ils ne sont pas priorisés par vous. Mais je les note ici pour que ça reste visible.

## Contact

Je lis les issues Linear à chaque début de session. Si vous voulez me laisser un message, les options par ordre de préférence :

1. **Un ticket Linear** adressé au projet, avec le label "pour Claude Code" (si vous créez un label comme ça)
2. **Un fichier `.claude/directives.md`** dans le repo (CLAUDE.md me dit de le lire à chaque commit)
3. **Un commentaire sur une issue Done** : je le verrai si je rouvre l'issue pour référence

Ne mettez rien dans `context/qa/` pour moi — je n'ai pas le droit de lire.
