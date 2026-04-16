use log::{error, info};
use serde::Serialize;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter};

/// Acknowledgment payload from Haiku.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AckPayload {
    pub text: String,
    pub question_id: String,
}

/// Opus response payload (streamed chunks or final).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpusResponsePayload {
    pub text: String,
    pub question_id: String,
    pub is_final: bool,
}

const ACK_SYSTEM_PROMPT: &str = r#"L'utilisateur lit un document et vient de poser une question à voix haute. Tu dois générer une phrase courte et naturelle qui montre que tu as compris de quoi il parle, SANS répondre sur le fond. La question va être traitée par un modèle plus puissant.

Exemples de bonnes réponses :
- "Oui je vois, le lien avec ce qu'il dit sur la lecture silencieuse..."
- "Attends, c'est intéressant ce que tu relèves là sur la neuroplasticité..."
- "Hmm, bonne question sur ce passage..."

Sois spécifique au contenu (cite le sujet du passage), jamais générique. Une seule phrase, courte. Pas de guillemets autour."#;

const OPUS_SYSTEM_PROMPT: &str = r#"Tu es un co-lecteur attentif. Tu as lu le document en entier et tu as suivi tous les commentaires de l'utilisateur pendant sa lecture. Il vient de poser une question.

Réponds de façon précise et concise :
- Cite les passages pertinents du document (entre guillemets, avec le numéro de paragraphe)
- Fais des liens entre différentes parties du texte si c'est pertinent
- Si des commentaires précédents de l'utilisateur sont liés à la question, mentionne-le
- Sois direct, pas de formules de politesse creuses
- 3-5 phrases maximum"#;

/// Handle a question: generate Haiku ack immediately, then Opus response in background.
/// This function spawns threads and returns immediately (non-blocking).
pub fn handle_question(
    app: AppHandle,
    question_id: String,
    question_text: String,
    paragraph_id: String,
    paragraph_text: String,
    document_text: String,
    all_comments: Vec<String>,
) {
    let app_ack = app.clone();
    let question_text_ack = question_text.clone();
    let paragraph_text_ack = paragraph_text.clone();
    let qid_ack = question_id.clone();

    // Thread 1: Haiku acknowledgment (fast, < 2s)
    std::thread::spawn(move || {
        match generate_acknowledgment(&question_text_ack, &paragraph_text_ack) {
            Ok(ack_text) => {
                info!("Ack generated: \"{}\"", ack_text);
                let _ = app_ack.emit("ack-response", AckPayload {
                    text: ack_text,
                    question_id: qid_ack,
                });
            }
            Err(e) => {
                error!("Ack generation failed: {}", e);
                // Fallback generic ack
                let _ = app_ack.emit("ack-response", AckPayload {
                    text: "Laisse-moi regarder ce passage...".to_string(),
                    question_id: qid_ack,
                });
            }
        }
    });

    // Thread 2: Opus response (slow, 5-15s, streamed)
    let app_opus = app.clone();
    let qid_opus = question_id.clone();
    std::thread::spawn(move || {
        match generate_opus_response(
            &app_opus,
            &qid_opus,
            &question_text,
            &paragraph_id,
            &paragraph_text,
            &document_text,
            &all_comments,
        ) {
            Ok(_) => info!("Opus response complete for question {}", qid_opus),
            Err(e) => {
                error!("Opus response failed: {}", e);
                let _ = app_opus.emit("opus-response", OpusResponsePayload {
                    text: format!("Désolé, je n'ai pas pu analyser ce passage. ({})", e),
                    question_id: qid_opus,
                    is_final: true,
                });
            }
        }
    });
}

fn generate_acknowledgment(question: &str, paragraph_text: &str) -> Result<String, String> {
    let user_prompt = format!(
        "Passage du document : \"{}\"\n\nQuestion de l'utilisateur : \"{}\"",
        paragraph_text, question
    );

    let start = std::time::Instant::now();

    let output = Command::new("claude")
        .args(["-p", "--model", "haiku", "--output-format", "text"])
        .env("CLAUDE_SYSTEM_PROMPT", ACK_SYSTEM_PROMPT)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            if let Some(ref mut stdin) = child.stdin {
                stdin.write_all(user_prompt.as_bytes())?;
            }
            child.wait_with_output()
        })
        .map_err(|e| format!("Failed to run claude CLI for ack: {}", e))?;

    let elapsed = start.elapsed();
    info!("Haiku ack took {:.1}s", elapsed.as_secs_f32());

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Haiku ack failed: {}", stderr));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn generate_opus_response(
    app: &AppHandle,
    question_id: &str,
    question: &str,
    paragraph_id: &str,
    paragraph_text: &str,
    document_text: &str,
    comments: &[String],
) -> Result<(), String> {
    let comments_section = if comments.is_empty() {
        "Aucun commentaire précédent.".to_string()
    } else {
        comments.iter()
            .enumerate()
            .map(|(i, c)| format!("  {}. {}", i + 1, c))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let user_prompt = format!(
        "Document complet :\n{}\n\n---\n\nCommentaires de l'utilisateur pendant la lecture :\n{}\n\n---\n\nParagraphe actif ({}) : \"{}\"\n\nQuestion : \"{}\"",
        document_text, comments_section, paragraph_id, paragraph_text, question
    );

    let start = std::time::Instant::now();

    let mut child = Command::new("claude")
        .args(["-p", "--model", "opus", "--output-format", "stream-json"])
        .env("CLAUDE_SYSTEM_PROMPT", OPUS_SYSTEM_PROMPT)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn Opus: {}", e))?;

    // Write prompt to stdin and close
    if let Some(ref mut stdin) = child.stdin.take() {
        stdin.write_all(user_prompt.as_bytes())
            .map_err(|e| format!("Failed to write to Opus stdin: {}", e))?;
    }

    // Stream stdout line by line
    let stdout = child.stdout.take()
        .ok_or("Failed to capture Opus stdout")?;
    let reader = BufReader::new(stdout);

    let mut full_text = String::new();

    for line in reader.lines() {
        let line = line.map_err(|e| format!("Failed to read Opus output: {}", e))?;
        let line = line.trim().to_string();
        if line.is_empty() {
            continue;
        }

        // stream-json format: each line is a JSON object
        // We look for content_block_delta events with text
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&line) {
            // Handle different stream-json event types
            if let Some(result) = json.get("result").and_then(|r| r.as_str()) {
                // Final result line
                full_text = result.to_string();
                break;
            }
            // Some formats emit content directly
            if let Some(content) = json.get("content").and_then(|c| c.as_str()) {
                full_text.push_str(content);
                let _ = app.emit("opus-response", OpusResponsePayload {
                    text: full_text.clone(),
                    question_id: question_id.to_string(),
                    is_final: false,
                });
            }
        } else {
            // Plain text line — accumulate
            if !line.starts_with('{') {
                full_text.push_str(&line);
                full_text.push('\n');
            }
        }
    }

    let status = child.wait().map_err(|e| format!("Opus process error: {}", e))?;
    let elapsed = start.elapsed();
    info!("Opus response took {:.1}s", elapsed.as_secs_f32());

    if !status.success() {
        let stderr_output = child.stderr.map(|mut s| {
            let mut buf = String::new();
            std::io::Read::read_to_string(&mut s, &mut buf).ok();
            buf
        }).unwrap_or_default();
        return Err(format!("Opus failed: {}", stderr_output));
    }

    // Emit final response
    let _ = app.emit("opus-response", OpusResponsePayload {
        text: full_text.trim().to_string(),
        question_id: question_id.to_string(),
        is_final: true,
    });

    Ok(())
}
