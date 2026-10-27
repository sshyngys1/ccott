//! Clipboard history: listener, SQLite storage, paste-into-previous-window. Owner: R2 (Rust-System).
//!
//! * `win` — Win32 (listener thread, reading/writing the clipboard, foreground tracking, Ctrl+V).
//! * `store` — pure SQLite logic (dedupe, limits, ordering, search).
//! * `image` — DIB/PNG/thumbnail helpers.
//!
//! Capture runs on two background threads (listener → worker), so neither the UI thread nor the
//! clipboard message loop does decoding or database work.

mod image;
mod store;
mod win;

use std::sync::mpsc;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::db::{Db, now_ms};
use store::{ClipItem, ClipKind, MAX_TEXT_BYTES, NewClip};
use win::{Captured, Content, Raw};

/// Encoded PNGs above this size are not stored.
const MAX_PNG_BYTES: usize = 20 * 1024 * 1024;

/// New captures must go through the normal clipboard listener, unlike history re-pastes.
pub(crate) fn copy_capture(png: Vec<u8>) -> Result<(), String> {
    win::write_capture(&Content::Image(png))
}
pub(crate) fn copy_ocr(text: String) -> Result<(), String> {
    win::write_capture(&Content::Text(text))
}

#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PasteMode {
    Paste,
    Copy,
}

/// Turns raw clipboard data into a storable entry; `None` = ignore this clipboard change.
fn build_clip(raw: Raw, source_app: String) -> Option<NewClip> {
    match raw {
        Raw::Text(text) => {
            if text.trim().is_empty() {
                return None;
            }
            if text.len() > MAX_TEXT_BYTES {
                log::debug!(
                    "clipboard: text of {} bytes skipped (too large)",
                    text.len()
                );
                return None;
            }
            let kind = store::classify_text(&text);
            let text = if kind == ClipKind::Link {
                text.trim().to_string()
            } else {
                text
            };
            Some(NewClip {
                kind,
                preview: store::make_preview(&text),
                text,
                source_app,
                image: None,
            })
        }
        Raw::Files(files) => {
            let text = files.join("\n");
            Some(NewClip {
                kind: ClipKind::Files,
                preview: store::make_preview(&text),
                text,
                source_app,
                image: None,
            })
        }
        Raw::Dib(dib) => {
            let img = image::dib_to_rgba(&dib)?;
            let preview = image::thumbnail_data_url(img.width, img.height, &img.pixels)?;
            let png = image::encode_png(img.width, img.height, img.pixels)?;
            image_clip(png, preview, source_app)
        }
        Raw::Png(png) => {
            let img = image::decode_png(&png)?;
            let preview = image::thumbnail_data_url(img.width, img.height, &img.pixels)?;
            image_clip(png, preview, source_app)
        }
    }
}

fn image_clip(png: Vec<u8>, preview: String, source_app: String) -> Option<NewClip> {
    if png.len() > MAX_PNG_BYTES {
        log::debug!(
            "clipboard: image of {} bytes skipped (too large)",
            png.len()
        );
        return None;
    }
    Some(NewClip {
        kind: ClipKind::Image,
        text: String::new(),
        preview,
        source_app,
        image: Some(png),
    })
}

/// Apps that use OLE (PowerShell, Office, browsers) touch the clipboard twice within a few ms for one
/// copy ("set" + "flush"). The second capture is stored (dedupe) but must not be announced again.
const ECHO_WINDOW_MS: i64 = 1500;

/// True when `id` was already announced less than [`ECHO_WINDOW_MS`] ago.
fn is_echo(last: Option<(i64, i64)>, id: i64, now: i64) -> bool {
    last.is_some_and(|(last_id, at)| last_id == id && now - at < ECHO_WINDOW_MS)
}

fn process(db: &Db, app: &AppHandle, cap: Captured, last_announced: &mut Option<(i64, i64)>) {
    let Some(clip) = build_clip(cap.raw, cap.source_app) else {
        return;
    };
    let now = now_ms();
    let result = store::add(&db.lock(), &clip, now);
    match result {
        Ok((item, _is_new)) => {
            if !is_echo(*last_announced, item.id, now) {
                let _ = app.emit("clipboard://added", &item);
            }
            *last_announced = Some((item.id, now));
            let _ = app.emit("clipboard://changed", ());
        }
        Err(e) => log::warn!("clipboard: cannot store entry: {e}"),
    }
}

/// Starts the listener and worker threads. Requires `db::setup` to have run.
pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let db = app.state::<Db>().inner().clone();
    let handle = app.handle().clone();
    let (tx, rx) = mpsc::channel::<Captured>();

    std::thread::Builder::new()
        .name("clipboard-worker".into())
        .spawn(move || {
            let mut last_announced = None;
            for cap in rx {
                process(&db, &handle, cap, &mut last_announced);
            }
        })?;
    std::thread::Builder::new()
        .name("clipboard-listener".into())
        .spawn(move || win::run_listener(tx))?;
    Ok(())
}

