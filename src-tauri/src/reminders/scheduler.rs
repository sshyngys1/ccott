use super::{Reminder, list};
use crate::{
    db::{Db, now_ms},
    system::worker::{WorkerApp, with_app},
};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex, mpsc},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter, Listener, Manager};

// Overdue reminders are delivered individually, at most one per 10 seconds. A dueAt is
// remembered for this process only, so unfinished reminders are offered again on next launch.
const GAP_MS: f64 = 10_000.0;
#[derive(Default)]
struct Schedule {
    delivered: HashMap<String, f64>,
    upcoming: HashMap<String, f64>,
    next_delivery: f64,
}
impl Schedule {
    fn next(&mut self, items: &[Reminder], now: f64) -> Option<(Reminder, f64)> {
        self.delivered.retain(|id, due| {
            items
                .iter()
                .any(|r| &r.id == id && r.due_at == *due && !r.done)
        });
        self.upcoming.retain(|id, due| {
            items
                .iter()
                .any(|r| &r.id == id && r.due_at == *due && !r.done)
        });
        for item in items.iter().filter(|r| !r.done && r.due_at > now) {
            self.upcoming.insert(item.id.clone(), item.due_at);
        }
        items
            .iter()
            .filter(|r| !r.done && self.delivered.get(&r.id) != Some(&r.due_at))
            .map(|r| {
                // Only backlog is paced. A deadline armed while still in the future
                // fires on time, even while startup reminders are being drained.
                let deadline = if self.upcoming.get(&r.id) == Some(&r.due_at) {
                    r.due_at
                } else {
                    r.due_at.max(self.next_delivery)
                };
                (r.clone(), deadline.max(now))
            })
            .min_by(|(a, at), (b, bt)| {
                at.total_cmp(bt)
                    .then(a.due_at.total_cmp(&b.due_at))
                    .then(a.id.cmp(&b.id))
            })
    }
    fn sent(&mut self, item: &Reminder, now: f64) {
        self.delivered.insert(item.id.clone(), item.due_at);
        self.next_delivery = now + GAP_MS;
    }
}

enum Signal {
    Refresh,
    Stop,
}
struct Worker {
    tx: mpsc::Sender<Signal>,
    join: thread::JoinHandle<()>,
}
impl Worker {
    fn stop(self) {
        let _ = self.tx.send(Signal::Stop);
        let _ = self.join.join();
    }
}
struct Service {
    enabled: bool,
    closed: bool,
    subscribers: HashSet<String>,
    worker: Option<Worker>,
    schedule: Arc<Mutex<Schedule>>,
    db: Db,
    app: WorkerApp,
}
impl Service {
    fn reconcile(&mut self) -> std::io::Result<()> {
        if self.closed || !self.enabled || self.subscribers.is_empty() {
            if let Some(worker) = self.worker.take() {
                worker.stop();
            }
            // Reclassify deadlines missed while disabled/unsubscribed as backlog.
            self.schedule
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .upcoming
                .clear();
        } else if self.worker.is_none() {
            let (tx, rx) = mpsc::channel();
            let db = self.db.clone();
            let app = self.app.clone();
            let schedule = self.schedule.clone();
            let join = thread::Builder::new()
                .name("reminders-deadline".into())
                .spawn(move || {
                    loop {
                        // Read only on a mutation, subscription/settings change or deadline. No polling.
                        let items = match list(&db.lock()) {
                            Ok(items) => items,
                            Err(error) => {
                                log::error!("reminders: storage read failed: {error}");
                                break;
                            }
                        };
                        let now = now_ms() as f64;
                        let next = schedule
                            .lock()
                            .unwrap_or_else(|e| e.into_inner())
                            .next(&items, now);
                        let signal = match &next {
                            Some((_, deadline)) => rx.recv_timeout(Duration::from_secs_f64(
                                ((*deadline - now) / 1000.0).clamp(0.0, 1e12),
                            )),
                            None => match rx.recv() {
                                Ok(s) => Ok(s),
                                Err(_) => break,
                            },
                        };
                        match signal {
                            Ok(Signal::Stop) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
                            Ok(Signal::Refresh) => continue,
                            Err(mpsc::RecvTimeoutError::Timeout) => {
                                // Re-read at the deadline: an edit/delete may have raced the timeout.
                                // Serialize the last read and emit with CRUD: a committed
                                // delete/done edit cannot be followed by an obsolete due event.
                                let connection = db.lock();
                                let fresh = match list(&connection) {
                                    Ok(v) => v,
                                    Err(_) => break,
                                };
                                let now = now_ms() as f64;
                                let mut plan = schedule.lock().unwrap_or_else(|e| e.into_inner());
                                if let Some((item, deadline)) = plan.next(&fresh, now)
                                    && deadline <= now
                                {
                                    // Drain cancellation before delivery; disable/exit joins this worker.
                                    let mut stop = false;
                                    while let Ok(signal) = rx.try_recv() {
                                        if matches!(signal, Signal::Stop) {
                                            stop = true;
                                        }
                                    }
                                    if stop {
                                        break;
                                    }
                                    let sent = with_app(&app, |app| {
                                        app.emit("reminders://due", &item).is_ok()
                                    })
                                    .unwrap_or(false);
                                    if !sent {
                                        break;
                                    }
                                    plan.sent(&item, now);
                                }
                            }
                        }
                    }
                })?;
            self.worker = Some(Worker { tx, join });
        }
        Ok(())
    }
}
pub struct Handle(Mutex<Service>);
impl Drop for Handle {
    fn drop(&mut self) {
        let service = self.0.get_mut().unwrap_or_else(|e| e.into_inner());
        if let Some(worker) = service.worker.take() {
            worker.stop();
        }
    }
}

