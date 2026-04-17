# Notes de Claude Code sur Commentaire

Remarques de travail accumulées au fil des sessions. Cette note vit dans `docs/` (pas `context/` qui appartient à Cowork). Mise à jour après chaque session significative.

## État au 17 avril 2026

Issues livrées : CLA-16, CLA-17, CLA-18, CLA-19, CLA-20. Le pipeline technique complet est en place.

Issues en backlog créées lors des sessions :
- **CLA-21** (High) — feedback UX bout-en-bout (manque de signal visuel)
- **CLA-22** (Urgent) — perf Haiku 3-11x trop lente (stdin vs argument)
- **CLA-23** (High) — parser JSON du classifier pas robuste
- **CLA-24** (High) — filtrer les annotations Whisper `*...*`
- **CLA-25** (Medium) — renommer le binaire "app" en "commentaire"

## Ce qui marche bien

**Architecture Tauri v2 + vanilla frontend.** Le choix de ne pas mettre de framework est payant : moins de surface d'attaque, démarrage rapide, rien à apprendre pour qui débarque. Les events Tauri (`listen`/`emit`) sont simples et suffisent au MVP.

**Séparation des modules Rust.** `audio.rs`, `transcriber.rs`, `classifier.rs`, `responder.rs`, `latency.rs` — chaque module a une responsabilité claire et une interface minimale (channels mpsc, `AppHandle`). C'est facile à relire et à debugger.

**whisper-rs et cpal.** Deux crates matures qui tiennent leurs promesses. Le modèle Whisper small est un sweet spot sur M1 8Go : qualité française correcte, RAM acceptable, temps de chargement raisonnable.

**State Whisper réutilisé.** Dès qu'on a vu que créer un nouvel état par segment coûtait 300Mo de buffers, on a mutualisé. C'était le premier problème de RAM à résoudre.

## Ce qui ne marche pas bien

**Claude CLI en subprocess** est le goulot d'étranglement du projet. Chaque appel coûte 5 secondes minimum, parfois 17. On n'a pas le contrôle dessus. Si on voulait passer à 1,5s par classification, il faudrait soit :
- L'API directe (mais ça casse le modèle "chaque user a son abonnement")
- Garder une session `claude` interactive ouverte et y injecter les prompts (mais c'est fragile)
- Batcher les classifications (mais ça ruine la réactivité)

Pour le MVP on vit avec, mais c'est la contrainte dure qui détermine tout le reste.

**VAD par RMS seul** attrape trop de bruits ambiants. Sur MacBook, la respiration, les claviers, les portes passent le seuil 0.015. Un vrai VAD (Silero) serait plus robuste mais ajoute une dépendance ONNX de 2Mo. À faire si on industrialise.

**Tauri en dev sans bundle** empêche l'intégration avec macOS. Pas de menu "Commentaire", pas de bundle ID reconnu, pas de permissions proprement demandées. `cargo tauri build` produirait un vrai `.app` mais on n'a jamais lancé cette commande.

**Le CLAUDE.md entre en tension avec les tickets Linear.** CLAUDE.md dit "Ne touche pas au dossier context/" mais CLA-20 demandait explicitement d'écrire dedans. J'ai suivi le ticket. Il faudrait clarifier : soit exception pour certains tickets autorisés, soit déplacer ces artefacts ailleurs (`docs/`, `reports/`).

## Patterns de code à garder

**Un log JSON-lines par segment.** `logs/latency.jsonl` est pratique à analyser en bash avec `jq`, facile à grep, facile à concat. Pas de base SQL pour le moment — pas besoin.

**Thread séparé pour les appels LLM.** Le responder spawne deux threads (ack + opus) qui ne bloquent pas le pipeline audio principal. Si Haiku devient rapide, ce pattern reste utile pour laisser Whisper continuer à transcrire pendant qu'on classifie.

**Messages clairs en français dans les prompts système.** Écrire les prompts en français pour un contexte français améliore la qualité des réponses. Testé empiriquement sur CLA-20.

**Fallback explicite partout.** Si Haiku échoue à classifier, on émet comme "commentaire". Si Opus échoue, on émet un message d'erreur propre. Jamais de crash, toujours une dégradation gracieuse visible côté UI.

## Patterns à éviter / dettes

**`std::process::Command` + stdin pour les LLM.** Semble être la cause principale de la latence Haiku. À changer avant toute autre optimisation (CLA-22).

**Markdown parsing ad-hoc.** Le `extract_json` dans classifier.rs cherche `{...}` avec un peu de bonne volonté. Ça marche 95% du temps. Il faudrait un parser plus strict ou rendre le prompt plus directif ("retourne UNIQUEMENT entre accolades, pas de texte avant ni après").

**`CLAUDE_SYSTEM_PROMPT` env var au lieu de `--system-prompt` flag.** J'ai d'abord utilisé l'env var (qui n'est pas lue par la CLI), ce qui a produit des classifications conversationnelles pendant ~10 minutes avant que je comprenne le bug. Leçon : toujours lire `claude --help` avant de deviner l'interface.

