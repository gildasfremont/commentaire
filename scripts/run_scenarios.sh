#!/usr/bin/env bash
# Exécute les scénarios de test CLA-20 en appelant directement claude CLI
# avec les mêmes prompts que classifier.rs et responder.rs.
#
# Ne remplace PAS le test E2E de la GUI Tauri — teste seulement les
# appels aux sous-processus claude. Utile pour mesurer la latence réelle
# et vérifier que les prompts produisent bien les classifications attendues.
#
# Usage: ./scripts/run_scenarios.sh

set -euo pipefail

cd "$(dirname "$0")/.."

LOG_FILE="logs/latency.jsonl"
REPORT_FILE="logs/scenarios-raw.txt"
mkdir -p logs
: > "$LOG_FILE"
: > "$REPORT_FILE"

# --- Prompts copiés depuis classifier.rs et responder.rs ---

CLASSIFIER_PROMPT='Tu reçois un segment audio transcrit pendant qu'"'"'un utilisateur lit un document à voix haute et le commente oralement. Le paragraphe du document qu'"'"'il est en train de lire est fourni, ainsi que les derniers segments transcrits pour le contexte.

Tu dois déterminer si le segment est :
- "lecture" : l'"'"'utilisateur lit le texte du document à voix haute (le contenu correspond au paragraphe)
- "commentaire" : une remarque personnelle, une réaction, une réflexion sur le texte
- "question" : une question qui attend une réponse (sur le contenu du texte)
- "instruction" : une demande de modification du texte

Retourne UNIQUEMENT un JSON valide, sans markdown, sans explication :
{"type": "...", "contenu_nettoye": "...", "confiance": 0.0}

Le champ contenu_nettoye contient le texte nettoyé du segment : sans hésitations ("euh", "hmm"), sans le texte lu à voix haute, reformulé proprement. Pour les segments de type "lecture", mets une chaîne vide.'

ACK_PROMPT='L'"'"'utilisateur lit un document et vient de poser une question à voix haute. Tu dois générer une phrase courte et naturelle qui montre que tu as compris de quoi il parle, SANS répondre sur le fond. La question va être traitée par un modèle plus puissant.

Exemples de bonnes réponses :
- "Oui je vois, le lien avec ce qu'"'"'il dit sur la lecture silencieuse..."
- "Attends, c'"'"'est intéressant ce que tu relèves là sur la neuroplasticité..."
- "Hmm, bonne question sur ce passage..."

Sois spécifique au contenu (cite le sujet du passage), jamais générique. Une seule phrase, courte. Pas de guillemets autour.'

OPUS_PROMPT='Tu es un co-lecteur attentif. Tu as lu le document en entier et tu as suivi tous les commentaires de l'"'"'utilisateur pendant sa lecture. Il vient de poser une question.

Réponds de façon précise et concise :
- Cite les passages pertinents du document (entre guillemets, avec le numéro de paragraphe)
- Fais des liens entre différentes parties du texte si c'"'"'est pertinent
- Si des commentaires précédents de l'"'"'utilisateur sont liés à la question, mentionne-le
- Sois direct, pas de formules de politesse creuses
- 3-5 phrases maximum'

DOC_TEXT="$(cat frontend/document.md)"

# Paragraphe extrait de la section "## Les chiffres qu'on ne veut pas voir"
PARAGRAPH_TEXT_CHIFFRES="Regardons froidement les proportions. Les émissions de gaz à effet de serre de la France, en 2019, étaient d'environ 441 millions de tonnes équivalent CO2. Sur ce total, les ménages représentent directement environ 25%, essentiellement via le chauffage et la voiture."

# --- Helpers ---

now_ms() { python3 -c 'import time; print(int(time.time()*1000))'; }

log_entry() {
  # $1=id $2=type $3=preview $4=whisper $5=haiku $6=ack $7=opus_first $8=opus_total
  python3 scripts/log_entry.py "$1" "$2" "$3" "$4" "$5" "$6" "$7" "$8"
}

classify() {
  # Returns "type"
  local segment="$1"
  local paragraph="$2"
  local user_prompt="Paragraphe du document actuellement visible :
\"$paragraph\"

Derniers segments transcrits :
  (aucun)

Segment à classifier :
\"$segment\""

  claude -p --model haiku --system-prompt "$CLASSIFIER_PROMPT" "$user_prompt"
}

acknowledge() {
  local question="$1"
  local paragraph="$2"
  local user_prompt="Passage du document : \"$paragraph\"

Question de l'utilisateur : \"$question\""
  claude -p --model haiku --system-prompt "$ACK_PROMPT" "$user_prompt"
}

opus_respond() {
  local question="$1"
  local paragraph_id="$2"
  local paragraph_text="$3"
  local comments="$4"
  local user_prompt="Document complet :
$DOC_TEXT

---

Commentaires de l'utilisateur pendant la lecture :
$comments

---

Paragraphe actif ($paragraph_id) : \"$paragraph_text\"

Question : \"$question\""
  claude -p --model opus --system-prompt "$OPUS_PROMPT" "$user_prompt"
}

# --- Scenarios ---

