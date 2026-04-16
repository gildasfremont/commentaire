# Instructions pour Claude Code

## Comment travailler sur ce repo

1. Lis tes issues dans Linear (projet "Commentaire MVP", team "Projets avec Claude"). Prends la première issue non-bloquée qui est en Backlog ou Todo.
2. Mets l'issue en "In Progress" et commente l'issue avec "Je commence, branche : <nom-de-branche>."
3. Crée une branche dédiée avec le nom gitBranchName de l'issue Linear. Ne commite JAMAIS directement sur main.
4. Lis context/architecture-v2.md pour le contexte technique global.
5. Implémente strictement le scope de l'issue. Le hors-scope est aussi important que le scope — ne fais rien qui y figure.
6. Commite et push après CHAQUE étape de ton plan, pas un seul commit à la fin. Un autre agent (Cowork) surveille le repo en temps réel pour suivre ton avancement. Un seul commit monolithique = zéro visibilité pendant toute ta session = échec de coordination.
7. Quand c'est fini, mets l'issue en "Done" et commente avec :
   - Ce qui a été fait
   - Ce qui n'a pas été fait (et pourquoi)
   - Ce qui a posé problème
   - La commande pour tester (ex: `cargo tauri dev`)
8. Si tu es bloqué, commente l'issue dans Linear avec la question précise. Ne reste pas bloqué en silence.

## Checkpoint à chaque commit

Avant chaque commit, fais ces deux choses :
1. Pull main pour rester synchronisé.
2. Lis le fichier `.claude/directives.md` à la racine du repo. S'il existe et contient des instructions, suis-les avant de continuer. S'il n'existe pas, continue normalement.

Ce fichier est le canal de communication de Cowork (l'autre agent) vers toi. Il peut contenir : une correction de trajectoire, une question, une demande d'arrêt, ou un ajustement de scope. Ne l'ignore jamais.

## Conventions

- Branches : utilise le gitBranchName de l'issue Linear. JAMAIS main directement.
- Pull main régulièrement si tu travailles sur une branche longue.
- Ne touche pas au dossier context/ (c'est Cowork qui y écrit).
- Ne touche pas à `.claude/directives.md` (c'est Cowork qui y écrit).