#[derive(serde::Deserialize)]
struct Subscription {
    token: String,
    active: bool,
}

pub fn setup(
    app: &mut tauri::App,
    worker_app: WorkerApp,
) -> Result<(), Box<dyn std::error::Error>> {
    app.manage(Handle(Mutex::new(Service {
        enabled: !crate::settings::current(app.handle())
            .disabled_features
            .iter()
            .any(|f| f == "notes"),
        closed: false,
        subscribers: HashSet::new(),
        worker: None,
        schedule: Arc::default(),
        db: app.state::<Db>().inner().clone(),
        app: worker_app.clone(),
    })));
    // Start only after the due listener is installed, so startup events cannot be lost.
    let weak = worker_app.clone();
    app.listen("reminders://subscription", move |event| {
        if let Ok(s) = serde_json::from_str::<Subscription>(event.payload())
            && !s.token.is_empty()
            && s.token.len() <= 80
        {
            with_app(&weak, |app| {
                if let Some(handle) = app.try_state::<Handle>() {
                    let mut service = handle.0.lock().unwrap_or_else(|e| e.into_inner());
                    if s.active {
                        service.subscribers.insert(s.token);
                    } else {
                        service.subscribers.remove(&s.token);
                    }
                    if let Err(e) = service.reconcile() {
                        log::error!("reminders: {e}");
                    }
                }
            });
        }
    });
    app.listen("settings://changed", move |_| {
        with_app(&worker_app, |app| {
            if let Some(handle) = app.try_state::<Handle>() {
                let mut service = handle.0.lock().unwrap_or_else(|e| e.into_inner());
                service.enabled = !crate::settings::current(app)
                    .disabled_features
                    .iter()
                    .any(|f| f == "notes");
                if let Err(e) = service.reconcile() {
                    log::error!("reminders: {e}");
                }
            }
        });
    });
    Ok(())
}
pub fn refresh(app: &AppHandle) {
    if let Some(handle) = app.try_state::<Handle>() {
        let service = handle.0.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(worker) = &service.worker {
            let _ = worker.tx.send(Signal::Refresh);
        }
    }
}
pub fn shutdown(app: &AppHandle) {
    if let Some(handle) = app.try_state::<Handle>() {
        let mut service = handle.0.lock().unwrap_or_else(|e| e.into_inner());
        service.closed = true;
        let _ = service.reconcile();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn item(id: &str, due: f64) -> Reminder {
        Reminder {
            id: id.into(),
            text: id.into(),
            due_at: due,
            created_at: 0,
            done: false,
        }
    }
    #[test]
    fn injected_clock_nearest_deadline_reschedule_delete_and_done() {
        let mut s = Schedule::default();
        assert!(s.next(&[], 100.0).is_none());
        let a = item("a", 300.0);
        let b = item("b", 200.0);
        assert_eq!(s.next(&[a.clone(), b.clone()], 100.0).unwrap(), (b, 200.0));
        let mut earlier = a.clone();
        earlier.due_at = 150.0;
        assert_eq!(s.next(&[earlier.clone()], 100.0).unwrap().1, 150.0);
        earlier.done = true;
        assert!(s.next(&[earlier], 100.0).is_none());
    }
    #[test]
    fn missed_on_start_once_each_paced_and_snooze_rearms() {
        let mut s = Schedule::default();
        let a = item("a", 10.0);
        let b = item("b", 20.0);
        let items = [a.clone(), b.clone()];
        assert_eq!(s.next(&items, 100.0).unwrap(), (a.clone(), 100.0));
        s.sent(&a, 100.0);
        assert_eq!(s.next(&items, 100.0).unwrap(), (b.clone(), 10100.0));
        s.sent(&b, 10100.0);
        assert!(s.next(&items, 10200.0).is_none());
        let mut snoozed = a;
        snoozed.due_at = 700000.0;
        assert_eq!(s.next(&[snoozed], 20000.0).unwrap().1, 700000.0);
        assert!(Schedule::default().next(&items, 50000.0).is_some());
    }
    #[test]
    fn future_deadline_preempts_paced_backlog_without_delay() {
        let mut s = Schedule::default();
        let old = item("old", 1.0);
        let older = item("older", 2.0);
        let soon = item("soon", 5000.0);
        let items = [old.clone(), older.clone(), soon.clone()];
        assert_eq!(s.next(&items, 100.0).unwrap(), (old.clone(), 100.0));
        s.sent(&old, 100.0);
        assert_eq!(s.next(&items, 100.0).unwrap(), (soon.clone(), 5000.0));
        assert_eq!(s.next(&items, 5000.0).unwrap(), (soon.clone(), 5000.0));
        s.sent(&soon, 5000.0);
        assert_eq!(s.next(&items, 5000.0).unwrap(), (older, 15000.0));
        s.upcoming.clear();
        assert_eq!(
            s.next(&[item("missed-while-disabled", 6000.0)], 7000.0)
                .unwrap()
                .1,
            15000.0
        );
    }
    #[test]
    fn disabled_notes_cancels_and_joins_without_waiting_for_deadline() {
        let db = Db::new(crate::db::open_in_memory());
        let mut service = Service {
            enabled: true,
            closed: false,
            subscribers: HashSet::from(["ui".into()]),
            worker: None,
            schedule: Arc::default(),
            db,
            app: WorkerApp::new(),
        };
        service.reconcile().unwrap();
        assert!(service.worker.is_some());
        service.enabled = false;
        service.reconcile().unwrap();
        assert!(service.worker.is_none());
        super::super::add(&service.db.lock(), "missed".into(), 0.0, 0).unwrap();
        service.enabled = true;
        service.reconcile().unwrap();
        assert!(service.worker.is_some());
        service.closed = true;
        service.reconcile().unwrap();
        assert!(service.worker.is_none());
    }
}
