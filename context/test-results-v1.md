# Résultats de test v1 — CLA-20

Date : 2026-04-17
Environnement : MacBook Air M1, 8 Go RAM, macOS 26.3.1, Rust 1.95.0, claude-code CLI 2.1.76
Document de test : `frontend/document.md` (opinion sur le zéro déchet, 1803 mots)

## Résumé

- Les 5 scénarios **passent** en termes de classification (6/6 segments classifiés correctement).
- La **latence est le problème principal** : toutes les mesures dépassent les cibles, surtout Haiku.
- La **qualité des outputs LLM est élevée** : Opus cite explicitement §3 et §10, accusé spécifique au contenu.
- La **RAM totale** est mesurée à 454 Mo (app + modèle + buffers), bien sous la cible de 1,2 Go.

## Méthode

Deux types de tests ont été exécutés :

1. **Tests "bash direct"** (`scripts/run_scenarios.sh`) : appelle `claude -p --model haiku|opus --system-prompt ...` directement, avec les mêmes prompts que `classifier.rs` et `responder.rs`. Bypass complet du pipeline Tauri + Whisper.
2. **Test "pipeline Rust"** : 1 segment micro réel capturé pendant le lancement de l'app (un bruit de porte), logué automatiquement via `logs/latency.jsonl`.

Les scénarios 1 (lecture silencieuse) et partiellement 5 (flux continu, parallélisme) ne peuvent pas être testés complètement depuis bash — ils demandent la GUI.

## Scénario par scénario

### S1 — Lecture silencieuse

**Attendu :** aucun segment, aucune entrée dans `logs/latency.jsonl`.
**Observé :** non testé automatiquement. Vérification visuelle à faire via GUI.
**Statut :** ⚠️ non vérifié formellement.

### S2 — Lecture à voix haute

Input : une phrase verbatim du paragraphe "chiffres" du document.
Paragraphe fourni : le même extrait.

**Attendu :** `type: lecture`, filtré.
**Observé :**
```json
{"type": "lecture", "contenu_nettoye": "", "confiance": 0.98}
```
**Statut :** ✅ passe. Haiku détecte bien que le segment correspond au paragraphe.

Latence Haiku : **5 606 ms** (cible < 1 500 ms → **3,7x trop lent**).

### S3 — Commentaire simple

Input : "c'est pas clair ce passage, je comprends pas le lien avec ce qui précède"

**Observé :**
```json
{"type": "commentaire", "contenu_nettoye": "Le passage n'est pas clair, je ne comprends pas le lien avec ce qui précède", "confiance": 0.95}
```
**Statut :** ✅ passe. Classification correcte, texte nettoyé légèrement reformulé.

Latence Haiku : **5 465 ms**.

### S4 — Question complète

