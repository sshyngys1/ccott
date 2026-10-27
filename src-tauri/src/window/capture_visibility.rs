use super::{IslandState, focus, fullscreen, styles};
use std::sync::{atomic::Ordering, mpsc};
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// Restores visibility on every path, including cancellation, PNG/OCR errors and unwinding.
pub(crate) struct CaptureVisibility {
    app: AppHandle,
    visible: bool,
}
impl CaptureVisibility {
    pub fn hide(app: &AppHandle) -> Result<Self, String> {
        let state = app.state::<IslandState>();
        if state.capture_active.swap(true, Ordering::AcqRel) {
            return Err("capture already in progress".into());
        }
        let mut guard = Self {
            app: app.clone(),
            visible: false,
        };
        focus::set_active(app, focus::request(false))?;
        let window = app
            .get_webview_window("island")
            .ok_or("island unavailable")?;
        guard.visible = window.is_visible().map_err(|e| e.to_string())?;
        let (tx, rx) = mpsc::channel();
        let copy = window.clone();
        window
            .run_on_main_thread(move || {
                let _ = tx.send(copy.hide().map_err(|e| e.to_string()));
            })
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(2))
            .map_err(|e| e.to_string())??;
        // SAFETY: DwmFlush waits for the compositor to present the hidden island; no pointers.
        unsafe {
            let _ = windows::Win32::Graphics::Dwm::DwmFlush();
        }
        Ok(guard)
    }
}
impl Drop for CaptureVisibility {
    fn drop(&mut self) {
        self.app
            .state::<IslandState>()
            .capture_active
            .store(false, Ordering::Release);
        if self.visible
            && let Some(window) = self.app.get_webview_window("island")
        {
            let copy = window.clone();
            let _ = window.run_on_main_thread(move || {
                let state = copy.state::<IslandState>();
                // A newer capture / fullscreen decision wins over this queued restoration.
                if state.capture_active.load(Ordering::Acquire)
                    || state.fullscreen_hidden.load(Ordering::Acquire)
                {
                    return;
                }
                if let Err(error) = copy
                    .show()
                    .map_err(|e| e.to_string())
                    .and_then(|()| styles::hwnd_of(&copy))
                    .and_then(styles::ensure_topmost)
                {
                    log::debug!("capture: restore island failed: {error}");
                }
            });
        }
        fullscreen::recheck(&self.app);
    }
}
