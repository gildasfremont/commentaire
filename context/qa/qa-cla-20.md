# QA — CLA-20 : Test d'intégration bout-en-bout

Ce fichier est lu UNIQUEMENT par Cowork (procédure RETOUR du skill handoff).
Claude Code ne doit jamais voir ce fichier. Ne pas le référencer dans le CLAUDE.md ni dans les issues Linear.

## Pré-requis avant d'appliquer la checklist

- CLA-20 est Done dans Linear
- Le code est mergé sur main
- `cargo tauri dev` compile et lance l'app

## Checklist qualitative générique (héritée du skill handoff)

Applicable si CLA-20 produit des outputs LLM (via simulate-question) :

1. [ ] Ancrage : l'output LLM contient un mot spécifique au paragraphe source
2. [ ] Non-répétition : 3 simulate-question avec des questions différentes → 3 accusés différents
3. [ ] Séquencement : l'accusé Haiku s'affiche AVANT le premier token Opus
4. [ ] Non-blocage : pendant qu'Opus streame, un nouveau segment vocal est traité
5. [ ] Remplacement : l'accusé disparaît quand Opus répond, pas d'empilement

## Checklist spécifique CLA-20

### A. Document de test

6. [ ] Le document.md fait 2-3 pages réelles (pas du lorem ipsum, pas un README)
7. [ ] Le texte contient au moins un passage qui prête à discussion (vérifiable en le lisant)
8. [ ] Le texte est en français courant (pas du jargon technique pur)

### B. Scénarios et couverture

9. [ ] Les 5 scénarios sont documentés dans context/test-scenarios.md
10. [ ] Chaque scénario décrit action + résultat attendu + résultat observé
11. [ ] Le scénario "lecture à voix haute" a été testé avec un paragraphe QUI EXISTE dans le document (pas inventé)
12. [ ] Le scénario "flux continu" vérifie explicitement que les timestamps des nouveaux segments arrivent PENDANT le streaming Opus (vérifiable dans latency.jsonl)

### C. Logging de latence

13. [ ] logs/latency.jsonl existe et contient au moins 5 entrées
14. [ ] Chaque entrée a les champs : whisper_ms, haiku_ms, ack_ms (si question), opus_first_token_ms (si question), opus_total_ms (si question)
15. [ ] Les latences sont plausibles (whisper 2-5s, haiku 0.5-1.5s, ack < 2s, opus 5-15s)
16. [ ] Pas de latence aberrante (> 30s) qui indiquerait un blocage du pipeline

### D. Rapport de test

17. [ ] context/test-results-v1.md existe
18. [ ] Le rapport distingue ce qui marche de ce qui ne marche pas (pas un résumé uniformément positif)
19. [ ] La RAM observée est documentée avec une mesure réelle (ps aux ou Activity Monitor), pas estimée
20. [ ] Les bugs trouvés sont listés avec assez de détail pour en faire des tickets

### E. Modes d'échec spécifiques à surveiller

Ces points ne sont PAS dans l'issue. Cowork les vérifie en lisant le code et les logs.

21. [ ] Le VAD ne coupe pas les segments au milieu des phrases (vérifier dans latency.jsonl si des segments font < 1s)
22. [ ] Haiku ne classifie pas systématiquement tout en "commentaire" (vérifier la distribution des types dans les logs)
23. [ ] Le document.md n'est pas un texte que Claude a généré (indice : tournures trop propres, structure parfaite, absence de style personnel). Un vrai texte a des imperfections.
24. [ ] Les réponses Opus ne sont pas tronquées (le dernier event a bien isFinal: true)

## Procédure d'application

1. Lire le rapport test-results-v1.md
2. Lire latency.jsonl, vérifier les distributions
3. Lancer l'app via desktop-commander, exécuter 2-3 simulate-question
4. Cocher chaque point
5. Rapporter à Gildas : score X/24, points échoués, recommandation