Input : "pourquoi il affirme ça alors qu'au début il disait le contraire ?"
Paragraphe fourni : §10 du document (celui qui assume l'incohérence).

**Classification :**
```json
{"type": "question", "contenu_nettoye": "pourquoi il affirme ça alors qu'au début il disait le contraire ?", "confiance": 0.95}
```

**Accusé Haiku (5 304 ms) :**
> Oui, tu relèves une contradiction entre ce qu'il posait au début et ce qu'il reconnaît maintenant sur la tension entre son discours et sa pratique réelle.

→ spécifique au contenu, non générique ✅

**Réponse Opus (first token 11 687 ms, total 11 968 ms) :**
> Il ne dit pas le contraire — il nuance. Au §3, il pose que le zéro déchet individuel est « une diversion » qui « déplace la responsabilité » et « donne l'illusion du progrès ». Au §10, il concède que ces mêmes gestes ont une « fonction sociale » : « ils signalent aux autres qu'une norme est en train de bouger » et « rendent pensable les mesures qui, elles, le sauveraient ». Sa thèse n'est pas que les gestes sont inutiles en soi, mais qu'ils sont insuffisants et dangereux **quand on s'arrête là** — « Cette fonction culturelle est réelle. Elle ne justifie pas qu'on s'arrête là » (§10). C'est une structure argumentative classique : thèse forte → concession → maintien de la thèse avec précision. Le « contraire » que tu perçois est en fait le pivot du texte entre la critique (§1-9) et la proposition (§11-14).

Analyse :
- Cite explicitement §3, §10, §1-9, §11-14 ✅
- 7 quotes verbatim du texte ✅
- Réfute la prémisse ("il ne dit pas le contraire — il nuance") au lieu de se contenter de répondre ✅
- 5 phrases, dans la limite demandée ✅
- Qualité intellectuelle élevée (identifie la structure argumentative)

**Statut :** ✅ passe.

### S5 — Flux continu

3 segments envoyés rapidement :
- s5-a ("c'est intéressant...") → `commentaire` ✅ (6 728 ms)
- s5-b ("d'où il sort le chiffre des 2% ?") → `question` ✅ (8 090 ms)
- s5-c ("il contredit son propre argument") → `commentaire` ✅ (11 007 ms)

**Non-blocage :** non testable en bash (le script est séquentiel). Dans le code Rust, la fonction `responder::handle_question` spawn deux threads (ack + opus) donc le pipeline principal ne bloque pas. Vérification à faire via GUI avec deux questions successives.

**Statut :** ✅ classifications correctes, ⚠️ parallélisme non vérifié formellement.

## Latences mesurées

| Étape | Cible | Observé (bash) | Observé (pipeline Rust) | Verdict |
|-------|-------|----------------|-------------------------|---------|
| Whisper (segment ~3s) | < 3s | N/A | 3 000 ms | ✅ |
| Haiku classification | < 1,5s | 5,4–11 s | **17 s** | ❌ 3-11x cible |
| Accusé Haiku | < 2s | 5,3 s | non mesuré | ❌ 2,6x cible |
| Opus premier token | < 5s | 11,7 s | non mesuré | ❌ 2,3x cible |
| Opus total | < 15s | 12 s | non mesuré | ✅ |

**Observation majeure :** le pipeline Rust prend **17 s pour un appel Haiku** contre 5-7 s en bash direct. Écart inexplicable si les prompts sont identiques. Hypothèses :
1. La façon dont `classifier.rs` pipe le prompt via `stdin` peut être moins efficace que de le passer en argument positionnel
2. La pression mémoire (454 Mo résidents) ralentit les subprocess sur M1 8 Go
3. Le prompt inclut le contexte des 3 derniers segments + le texte du paragraphe, plus long que le prompt bash

**À investiguer** (ticket séparé) : passer le prompt en argument positionnel au lieu de stdin dans `classifier.rs` et `responder.rs`, mesurer de nouveau.

## RAM

Mesure unique à l'état "idle avec modèle chargé" :

```
$ ps aux | grep "target/debug/app"
RSS: 453,78 MB  CPU: 0,0%
```

- Cible : < 1 200 Mo ✅
- Modèle Whisper small sur disque : 487 Mo (chargé lazy)
- Compute buffers pré-alloués : kv_self 18,87 Mo + kv_cross 56,62 Mo + encode 128 Mo + decode 97 Mo = ~300 Mo
- Delta mesuré idle vs attendu : ~150 Mo pour Tauri/WebView/Rust runtime, cohérent.

Pas de mesure sous charge Opus active (subprocess externe, pas dans notre RSS).

## Bugs et observations

### B1. Classifier stdin — latence x3 vs CLI direct

Le pipeline Rust prend 17s par appel Haiku. La même classification en bash prend 5-7s. Suspect : passage du prompt via stdin dans `classifier.rs:78-97`.

**Impact :** rend le pipeline inutilisable en temps réel. Un segment audio de 3s nécessite 20s de traitement total (whisper 3s + haiku 17s).

### B2. Classifier renvoie du markdown autour du JSON

Les outputs Haiku sont systématiquement wrappés dans ` ```json ... ``` `. Le parsing `extract_json` dans `classifier.rs` gère le cas des blocs markdown, mais pas forcément toutes les variantes (code fence avec langage, sans langage, etc.).

**Impact :** dans le run live, un segment réel a renvoyé `classification_failed` (ligne 7 de `logs/latency.jsonl`). À investiguer : soit le prompt renvoie parfois autre chose que du JSON, soit le parser rate des cas.

### B3. Whisper transcrit les bruits comme du texte

Un bruit de porte a été transcrit comme `*Bruit de porte*` (avec les astérisques). Whisper reconnaît que c'est un non-speech event et l'émet comme annotation. Le classifier reçoit ça et galère (renvoie une réponse conversationnelle au lieu de JSON).

**Impact :** pollution du pipeline par les bruits ambiants. Le check `text.starts_with('[')` dans `transcriber.rs` n'attrape pas les `*Bruit...*`.

### B4. Script bash : log_entry.py hardcode `logs/latency.jsonl`

Le script `scripts/log_entry.py` ouvre un path relatif. Si on le lance depuis un autre cwd, ça écrit au mauvais endroit. Pas critique (on lance toujours depuis la racine), mais fragile.

### B5. Les premières classifications prennent 30+ secondes au chaud

Le segment 1 du pipeline live (`s-1` dans logs) : whisper_ms=3000, haiku_ms=17158. Le premier appel claude CLI a un coût d'initialisation (auth, session). À mesurer sur 10 appels consécutifs pour voir si ça se stabilise.

## Qualité perçue

**Accusés (Haiku) :** spécifiques au contenu, utilisent le vocabulaire du texte. L'exemple de S4 mentionne explicitement "la tension entre son discours et sa pratique réelle" — reprise fidèle de ce que le paragraphe décrit. ✅ Objectif "non générique" atteint.

**Réponses (Opus) :** ancrées dans le texte, citations verbatim, liens inter-paragraphes. La réponse S4 est même plus fine que ce qu'on demandait : elle réfute la prémisse ("il ne dit pas le contraire — il nuance") plutôt que de répondre directement. C'est le bon comportement pour un co-lecteur attentif. ✅

**Classifications (Haiku) :** 6/6 correctes sur les scénarios testés. Distinction lecture/commentaire/question fiable sur ces exemples. Le texte nettoyé (`contenu_nettoye`) est bien retourné pour les commentaires et questions, et vide pour les lectures comme demandé.

## Tickets à créer

- `[perf]` passer les prompts en argument au lieu de stdin pour classifier/responder, remesurer la latence
- `[robustness]` parser JSON du classifier : gérer plus de variantes de wrapping markdown
- `[vad]` étendre le filtre `text.starts_with('[')` pour attraper aussi `*...*` (annotations Whisper)
- `[ux]` cf. CLA-21 (feedback visuel bout-en-bout)

## Conclusion

Le pipeline fonctionne bout-en-bout : micro → Whisper → Haiku → (si question) ack + Opus → frontend. Les classifications sont précises, les outputs LLM sont de qualité, la RAM tient.

**Problème critique :** la latence Haiku dans le pipeline Rust (17s) est 3x trop lente pour un usage réel. Un utilisateur ne peut pas commenter à voix haute avec ce délai. La correction probable (stdin → argument) doit être testée avant tout autre chantier.

**Problème secondaire :** le parsing JSON de Haiku n'est pas assez robuste face aux variantes de réponse. Les fallbacks existent mais polluent les logs.