fn emit_changed(app: &AppHandle) {
    let _ = app.emit("clipboard://changed", ());
}

#[tauri::command]
pub async fn clipboard_list(
    db: State<'_, Db>,
    query: String,
    limit: usize,
) -> Result<Vec<ClipItem>, String> {
    db.run(move |c| store::list(c, &query, limit).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
pub async fn clipboard_paste(db: State<'_, Db>, id: i64, mode: PasteMode) -> Result<(), String> {
    let payload = db
        .run(move |c| store::payload(c, id).map_err(|e| e.to_string()))
        .await?
        .ok_or_else(|| format!("clipboard entry {id} not found"))?;
    let content = Content::from_stored(payload.kind, payload.text, payload.image)
        .ok_or("entry has no content")?;
    // Win32 clipboard + input injection: off the UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        win::set_clipboard(&content)?;
        match mode {
            PasteMode::Copy => Ok(()),
            PasteMode::Paste => win::paste_into_last_window(),
        }
    })
    .await
    .map_err(|e| format!("paste task failed: {e}"))?
}

#[tauri::command]
pub async fn clipboard_pin(
    app: AppHandle,
    db: State<'_, Db>,
    id: i64,
    pinned: bool,
) -> Result<(), String> {
    db.run(move |c| store::set_pinned(c, id, pinned).map_err(|e| e.to_string()))
        .await?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn clipboard_delete(app: AppHandle, db: State<'_, Db>, id: i64) -> Result<(), String> {
    db.run(move |c| store::delete(c, id).map_err(|e| e.to_string()))
        .await?;
    emit_changed(&app);
    Ok(())
}

#[tauri::command]
pub async fn clipboard_clear(
    app: AppHandle,
    db: State<'_, Db>,
    keep_pinned: bool,
) -> Result<(), String> {
    db.run(move |c| store::clear(c, keep_pinned).map_err(|e| e.to_string()))
        .await?;
    emit_changed(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_clip_classifies_and_filters() {
        let c = build_clip(
            Raw::Text("  https://example.com/x \n".into()),
            "a.exe".into(),
        )
        .unwrap();
        assert_eq!(c.kind, ClipKind::Link);
        assert_eq!(c.text, "https://example.com/x");
        assert_eq!(c.source_app, "a.exe");

        let t = build_clip(Raw::Text("hello\nworld".into()), String::new()).unwrap();
        assert_eq!(t.kind, ClipKind::Text);
        assert_eq!(t.preview, "hello world");

        assert!(build_clip(Raw::Text("   \n".into()), String::new()).is_none());
        assert!(build_clip(Raw::Text("x".repeat(MAX_TEXT_BYTES + 1)), String::new()).is_none());

        let f = build_clip(
            Raw::Files(vec!["C:\\a".into(), "C:\\b".into()]),
            String::new(),
        )
        .unwrap();
        assert_eq!((f.kind, f.text.as_str()), (ClipKind::Files, "C:\\a\nC:\\b"));
    }

    #[test]
    fn build_clip_handles_images() {
        let rgba: Vec<u8> = (0..4 * 4).flat_map(|_| [10u8, 20, 30, 255]).collect();
        let dib = image::rgba_to_dibv5(4, 4, &rgba);
        let c = build_clip(Raw::Dib(dib), String::new()).unwrap();
        assert_eq!(c.kind, ClipKind::Image);
        assert!(c.preview.starts_with("data:image/jpeg;base64,"));
        assert!(
            c.image
                .as_ref()
                .is_some_and(|p| p.starts_with(&[0x89, b'P']))
        );
        assert!(build_clip(Raw::Dib(vec![1, 2, 3]), String::new()).is_none());
    }

    #[test]
    fn echo_detection() {
        assert!(!is_echo(None, 1, 1000));
        assert!(is_echo(Some((1, 1000)), 1, 1010));
        assert!(!is_echo(Some((1, 1000)), 2, 1010), "different entry");
        assert!(
            !is_echo(Some((1, 1000)), 1, 1000 + ECHO_WINDOW_MS),
            "window elapsed"
        );
    }

    #[test]
    fn paste_mode_deserializes() {
        let m: PasteMode = serde_json::from_str("\"paste\"").unwrap();
        assert_eq!(m, PasteMode::Paste);
        let m: PasteMode = serde_json::from_str("\"copy\"").unwrap();
        assert_eq!(m, PasteMode::Copy);
    }
}
