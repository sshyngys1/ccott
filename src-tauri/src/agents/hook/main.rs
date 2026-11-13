#![windows_subsystem = "windows"]

// Share the protocol; the tracker is unused in this binary. No server or GUI code is linked.
#[allow(dead_code)]
mod model;
mod pipe_sender;
mod sender;

fn main() {
    sender::agent_hook_mode();
}
