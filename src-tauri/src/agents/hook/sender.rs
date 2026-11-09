use super::{
    model::{MARKER, MAX_MESSAGE, Message, PIPE_NAME, Tool},
    pipe_sender,
};
use std::{io::Read, time::Duration};

// Native payloads can contain large tool inputs. Only the reduced pipe message is limited to 8 KiB.
const MAX_INPUT: usize = 1024 * 1024;

/// Runs in the small standalone helper, which has no Tauri or GUI dependencies.
/// Never prints; the watchdog also bounds an unclosed stdin or a stalled pipe writer.
#[cfg_attr(test, allow(dead_code))]
pub fn agent_hook_mode() -> bool {
    let args: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect();
    if args.first().map(String::as_str) != Some("--agent-hook") {
        return false;
    }
    let watchdog = std::thread::Builder::new()
        .name("hook-deadline".into())
        .spawn(|| {
            std::thread::sleep(Duration::from_millis(25));
            std::process::exit(0);
        });
    if watchdog.is_err() {
        std::process::exit(0);
    }
    if args.get(1).map(String::as_str) != Some(MARKER) {
        return true;
    }
    let raw = if args.get(2).map(String::as_str) == Some("codex") {
        args.last().filter(|s| s.len() <= MAX_INPUT).cloned()
    } else {
        let mut raw = String::new();
        std::io::stdin()
            .take((MAX_INPUT + 1) as u64)
            .read_to_string(&mut raw)
            .ok()
            .filter(|_| raw.len() <= MAX_INPUT)
            .map(|_| raw)
    };
    if let Some(raw) = raw
        && let Some(line) = normalize(&args, &raw)
    {
        pipe_sender::send(PIPE_NAME, &line);
    }
    true
}

fn normalize(args: &[String], raw: &str) -> Option<Vec<u8>> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let codex = args.get(2)?.as_str() == "codex";
    let event = if codex {
        value.get("type")?.as_str()?
    } else {
        value
            .get("hook_event_name")
            .and_then(|v| v.as_str())
            .or_else(|| args.get(3).map(String::as_str))?
    };
    let message = Message {
        tool: if codex { Tool::Codex } else { Tool::ClaudeCode },
        event: event.into(),
        session_id: value
            .get(if codex { "thread-id" } else { "session_id" })?
            .as_str()?
            .into(),
        cwd: value.get("cwd")?.as_str()?.into(),
        // Never forward prompts, tool inputs, or last-assistant-message.
        message: if !codex && event == "Notification" {
            value
                .get("message")
                .and_then(|v| v.as_str())
                .map(|s| s.chars().take(120).collect())
        } else {
            None
        },
    };
    let mut bytes = serde_json::to_vec(&message).ok()?;
    super::model::parse(&bytes, 0)?;
    if bytes.len() > MAX_MESSAGE {
        return None;
    }
    bytes.push(b'\n');
    Some(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_payloads_are_reduced_to_protocol() {
        let args = vec!["--agent-hook".into(), MARKER.into(), "codex".into()];
        let line = normalize(&args, r#"{"type":"agent-turn-complete","thread-id":"abc","cwd":"C:/work/app","last-assistant-message":"SECRET","input-messages":["SECRET"]}"#).unwrap();
        assert!(!String::from_utf8_lossy(&line).contains("SECRET"));
        assert_eq!(super::super::model::parse(&line, 0).unwrap().state, "done");
        let args = vec![
            "--agent-hook".into(),
            MARKER.into(),
            "claude-code".into(),
            "Stop".into(),
        ];
        assert!(normalize(&args, r#"{"session_id":"abc","cwd":"C:/work/app"}"#).is_some());
    }

    #[test]
    fn large_native_payload_still_reports_completion() {
        let args = vec!["--agent-hook".into(), MARKER.into(), "codex".into()];
        let raw = serde_json::json!({"type":"agent-turn-complete", "thread-id":"one", "cwd":"C:/work/app", "last-assistant-message":"private".repeat(4000)}).to_string();
        assert!(raw.len() > MAX_MESSAGE);
        let line = normalize(&args, &raw).unwrap();
        assert!(line.len() < MAX_MESSAGE);
        assert!(!String::from_utf8_lossy(&line).contains("private"));
    }
}
