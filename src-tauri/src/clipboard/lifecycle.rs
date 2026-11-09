//! Owns a running watcher only while its feature is enabled. Drop releases all worker resources.
pub struct Watcher<T>(Option<T>);

impl<T> Default for Watcher<T> {
    fn default() -> Self {
        Self(None)
    }
}

impl<T> Watcher<T> {
    pub fn shutdown(&mut self) {
        self.0 = None;
    }

    pub fn set_enabled<E>(
        &mut self,
        enabled: bool,
        start: impl FnOnce() -> Result<T, E>,
    ) -> Result<(), E> {
        if !enabled {
            self.shutdown();
        } else if self.0.is_none() {
            self.0 = Some(start()?);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    struct Worker(Arc<AtomicUsize>);
    impl Drop for Worker {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }

    #[test]
    fn saved_disabled_starts_nothing_and_toggle_releases_then_restarts() {
        let live = Arc::new(AtomicUsize::new(0));
        let mut watcher = Watcher(None);
        let start = || -> Result<Worker, ()> {
            live.fetch_add(1, Ordering::SeqCst);
            Ok(Worker(live.clone()))
        };
        for (enabled, expected) in [
            (false, 0),
            (true, 1),
            (true, 1),
            (false, 0),
            (false, 0),
            (true, 1),
        ] {
            watcher.set_enabled(enabled, start).unwrap();
            assert_eq!(live.load(Ordering::SeqCst), expected);
        }
        drop(watcher);
        assert_eq!(live.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn failed_start_can_be_retried() {
        let mut watcher = Watcher::<()>(None);
        assert!(watcher.set_enabled(true, || Err("start failed")).is_err());
        assert!(watcher.set_enabled(true, || Ok::<_, &str>(())).is_ok());
    }
}
