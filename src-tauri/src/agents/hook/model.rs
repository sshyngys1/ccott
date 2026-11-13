use serde::{Deserialize, Serialize};

pub const MAX_MESSAGE: usize = 8192;
pub const MARKER: &str = "--ccott-agents-v1";
pub const PIPE_NAME: &str = r"\\.\pipe\ccott-agents";
pub const MINUTE: i64 = 60_000;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Tool {
    ClaudeCode,
    Codex,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub tool: Tool,
    pub project: String,
    pub state: String,
    pub message: Option<String>,
    pub updated_at: i64,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub tool: Tool,
    pub event: String,
    pub session_id: String,
    pub cwd: String,
    pub message: Option<String>,
}

pub fn parse(line: &[u8], now: i64) -> Option<Session> {
    if line.len() > MAX_MESSAGE {
        return None;
    }
    let input: Message = serde_json::from_slice(line).ok()?;
    if input.session_id.trim().is_empty() || input.session_id.len() > 256 || input.cwd.len() > 4096
    {
        return None;
    }
    let state = match (&input.tool, input.event.as_str()) {
        (Tool::ClaudeCode, "UserPromptSubmit" | "PreToolUse") => "working",
        (Tool::ClaudeCode, "Notification") => "waiting",
        (Tool::ClaudeCode, "Stop") | (Tool::Codex, "agent-turn-complete") => "done",
        _ => return None,
    };
    let project = input
        .cwd
        .trim_end_matches(['/', '\\'])
        .rsplit(['/', '\\'])
        .next()?
        .chars()
        .filter(|c| !c.is_control())
        .take(120)
        .collect::<String>();
    if project.is_empty() || project.ends_with(':') {
        return None;
    }
    Some(Session {
        id: input.session_id,
        tool: input.tool,
        project,
        state: state.into(),
        message: if state == "waiting" {
            input
                .message
                .map(|m| m.chars().filter(|c| !c.is_control()).take(120).collect())
        } else {
            None
        },
        updated_at: now,
    })
}

#[derive(Default)]
pub struct Sessions(pub Vec<Session>);
impl Sessions {
    pub fn accept(&mut self, line: &[u8], now: i64) -> bool {
        let Some(session) = parse(line, now) else {
            return false;
        };
        self.0.retain(|s| s.id != session.id);
        // Bound memory even if a broken client keeps inventing session IDs.
        self.0.insert(0, session);
        self.0.truncate(256);
        true
    }
    pub fn prune(&mut self, now: i64) -> bool {
        let before = self.0.len();
        self.0.retain(|s| {
            now.saturating_sub(s.updated_at)
                < if s.state == "done" {
                    10 * MINUTE
                } else {
                    30 * MINUTE
                }
        });
        before != self.0.len()
    }
    pub fn dismiss(&mut self, id: &str) -> bool {
        let before = self.0.len();
        self.0.retain(|s| s.id != id);
        before != self.0.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn line(event: &str) -> Vec<u8> {
        serde_json::to_vec(&serde_json::json!({"tool":"claude-code","event":event,"sessionId":"one","cwd":"C:\\work\\project\\","message":"a".repeat(150)})).unwrap()
    }
    #[test]
    fn transitions_and_privacy() {
        let mut sessions = Sessions::default();
        for (event, state) in [
            ("UserPromptSubmit", "working"),
            ("PreToolUse", "working"),
            ("Notification", "waiting"),
            ("Stop", "done"),
        ] {
            assert!(sessions.accept(&line(event), 42));
            let s = &sessions.0[0];
            assert_eq!((&*s.project, &*s.state), ("project", state));
            assert_eq!(
                s.message.as_ref().map(String::len),
                if state == "waiting" { Some(120) } else { None }
            );
        }
        assert_eq!(sessions.0.len(), 1);
        assert!(sessions.accept(br#"{"tool":"codex","event":"agent-turn-complete","sessionId":"two","cwd":"/work/demo"}"#, 43));
        assert_eq!(sessions.0[0].state, "done");
        assert!(sessions.dismiss("two"));
    }
    #[test]
    fn invalid_and_size() {
        for line in [
            b"invalid".as_slice(),
            &vec![b' '; MAX_MESSAGE + 1],
            &line("unknown"),
        ] {
            assert!(parse(line, 0).is_none());
        }
        assert!(
            parse(
                br#"{"tool":"codex","event":"Stop","sessionId":"x","cwd":"x"}"#,
                0
            )
            .is_none()
        );
    }
    #[test]
    fn injected_retention_boundaries() {
        let mut s = Sessions::default();
        s.accept(&line("Notification"), 100);
        assert!(!s.prune(100 + 30 * MINUTE - 1));
        assert!(s.prune(100 + 30 * MINUTE));
        s.accept(&line("Stop"), 200);
        assert!(!s.prune(200 + 10 * MINUTE - 1));
        assert!(s.prune(200 + 10 * MINUTE));
    }
}
