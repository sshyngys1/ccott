//! Command FIFO and revision gate. No WinRT objects or slow reads live in these queues.

use std::sync::{Arc, Mutex, mpsc};
use std::time::{Duration, Instant};

use super::MediaAction;
use super::state::MediaState;

pub const REPLY_TIMEOUT: Duration = Duration::from_secs(5);
pub const COMMAND_CAPACITY: usize = 32;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Revision {
    pub session: u64,
    pub metadata: u64,
    pub state: u64,
}

#[derive(Default)]
struct Snapshot {
    revision: Revision,
    published: Option<(Revision, MediaState)>,
}

#[derive(Clone, Default)]
pub struct Delivery(Arc<Mutex<Snapshot>>);

impl Delivery {
    pub fn revision(&self) -> Revision {
        self.0.lock().unwrap().revision
    }

    pub fn invalidate(&self, session_changed: bool) {
        let mut snapshot = self.0.lock().unwrap();
        snapshot.revision.metadata += 1;
        snapshot.revision.state += 1;
        if session_changed {
            snapshot.revision.session += 1;
        }
    }

    pub fn is_current(&self, revision: Revision) -> bool {
        self.revision() == revision
    }

    pub fn invalidate_playback(&self) {
        self.0.lock().unwrap().revision.state += 1;
    }

    /// Playback ticks must not starve a slow metadata read. After it completes, sample the
    /// latest playback/timeline, but never carry old properties into a new track/session.
    pub fn after_metadata(&self, revision: Revision) -> Option<Revision> {
        let current = self.revision();
        (current.session == revision.session && current.metadata == revision.metadata)
            .then_some(current)
    }

    pub fn cached(&self, now: i64) -> MediaState {
        let snapshot = self.0.lock().unwrap();
        snapshot
            .published
            .as_ref()
            .filter(|(revision, _)| revision.session == snapshot.revision.session)
            .map_or_else(|| MediaState::none(now), |(_, state)| state.clone())
    }

