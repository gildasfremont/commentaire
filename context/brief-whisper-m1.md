# Brief technique — Whisper.cpp sur M1 8Go

Résultat de la recherche de faisabilité. Ce document accompagne l'issue TES-17.

## Whisper.cpp : ce qu'on sait

### Modèles et RAM
- tiny : ~300 Mo runtime. Mauvais en français accentué.
- base : ~388 Mo runtime. Acceptable mais erreurs fréquentes.
- small : ~850 Mo runtime. Bon compromis qualité FR / mémoire. C'est notre cible.
- medium : ~1.5 Go. Meilleure qualité, mais serre le budget RAM.
- large : >2.9 Go. Hors budget sur 8 Go.

### Streaming
whisper.cpp a un mode streaming (exemple dans examples/stream/) avec fenêtre glissante et VAD. Chunks de 500ms, chevauchement pour le contexte. La latence est de 1-2 secondes par segment de 5-10 secondes en batch sur M1.

### Intégration Rust
Deux options :
- whisper-rs : binding Rust pour whisper.cpp. Intégration directe dans Tauri.
- Subprocess : lancer le binaire whisper.cpp compilé. Plus simple, moins intégré.

Recommandation : whisper-rs si le binding compile proprement sur M1, subprocess en fallback.

### Capture audio en Rust
- cpal : crate Rust cross-platform pour capture audio. Supporte CoreAudio sur macOS.
- Le flux audio arrive en PCM 16-bit, whisper.cpp attend du PCM 16kHz mono.
- Il faut un resampler si le micro sort en 44.1kHz ou 48kHz (ce qui est le cas par défaut).

### VAD (Voice Activity Detection)
Pour le MVP, VAD basique par énergie du signal :
- Calculer le RMS (root mean square) de chaque frame audio
- Si RMS > seuil → parole détectée
- Si silence > 2 secondes → fin de segment, envoyer à Whisper

Alternative plus robuste : Silero VAD (modèle ONNX léger, ~2 Mo). Meilleure détection, mais ajoute une dépendance ONNX Runtime.

Recommandation MVP : commencer par énergie RMS. Si trop de faux positifs/négatifs, passer à Silero.

## Ce qu'on veut apprendre avec TES-17

1. La latence Whisper small sur M1 est-elle < 3s pour un segment de 5-10s ?
2. La qualité de transcription FR est-elle exploitable (pas besoin d'être parfaite, juste compréhensible) ?
3. Le VAD énergie suffit-il à segmenter correctement parole/silence ?
4. La RAM totale (Tauri + Whisper) tient-elle sous 1.2 Go ?
5. Le pipeline audio (micro → resample → VAD → Whisper → texte affiché) fonctionne-t-il de bout en bout ?
