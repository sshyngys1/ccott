use std::{
    collections::HashSet,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread::JoinHandle,
    time::Duration,
};

/// Lifecycle lock serializes subscribe/disable/Exit. Workers never acquire it, including while joining.
#[derive(Default)]
pub struct Watch {
    enabled: bool,
    closed: bool,
    subscribers: HashSet<String>,
    worker: Option<Worker>,
}
struct Worker {
    stop: Arc<AtomicBool>,
    wake: mpsc::Sender<()>,
    thread: JoinHandle<()>,
}
pub type SharedWatch = Mutex<Watch>;

impl Watch {
    pub fn enabled(&self) -> bool {
        self.enabled && !self.closed
    }
    pub fn subscribe(&mut self, token: String, active: bool) {
        if active && !self.closed {
            self.subscribers.insert(token);
        } else {
            self.subscribers.remove(&token);
        }
    }
    pub fn set_enabled(&mut self, enabled: bool) {
        self.enabled = enabled;
    }
    pub fn clear_subscribers(&mut self) {
        self.subscribers.clear();
        self.stop();
    }
    pub fn close(&mut self) {
        self.closed = true;
        self.subscribers.clear();
        self.stop();
    }
    pub fn reconcile(
        &mut self,
        run: impl FnOnce(Arc<AtomicBool>, mpsc::Receiver<()>) + Send + 'static,
    ) -> std::io::Result<()> {
        if self
            .worker
            .as_ref()
            .is_some_and(|worker| worker.thread.is_finished())
        {
            self.stop();
        }
        if !self.enabled() || self.subscribers.is_empty() {
            self.stop();
        } else if self.worker.is_none() {
            let stop = Arc::new(AtomicBool::new(false));
            let flag = stop.clone();
            let (wake, rx) = mpsc::channel();
            let thread = std::thread::Builder::new()
                .name("control-watch".into())
                .spawn(move || run(flag, rx))?;
            self.worker = Some(Worker { stop, wake, thread });
        }
        Ok(())
    }
    fn stop(&mut self) {
        if let Some(worker) = self.worker.take() {
            worker.stop.store(true, Ordering::Release);
            let _ = worker.wake.send(());
            if worker.thread.join().is_err() {
                log::error!("control: watcher terminated unexpectedly");
            }
        }
    }
}
impl Drop for Watch {
    fn drop(&mut self) {
        self.stop();
    }
}
pub const INTERVAL: Duration = Duration::from_secs(5);

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;
    fn reconcile(watch: &mut Watch, live: &Arc<AtomicUsize>, starts: &Arc<AtomicUsize>) {
        let (live, starts) = (live.clone(), starts.clone());
        watch
            .reconcile(move |stop, rx| {
                live.fetch_add(1, Ordering::SeqCst);
                starts.fetch_add(1, Ordering::SeqCst);
                while !stop.load(Ordering::Acquire) {
                    let _ = rx.recv_timeout(INTERVAL);
                }
                live.fetch_sub(1, Ordering::SeqCst);
            })
            .unwrap();
    }
    #[test]
    fn only_subscribed_enabled_watch_runs_and_stop_joins() {
        let (live, starts) = (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));
        let mut watch = Watch::default();
        watch.set_enabled(true);
        reconcile(&mut watch, &live, &starts);
        assert!(watch.worker.is_none());
        for _ in 0..4 {
            watch.subscribe("ui".into(), true);
            reconcile(&mut watch, &live, &starts);
            assert!(watch.worker.is_some());
            watch.set_enabled(false);
            reconcile(&mut watch, &live, &starts);
            assert_eq!(live.load(Ordering::SeqCst), 0);
            assert!(watch.worker.is_none());
            watch.set_enabled(true);
        }
        assert_eq!(starts.load(Ordering::SeqCst), 4);
        reconcile(&mut watch, &live, &starts);
        watch.subscribe("ui".into(), false);
        reconcile(&mut watch, &live, &starts);
        assert_eq!(live.load(Ordering::SeqCst), 0);
        watch.subscribe("ui".into(), true);
        reconcile(&mut watch, &live, &starts);
        watch.close();
        assert_eq!(live.load(Ordering::SeqCst), 0);
        reconcile(&mut watch, &live, &starts);
        assert!(watch.worker.is_none());
    }
    #[test]
    fn two_subscribers_share_one_worker_and_navigation_releases_it() {
        let (live, starts) = (Arc::new(AtomicUsize::new(0)), Arc::new(AtomicUsize::new(0)));
        let mut watch = Watch::default();
        watch.subscribe("one".into(), true);
        reconcile(&mut watch, &live, &starts);
        assert!(watch.worker.is_none());
        watch.set_enabled(true);
        reconcile(&mut watch, &live, &starts);
        watch.subscribe("two".into(), true);
        reconcile(&mut watch, &live, &starts);
        watch.subscribe("one".into(), false);
        reconcile(&mut watch, &live, &starts);
        assert!(watch.worker.is_some());
        watch.clear_subscribers();
        assert_eq!(live.load(Ordering::SeqCst), 0);
        assert_eq!(starts.load(Ordering::SeqCst), 1);
        reconcile(&mut watch, &live, &starts);
        assert!(watch.worker.is_none());
        watch.subscribe("reloaded".into(), true);
        reconcile(&mut watch, &live, &starts);
        drop(watch);
        assert_eq!(live.load(Ordering::SeqCst), 0);
        assert_eq!(starts.load(Ordering::SeqCst), 2);
    }
}