**`unwrap()` dans le code de setup.** Dans `lib.rs`, `audio::start_capture().expect(...)` plante toute l'app si le micro n'est pas dispo. Pour le MVP OK, mais plus tard il faudrait un mode "lecture sans micro" qui dégrade proprement.

## Remarques UX / produit

**L'utilisateur ne sait pas si son micro capte.** C'est CLA-21 mais c'est plus qu'un ticket : c'est la raison pour laquelle aucun test live n'a marché. Un point rouge qui pulse est insuffisant. Il faut une amplitude en temps réel.

**La latence Haiku tue la sensation de conversation.** 17 secondes avant que quoi que ce soit apparaisse rend le système inutilisable pour un commentaire vocal fluide. Les scénarios bash ont fonctionné parce qu'on attend passivement. Le vrai usage demande du feedback immédiat.

**Le champ texte de la sidebar sauve les tests.** Comme `prompt()` JavaScript est bloqué dans la WebView Tauri, le fallback `<input>` dans la sidebar est devenu le vrai moyen de tester sans micro. À garder en feature, pas juste en outil de dev — un utilisateur qui ne peut pas parler (bureau bruyant, nuit, déplacement) apprécierait un fallback texte natif.

**Le document de test est génial à relire mais reconnaissable "IA".** J'ai écrit l'essai sur le zéro déchet pour CLA-20. Il a du style, il a une voix, il a même des incohérences volontaires. Mais un lecteur attentif verra que c'est trop propre structurellement. Pour un vrai test d'usage, il faudrait un texte humain pris sur internet (Diplo, Philomag, Socialter — des sources avec opinion).

## Recommandations pour la suite

1. **CLA-22 en premier.** Si on fixe la perf Haiku, presque tout le reste devient utilisable. C'est la priorité absolue.
2. **CLA-24 avant CLA-21.** Filtrer les bruits avant d'améliorer l'UX : sinon l'UX montre des trucs pollués.
3. **CLA-23 en même temps que CLA-22.** Quand on change l'appel CLI, on en profite pour robustifier le parser.
4. **CLA-21 après les trois bugs.** Feedback UX marche bien si le pipeline est rapide et propre. Inutile avant.
5. **CLA-25 à faire quand on a 15 minutes.** Purement cosmétique mais débloque le test auto via computer-use.

## Tensions de process à flagger à Gildas

**Le fichier `context/qa/qa-cla-20.md` a été accidentellement commit puis lu.** C'était un fichier Cowork interne marqué "Claude Code ne doit jamais voir ce fichier". Je l'ai retiré immédiatement (`git rm --cached`), ajouté `context/qa/` à `.gitignore`, et je n'ai pas utilisé son contenu pour orienter le rapport. Mais ça soulève une question : si Cowork écrit dans `context/` et que `git add -A` est naturel, la convention est fragile. Deux options :
- Cowork écrit dans un chemin outside git (`~/cowork/commentaire/...`) qu'il partage autrement
- Un hook pre-commit qui refuse `context/qa/` (mais on ne peut pas l'avoir avant de savoir qu'il existe)

**Le ticket CLA-20 demandait d'écrire dans `context/`** alors que CLAUDE.md l'interdit. Clarifier qui a priorité : la règle générale ou l'instruction spécifique du ticket.

## Choses que je n'ai pas faites mais que j'aurais voulu faire

- **Tests unitaires.** Rust est excellent pour ça, on n'en a aucun. Un `cargo test` vide est une dette culturelle. Les modules les plus testables sont classifier (pur transformation texte → JSON) et latency (pur IO).
- **Benchmark Whisper.** On a "ça marche" mais jamais mesuré la qualité de transcription sur des segments contrôlés. Un corpus de 10-20 segments avec transcription de référence, un script qui les passe et calcule le WER (Word Error Rate).
- **UI de replay.** Pouvoir rejouer une session (document + segments + réponses) depuis les logs pour debugger ce qui s'est passé. Ça demanderait de stocker les samples audio en plus des métriques, ce qui est volumineux.
- **Gestion des erreurs utilisateur.** Si le micro est débranché en cours de session, qu'est-ce qui se passe ? Actuellement, panique silencieuse. À prévoir pour la v1.