run_classification_only() {
  local sid="$1" segment="$2" paragraph="$3" preview="$4"
  echo "=== $sid: $preview ===" >> "$REPORT_FILE"
  local start end result type_val
  start=$(now_ms)
  result=$(classify "$segment" "$paragraph" 2>&1 || echo "ERROR")
  end=$(now_ms)
  local haiku_ms=$((end - start))
  echo "RAW: $result" >> "$REPORT_FILE"

  # Extract type from JSON
  type_val=$(echo "$result" | python3 -c 'import json,sys;
try:
  data = sys.stdin.read().strip()
  # strip markdown fences
  if data.startswith("```"):
    data = "\n".join(data.split("\n")[1:-1])
  j = json.loads(data)
  print(j.get("type","unknown"))
except Exception as e:
  print("parse_error")
' 2>/dev/null || echo "parse_error")

  echo "TYPE: $type_val, HAIKU_MS: $haiku_ms" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  log_entry "$sid" "$type_val" "$preview" "" "$haiku_ms" "" "" ""
  echo "[$sid] $type_val in ${haiku_ms}ms"
}

run_question() {
  local sid="$1" question="$2" paragraph_id="$3" paragraph_text="$4" comments="$5"
  echo "=== $sid (QUESTION): $question ===" >> "$REPORT_FILE"
  local start end haiku_ms ack_ms opus_first_token_ms opus_total_ms

  # Step 1: classify
  start=$(now_ms)
  local cls_result
  cls_result=$(classify "$question" "$paragraph_text" 2>&1 || echo "ERROR")
  end=$(now_ms)
  haiku_ms=$((end - start))
  echo "CLASSIFIER: $cls_result" >> "$REPORT_FILE"

  # Step 2: ack (parallel in real pipeline; sequential here for simplicity)
  start=$(now_ms)
  local ack_text
  ack_text=$(acknowledge "$question" "$paragraph_text" 2>&1 || echo "ERROR")
  end=$(now_ms)
  ack_ms=$((end - start))
  echo "ACK (${ack_ms}ms): $ack_text" >> "$REPORT_FILE"

  # Step 3: opus (measure first line as first_token proxy)
  start=$(now_ms)
  local opus_text first_token_ms=""
  # stream the response line-by-line; capture timestamp of first non-empty line
  local tmpfile
  tmpfile=$(mktemp)
  {
    opus_respond "$question" "$paragraph_id" "$paragraph_text" "$comments" 2>/dev/null | while IFS= read -r line; do
      if [ -z "$first_token_ms" ] && [ -n "$line" ]; then
        first_token_ms=$(( $(now_ms) - start ))
        echo "FIRST_TOKEN_MS=$first_token_ms" > "$tmpfile"
      fi
      echo "$line"
    done
  } > "$tmpfile.output"
  end=$(now_ms)
  opus_total_ms=$((end - start))
  first_token_ms=$(grep -oE '[0-9]+' "$tmpfile" 2>/dev/null | head -1 || echo "$opus_total_ms")
  opus_text=$(cat "$tmpfile.output")
  echo "OPUS (first_token ${first_token_ms}ms, total ${opus_total_ms}ms):" >> "$REPORT_FILE"
  echo "$opus_text" >> "$REPORT_FILE"
  echo "" >> "$REPORT_FILE"
  rm -f "$tmpfile" "$tmpfile.output"

  log_entry "$sid" "question" "$question" "" "$haiku_ms" "$ack_ms" "$first_token_ms" "$opus_total_ms"
  echo "[$sid] question — haiku:${haiku_ms}ms ack:${ack_ms}ms opus_first:${first_token_ms}ms opus_total:${opus_total_ms}ms"
}

echo "Running CLA-20 scenarios against claude CLI..."
echo "Logs → $LOG_FILE"
echo "Raw outputs → $REPORT_FILE"
echo ""

# Scenario 2: lecture à voix haute
# On prend une phrase directe du paragraphe "chiffres"
run_classification_only "s2-lecture" \
  "Regardons froidement les proportions. Les émissions de gaz à effet de serre de la France en 2019 étaient d'environ 441 millions de tonnes équivalent CO2." \
  "$PARAGRAPH_TEXT_CHIFFRES" \
  "lecture-aloud-chiffres"

# Scenario 3: commentaire
run_classification_only "s3-commentaire" \
  "c'est pas clair ce passage, je comprends pas le lien avec ce qui précède" \
  "$PARAGRAPH_TEXT_CHIFFRES" \
  "commentaire-pas-clair"

# Scenario 4: question (full pipeline)
run_question "s4-question" \
  "pourquoi il affirme ça alors qu'au début il disait le contraire ?" \
  "p-10" \
  "Il faut être honnête sur une chose : l'argument que je viens de dérouler est en tension avec ce que je fais moi-même." \
  "(aucun)"

# Scenario 5: continuous flow — 3 classifications rapides
echo ""
echo "Scenario 5: continuous flow (3 segments rapides)"

run_classification_only "s5-a" \
  "c'est intéressant cette idée de transfert de responsabilité" \
  "$PARAGRAPH_TEXT_CHIFFRES" \
  "cont-commentaire-1"

run_classification_only "s5-b" \
  "d'où il sort le chiffre des 2% ?" \
  "$PARAGRAPH_TEXT_CHIFFRES" \
  "cont-question"

run_classification_only "s5-c" \
  "bon mais en fait il contredit son propre argument" \
  "$PARAGRAPH_TEXT_CHIFFRES" \
  "cont-commentaire-2"

echo ""
echo "Done. $(wc -l < "$LOG_FILE") entries in $LOG_FILE"
