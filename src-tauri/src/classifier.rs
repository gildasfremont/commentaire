use log::{error, info, warn};
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::process::Command;

/// Result of Haiku classification for a transcribed segment.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassifiedSegment {
    /// "lecture", "commentaire", "question", "instruction"
    #[serde(rename = "type")]
    pub segment_type: String,
    /// Cleaned-up text (without hesitations, without read-aloud text)
    pub contenu_nettoye: String,
    /// Confidence 0.0 - 1.0
    pub confiance: f64,
}

/// Maintains context for classification (last N segments).
pub struct ClassifierContext {
    recent_segments: VecDeque<String>,
    max_history: usize,
}

impl ClassifierContext {
    pub fn new() -> Self {
        Self {
            recent_segments: VecDeque::new(),
            max_history: 3,
        }
    }

    pub fn add_segment(&mut self, text: &str) {
        self.recent_segments.push_back(text.to_string());
        while self.recent_segments.len() > self.max_history {
            self.recent_segments.pop_front();
        }
    }

    fn recent_as_string(&self) -> String {
        self.recent_segments
            .iter()
            .enumerate()
            .map(|(i, s)| format!("  [{}] {}", i + 1, s))
            .collect::<Vec<_>>()
            .join("\n")
    }
}

const SYSTEM_PROMPT: &str = r#"Tu reçois un segment audio transcrit pendant qu'un utilisateur lit un document à voix haute et le commente oralement. Le paragraphe du document qu'il est en train de lire est fourni, ainsi que les derniers segments transcrits pour le contexte.

Tu dois déterminer si le segment est :
- "lecture" : l'utilisateur lit le texte du document à voix haute (le contenu correspond au paragraphe)
- "commentaire" : une remarque personnelle, une réaction, une réflexion sur le texte
- "question" : une question qui attend une réponse (sur le contenu du texte)
- "instruction" : une demande de modification du texte

Retourne UNIQUEMENT un JSON valide, sans markdown, sans explication :
{"type": "...", "contenu_nettoye": "...", "confiance": 0.0}

Le champ contenu_nettoye contient le texte nettoyé du segment : sans hésitations ("euh", "hmm"), sans le texte lu à voix haute, reformulé proprement. Pour les segments de type "lecture", mets une chaîne vide."#;

/// Classify a transcribed segment using Claude Haiku via CLI.
pub fn classify_segment(
    segment_text: &str,
    paragraph_text: &str,
    context: &ClassifierContext,
) -> Result<ClassifiedSegment, String> {
    let recent = context.recent_as_string();

    let user_prompt = format!(
        "Paragraphe du document actuellement visible :\n\"{}\"\n\nDerniers segments transcrits :\n{}\n\nSegment à classifier :\n\"{}\"",
        paragraph_text, recent, segment_text
    );

    let start = std::time::Instant::now();

    let output = Command::new("claude")
        .args([
            "-p",
            "--model", "haiku",
            "--output-format", "text",
        ])
        .env("CLAUDE_SYSTEM_PROMPT", SYSTEM_PROMPT)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            if let Some(ref mut stdin) = child.stdin {
                stdin.write_all(user_prompt.as_bytes())?;
            }
            child.wait_with_output()
        })
        .map_err(|e| format!("Failed to run claude CLI: {}", e))?;

    let elapsed = start.elapsed();

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("claude CLI failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    info!(
        "Haiku classified in {:.1}s: {}",
        elapsed.as_secs_f32(),
        &stdout
    );

    // Parse the JSON response — handle potential markdown wrapping
    let json_str = extract_json(&stdout);

    serde_json::from_str::<ClassifiedSegment>(&json_str)
        .map_err(|e| format!("Failed to parse Haiku response: {} — raw: {}", e, stdout))
}

/// Extract JSON from a string that might be wrapped in markdown code blocks.
fn extract_json(s: &str) -> String {
    let s = s.trim();

    // Remove markdown code block if present
    if s.starts_with("```") {
        let lines: Vec<&str> = s.lines().collect();
        let start = if lines.first().map_or(false, |l| l.starts_with("```")) { 1 } else { 0 };
        let end = if lines.last().map_or(false, |l| l.trim() == "```") { lines.len() - 1 } else { lines.len() };
        return lines[start..end].join("\n").trim().to_string();
    }

    // Try to find JSON object in the string
    if let Some(start) = s.find('{') {
        if let Some(end) = s.rfind('}') {
            return s[start..=end].to_string();
        }
    }

    s.to_string()
}