    /// Linearize validation, cache replacement and emission against event invalidation.
    pub fn publish(
        &self,
        revision: Revision,
        state: MediaState,
        emit: impl FnOnce(&MediaState),
    ) -> bool {
        let mut snapshot = self.0.lock().unwrap();
        if snapshot.revision != revision {
            return false;
        }
        let changed = snapshot
            .published
            .as_ref()
            .is_none_or(|(_, old)| super::state::state_changed(old, &state));
        if changed {
            emit(&state);
        }
        snapshot.published = Some((revision, state));
        true
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    Action(MediaAction),
    Seek(i64),
}

pub struct PendingCommand {
    pub command: Command,
    pub session: u64,
    pub deadline: Instant,
    pub reply: mpsc::Sender<Result<(), String>>,
}

pub fn command_loop(
    rx: mpsc::Receiver<PendingCommand>,
    delivery: &Delivery,
    mut execute: impl FnMut(Command, u64, Instant) -> Result<bool, String>,
    mut refresh: impl FnMut(),
) {
    for pending in rx {
        let result = if Instant::now() >= pending.deadline {
            Err("media command expired in queue".into())
        } else if delivery.revision().session != pending.session {
            Err("media session changed before command delivery".into())
        } else {
            execute(pending.command, pending.session, pending.deadline).and_then(|accepted| {
                if delivery.revision().session != pending.session {
                    Err("media session changed during command delivery".into())
                } else if accepted {
                    Ok(())
                } else {
                    Err("the media app rejected the command".into())
                }
            })
        };
        // A successful SMTC request is not proof that a track changed. Re-read the provider.
        refresh();
        let _ = pending.reply.send(result);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    fn pending(
        delivery: &Delivery,
        command: Command,
    ) -> (PendingCommand, mpsc::Receiver<Result<(), String>>) {
        let (reply, rx) = mpsc::channel();
        (
            PendingCommand {
                command,
                session: delivery.revision().session,
                deadline: Instant::now() + REPLY_TIMEOUT,
                reply,
            },
            rx,
        )
    }

    #[test]
    fn commands_bypass_blocked_metadata_and_artwork_in_fifo_order() {
        for operation in ["metadata", "thumbnail/decode"] {
            let delivery = Delivery::default();
            let (read_started, started) = mpsc::channel();
            let (release, hold_read) = mpsc::channel();
            let reader = thread::spawn(move || {
                read_started.send(()).unwrap();
                hold_read.recv().unwrap(); // Deliberately incomplete until ALL commands finish.
            });
            started.recv().unwrap();
            let (tx, rx) = mpsc::sync_channel(COMMAND_CAPACITY);
            let mut replies = Vec::new();
            let expected = [
                Command::Action(MediaAction::Next),
                Command::Action(MediaAction::Next),
                Command::Action(MediaAction::Previous),
                Command::Seek(1200),
            ];
            for command in expected {
                let (request, reply) = pending(&delivery, command);
                tx.send(request).unwrap();
                replies.push(reply);
            }
            drop(tx);
            let worker = thread::spawn(move || {
                let mut delivered = Vec::new();
                command_loop(
                    rx,
                    &delivery,
                    |command, _, _| {
                        delivered.push(command);
                        Ok(true)
                    },
                    || {},
                );
                delivered
            });
            // Neither queueing nor replying requires releasing the slow reader.
            for reply in replies {
                assert_eq!(
                    reply.recv_timeout(Duration::from_secs(2)).unwrap(),
                    Ok(()),
                    "{operation}"
                );
            }
            assert_eq!(worker.join().unwrap(), expected);
            release.send(()).unwrap();
            reader.join().unwrap();
        }
    }

    #[test]
    fn rejects_changed_session_expired_queue_and_smtc_failures() {
        let delivery = Delivery::default();
        let (tx, rx) = mpsc::channel();
        let (stale, stale_reply) = pending(&delivery, Command::Action(MediaAction::Next));
        delivery.invalidate(true);
        let (mut expired, expired_reply) = pending(&delivery, Command::Seek(0));
        expired.deadline = Instant::now();
        let (rejected, rejected_reply) = pending(&delivery, Command::Action(MediaAction::Previous));
        let (error, error_reply) = pending(&delivery, Command::Action(MediaAction::PlayPause));
        for command in [stale, expired, rejected, error] {
            tx.send(command).unwrap();
        }
        drop(tx);
        let mut calls = Vec::new();
        command_loop(
            rx,
            &delivery,
            |command, _, _| {
                calls.push(command);
                if command == Command::Action(MediaAction::Previous) {
                    Ok(false)
                } else {
                    Err("SMTC HRESULT failure".into())
                }
            },
            || {},
        );
        assert!(
            stale_reply
                .recv()
                .unwrap()
                .unwrap_err()
                .contains("session changed")
        );
        assert!(
            expired_reply
                .recv()
                .unwrap()
                .unwrap_err()
                .contains("expired")
        );
        assert!(
            rejected_reply
                .recv()
                .unwrap()
                .unwrap_err()
                .contains("rejected")
        );
        assert_eq!(
            error_reply.recv().unwrap(),
            Err("SMTC HRESULT failure".into())
        );
        assert_eq!(calls.len(), 2);
    }

    #[test]
    fn session_change_during_command_is_an_error_and_does_not_reorder_next_command() {
        let delivery = Delivery::default();
        let (tx, rx) = mpsc::channel();
        let (first, first_reply) = pending(&delivery, Command::Action(MediaAction::Next));
        let (second, second_reply) = pending(&delivery, Command::Action(MediaAction::Previous));
        tx.send(first).unwrap();
        tx.send(second).unwrap();
        drop(tx);
        let mut calls = 0;
        command_loop(
            rx,
            &delivery,
            |_, _, _| {
                calls += 1;
                delivery.invalidate(true);
                Ok(true)
            },
            || {},
        );
        assert!(first_reply.recv().unwrap().unwrap_err().contains("during"));
        assert!(second_reply.recv().unwrap().unwrap_err().contains("before"));
        assert_eq!(calls, 1);
    }

    #[test]
    fn stale_metadata_artwork_and_old_session_cannot_publish() {
        let delivery = Delivery::default();
        let initial = delivery.revision();
        let mut state = MediaState::none(1);
        state.has_session = true;
        state.title = "old".into();
        assert!(delivery.publish(initial, state.clone(), |_| {}));
        delivery.invalidate(false);
        let current = delivery.revision();
        state.title = "new".into();
        assert!(!delivery.publish(initial, state.clone(), |_| panic!("stale metadata")));
        assert!(delivery.publish(current, state.clone(), |s| assert!(s.artwork.is_none())));
        state.artwork = Some("old artwork".into());
        assert!(!delivery.publish(initial, state, |_| panic!("stale artwork")));
        delivery.invalidate(true);
        assert!(!delivery.cached(2).has_session);
        assert!(!delivery.publish(current, MediaState::none(2), |_| panic!("old session")));
    }

    #[test]
    fn playback_does_not_starve_metadata_but_invalidates_old_artwork_state() {
        let delivery = Delivery::default();
        let reading = delivery.revision();
        delivery.invalidate_playback();
        delivery.invalidate_playback();
        let sampled = delivery.after_metadata(reading).unwrap();
        assert_ne!(sampled, reading);
        assert!(!delivery.publish(reading, MediaState::none(1), |_| panic!("old playback")));
        assert!(delivery.publish(sampled, MediaState::none(2), |_| {}));
        delivery.invalidate(false);
        assert!(delivery.after_metadata(reading).is_none());
        delivery.invalidate(true);
        assert!(delivery.after_metadata(sampled).is_none());
    }

    #[test]
    #[ignore = "manual synthetic latency measurement"]
    fn synthetic_latency_comparison() {
        // Wall-clock measurements of an injected delay, NOT Chrome/SMTC or audible skip latency.
        for operation in ["metadata", "thumbnail"] {
            let mut before = Vec::new();
            let mut after = Vec::new();
            for _ in 0..5 {
                let delivery = Delivery::default();
                let (tx, rx) = mpsc::channel::<PendingCommand>();
                let (entered, ready) = mpsc::channel();
                let legacy_worker = thread::spawn(move || {
                    entered.send(()).unwrap();
                    // Model the former shared worker occupied by a slow read before dequeue.
                    thread::sleep(Duration::from_millis(100));
                    let request = rx.recv().unwrap();
                    request.reply.send(Ok(())).unwrap();
                });
                ready.recv().unwrap();
                let (request, reply) = pending(&delivery, Command::Action(MediaAction::Next));
                let start = Instant::now();
                tx.send(request).unwrap();
                reply.recv_timeout(Duration::from_secs(2)).unwrap().unwrap();
                before.push(start.elapsed().as_micros());
                legacy_worker.join().unwrap();
                let delivery = Delivery::default();
                let (tx, rx) = mpsc::channel();
                let (request, reply) = pending(&delivery, Command::Action(MediaAction::Next));
                let (entered, ready) = mpsc::channel();
                let (release, held) = mpsc::channel();
                let slow_reader = thread::spawn(move || {
                    entered.send(()).unwrap();
                    held.recv().unwrap();
                });
                ready.recv().unwrap();
                let worker =
                    thread::spawn(move || command_loop(rx, &delivery, |_, _, _| Ok(true), || {}));
                let start = Instant::now();
                tx.send(request).unwrap();
                reply.recv_timeout(Duration::from_secs(2)).unwrap().unwrap();
                after.push(start.elapsed().as_micros());
                drop(tx);
                worker.join().unwrap();
                release.send(()).unwrap();
                slow_reader.join().unwrap();
            }
            println!("synthetic {operation}: single_lane_us={before:?}; split_lane_us={after:?}");
        }
    }
}
