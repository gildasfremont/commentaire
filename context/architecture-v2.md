# Commentaire — Architecture v2 (avril 2026)

Remplace les choix techniques implicites de spec-commentaire.md. La spec produit (ce que fait Commentaire) reste valide. Ce document décrit comment on le construit.

## Décisions d'architecture

### App desktop, pas web

Commentaire est une app desktop Tauri v2. Pas d'Electron (trop lourd pour 8Go RAM), pas de Next.js, pas de Vercel. L'app tourne entièrement en local.

Raison : chaque utilisateur utilise son propre abonnement Claude via Claude Code CLI en subprocess. Pas de clé API, pas de serveur, pas de coût d'infra. L'authentification passe par le token OAuth de Claude Code (claude setup-token).

### Pile technique

- Runtime desktop : Tauri v2 (Rust backend, WebView frontend)
- Frontend : HTML/CSS/JS vanilla ou Svelte léger. Pas de React.
- Speech-to-text : Whisper.cpp local, modèle small (~850Mo RAM). Français courant.
- Capture audio : cpal (Rust) en continu, VAD par énergie du signal, segmentation par silence > 2s.
- LLM tier 1 (continu) : Claude Haiku via claude -p --model haiku. Classifie chaque segment vocal. ~1 appel toutes les 5-10s.
- LLM tier 2 (réponse) : Claude Opus via claude -p --model opus --output-format stream-json. Déclenché uniquement sur les questions.
- Markdown → HTML : marked.js côté frontend.

### Budget RAM (M1 8Go)

| Composant | RAM estimée |
|-----------|------------|
| Tauri + WebView | ~80 Mo |
| Whisper small | ~850 Mo |
| Claude CLI (subprocess) | ~50 Mo |
| Total app | ~1 Go |
| Disponible pour le système | ~5-6 Go |

### Architecture deux tiers Haiku/Opus

Le flux vocal passe par deux LLM en séquence :

1. Haiku en continu : reçoit chaque segment transcrit + le paragraphe visible + les 3 derniers segments. Retourne un JSON : { type: "lecture" | "commentaire" | "question" | "instruction", contenu_nettoyé: string, confiance: number }. Les segments "lecture" sont filtrés. Les segments "question" déclenchent le tier 2.

2. Opus à la demande : reçoit le document complet + tous les commentaires + la question active. Produit une réponse ancrée dans le texte. Streaming JSON.

### Pattern accusé conversationnel

Quand Opus est déclenché, Haiku génère immédiatement un accusé de réception contextuel ("je vois ce que tu relèves sur ce passage, laisse-moi regarder"). Cet accusé est affiché en < 2s. Opus répond en 5-15s. L'accusé est remplacé par la vraie réponse. L'utilisateur perçoit une conversation, pas un temps de chargement.

L'accusé doit être spécifique au contenu (citer le passage, reformuler la question), jamais générique. C'est un LLM qui simule les signaux conversationnels humains ("hmm", "oui je vois", "attends") en les ancrant dans le contexte.

### Ce qui n'est PAS dans le MVP

- Import de documents (fichier markdown statique embarqué)
- Git sous le capot / versioning
- Persistence des commentaires (state en mémoire, perdu au restart)
- Mode réflexion continue (Opus réfléchit sans qu'on lui demande)
- Conversation multi-tours sur un commentaire
- Modification du document par l'IA
- Eye-tracking ou tracking de lecture avancé

## Issues Linear

Projet "Commentaire MVP" dans le workspace Linear "Test de gildas".

- TES-16 : Scaffold Tauri + affichage document markdown
- TES-17 : Capture micro + transcription Whisper.cpp locale en continu
- TES-18 : Haiku en continu (filtrage lecture/commentaire, classification)
- TES-19 : Réponse Opus avec accusé conversationnel Haiku

Chaque issue est bloquée par la précédente. Commencer par TES-16.
