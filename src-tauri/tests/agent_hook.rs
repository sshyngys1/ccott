//! Exercise the real standalone helper. Does not launch Tauri or touch any tool config.
use std::{
    io::Write,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

fn hook() -> Command {
    let mut command = Command::new(env!("CCOTT_AGENT_HOOK"));
    command.args(["--agent-hook", "--ccott-agents-v1"]);
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    command
}

#[test]
fn absent_server_is_fast_success_and_silent() {
    let start = Instant::now();
    let output = hook().args(["codex", r#"{"type":"agent-turn-complete","thread-id":"ccott-sender-test","cwd":"C:/temporary/ccott-test"}"#]).output().unwrap();
    let elapsed = start.elapsed();
    assert!(output.status.success());
    assert!(output.stdout.is_empty() && output.stderr.is_empty());
    assert!(
        elapsed < Duration::from_millis(100),
        "hook took {elapsed:?}"
    );
}

#[test]
fn unclosed_stdin_is_bounded_and_silent() {
    let start = Instant::now();
    let mut child = hook()
        .args(["claude-code", "Stop"])
        .stdin(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    stdin.write_all(b"{").unwrap(); // deliberately keep the pipe open: watchdog must exit anyway
    let output = child.wait_with_output().unwrap();
    drop(stdin);
    assert!(output.status.success());
    assert!(output.stdout.is_empty() && output.stderr.is_empty());
    let elapsed = start.elapsed();
    assert!(
        elapsed < Duration::from_millis(100),
        "hook took {elapsed:?}"
    );
}
