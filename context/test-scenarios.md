# Scénarios de test manuels — Commentaire MVP

Ces 5 scénarios vérifient le pipeline bout-en-bout (Tauri + Whisper + Haiku + Opus) avec le document `frontend/document.md` (opinion sur le zéro déchet, ~1800 mots).

## Préparation

```bash
cd /path/to/commentaire
MACOSX_DEPLOYMENT_TARGET=11.0 cargo tauri dev
```

Attendre le message `Audio capture started` dans les logs. Le modèle Whisper small (~487 Mo) est chargé, Whisper state pré-alloué. Vérifier la RAM :

```bash
ps aux | grep "target/debug/app" | grep -v grep
```

---

## Scénario 1 — Lecture silencieuse

**Action :** Ouvrir l'app. Scroller le document sans parler pendant 30 secondes.

**Résultat attendu :**
- Indicateur micro reste au repos (point vert, label "Commentaires")
- Aucun segment ne s'affiche dans la sidebar
- Les events `scroll-position` sont émis en continu (visible dans la devtools console si ouverte)
- `logs/latency.jsonl` ne reçoit aucune entrée

**Vérification :**
- `cat logs/latency.jsonl | wc -l` avant et après → même nombre
- Inspecter la sidebar : vide

---

## Scénario 2 — Lecture à voix haute

**Action :** Scroller jusqu'au paragraphe `## Les chiffres qu'on ne veut pas voir`. Lire à voix haute le premier paragraphe de cette section : « Regardons froidement les proportions... »

**Résultat attendu :**
- L'indicateur passe à "Parole..." puis "Transcription..."
- Haiku classifie en `lecture`, le segment est filtré
- Rien n'apparaît dans la sidebar
- `logs/latency.jsonl` reçoit une entrée avec `segment_type: "lecture"`, `whisper_ms` et `haiku_ms` renseignés, autres champs null

**Vérification :**
```bash
tail -1 logs/latency.jsonl | jq '.'
```
Doit montrer un objet avec `segment_type: "lecture"`.

---

## Scénario 3 — Commentaire simple

**Action (simulation) :** Dans le champ texte de la sidebar, saisir :
> « c'est pas clair ce passage, je comprends pas le lien avec ce qui précède »

Appuyer sur Entrée. Le paragraphe visible au centre de l'écran est utilisé comme ancrage.

**Action (micro) :** Même texte, prononcé à voix haute, puis 2s de silence.

**Résultat attendu :**
- Segment affiché en grisé (`commentaire`), ancré au paragraphe actif
- Pas de déclenchement d'accusé ni de réponse Opus
- `logs/latency.jsonl` reçoit une entrée `segment_type: "commentaire"`, `haiku_ms` renseigné

**Vérification :**
- Sidebar : un bloc "Commentaire · HH:MM:SS · p-N" avec le texte
- `tail -1 logs/latency.jsonl | jq .segment_type` → `"commentaire"`

---

## Scénario 4 — Question avec accusé + réponse Opus

**Action (simulation) :** Saisir dans le champ texte :
> « pourquoi il affirme ça alors qu'au début il disait le contraire ? »

Appuyer sur Entrée.

**Résultat attendu :**
1. Un segment `question` apparaît (bordure orange)
2. En moins de 2 secondes : une carte ambre (accusé Haiku) apparaît en dessous, texte spécifique au contenu
3. En 5-15 secondes : la carte passe au vert, contient la réponse Opus
4. La réponse cite au moins un passage du document (test : la réponse contient `"` ou un numéro `p-N`)
5. `logs/latency.jsonl` reçoit une entrée complète : `haiku_ms`, `ack_ms`, `opus_first_token_ms`, `opus_total_ms`

**Vérification :**
```bash
tail -1 logs/latency.jsonl | jq '{type: .segment_type, haiku: .haiku_ms, ack: .ack_ms, first: .opus_first_token_ms, total: .opus_total_ms}'
```
Tous les champs doivent être numériques.

---

## Scénario 5 — Flux continu, non-blocage

**Action (simulation) :** Saisir 3 entrées rapidement (laisser 1s entre chaque) :
1. « c'est intéressant cette idée de transfert de responsabilité »  *(commentaire)*
2. « d'où il sort le chiffre des 2% ? »  *(question)*
3. « bon mais en fait il contredit son propre argument »  *(commentaire)*

**Résultat attendu :**
- Les 3 segments s'affichent dans l'ordre dans la sidebar
- L'accusé et la réponse Opus pour le segment 2 se construisent pendant que les segments 1 et 3 arrivent
- Aucun blocage perceptible : les segments 1 et 3 apparaissent immédiatement sans attendre Opus
- Dans `logs/latency.jsonl` : 3 entrées (ou plus si latences s'entrelacent), les timestamps du segment 3 sont antérieurs à `opus_total_ms` du segment 2

**Vérification :**
```bash
tail -5 logs/latency.jsonl | jq -c '{t: .timestamp, type: .segment_type, opus_total: .opus_total_ms}'
```
On doit voir le timestamp du commentaire 3 (entrée sans `opus_total_ms`) antérieur ou proche de l'entrée question+opus.

---

## Budgets de latence cibles (rappel)

| Étape | Cible | Acceptable | Inacceptable |
|-------|-------|------------|--------------|
| Whisper (segment ~5s) | < 3s | 3-5s | > 5s |
| Haiku classification | < 1.5s | 1.5-3s | > 3s |
| Accusé Haiku | < 2s | 2-3s | > 3s |
| Opus premier token | < 5s | 5-10s | > 10s |
| Opus total | < 15s | 15-25s | > 25s |

RAM totale cible : < 1.2 Go (Tauri + Whisper small + compute buffers).

---

## Notes

- Le scénario 1 (lecture silencieuse) est un test négatif : on vérifie qu'aucune fausse détection ne se produit.
- Le scénario 2 (lecture à voix haute) dépend fortement de la qualité du prompt Haiku. Un test d'échec ici révèle un bug de prompt, pas un bug d'implémentation.
- Les scénarios 3-5 peuvent être rejoués via le champ texte (simulate_question) sans utiliser le micro. Utile en développement.
