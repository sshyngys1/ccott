//! Workers borrow the application only briefly through an anchor owned by run(), not by managed state.
use std::sync::{Condvar, Mutex, OnceLock, Weak};
use std::time::Duration;
use tauri::AppHandle;

pub type WorkerApp = Weak<OnceLock<AppHandle>>;

pub fn with_app<T>(app: &WorkerApp, action: impl FnOnce(&AppHandle) -> T) -> Option<T> {
    let anchor = app.upgrade()?;
    anchor.get().map(action)
}

#[derive(Default)]
struct Flags {
    enabled: bool,
    stopped: bool,
}

#[derive(Default)]
pub struct Control {
    flags: Mutex<Flags>,
    wake: Condvar,
}

impl Control {
    pub fn enabled(&self) -> bool {
        self.flags.lock().unwrap().enabled
    }
    pub fn stopped(&self) -> bool {
        self.flags.lock().unwrap().stopped
    }
    pub fn set_enabled(&self, enabled: bool) {
        self.flags.lock().unwrap().enabled = enabled;
        self.wake.notify_all();
    }
    pub fn stop(&self) {
        self.flags.lock().unwrap().stopped = true;
        self.wake.notify_all();
    }
    pub fn wait(&self, duration: Duration) {
        let flags = self.flags.lock().unwrap();
        if !flags.stopped {
            drop(self.wake.wait_timeout(flags, duration).unwrap());
        }
    }
    pub fn wait_enabled(&self) {
        let flags = self.flags.lock().unwrap();
        drop(
            self.wake
                .wait_while(flags, |flags| !flags.stopped && !flags.enabled)
                .unwrap(),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, mpsc};
    #[test]
    fn stop_wakes_disabled_worker() {
        let control = Arc::new(Control::default());
        let worker_control = control.clone();
        let (tx, rx) = mpsc::channel();
        let thread = std::thread::spawn(move || {
            worker_control.wait_enabled();
            tx.send(()).unwrap();
        });
        control.stop();
        rx.recv_timeout(Duration::from_secs(1)).unwrap();
        thread.join().unwrap();
    }
}
