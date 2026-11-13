//! Shell data objects preserve CF_HDROP and shortcut metadata without owning the clipboard.
use std::sync::atomic::{AtomicBool, Ordering};
use windows::{
    Win32::{
        Foundation::{DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS},
        System::{
            Com::IDataObject,
            Ole::{DROPEFFECT, DROPEFFECT_COPY, DoDragDrop, IDropSource, IDropSource_Impl},
            SystemServices::MODIFIERKEYS_FLAGS,
        },
        UI::Shell::{BHID_DataObject, IShellItem, SHCreateItemFromParsingName},
    },
    core::{BOOL, HRESULT, PCWSTR, implement},
};

static ACTIVE: AtomicBool = AtomicBool::new(false);

#[implement(IDropSource)]
struct Source;

impl IDropSource_Impl for Source_Impl {
    fn QueryContinueDrag(&self, escape: BOOL, keys: MODIFIERKEYS_FLAGS) -> HRESULT {
        drag_status(escape.as_bool(), keys.0)
    }

    fn GiveFeedback(&self, _: DROPEFFECT) -> HRESULT {
        DRAGDROP_S_USEDEFAULTCURSORS
    }
}

fn drag_status(escape: bool, keys: u32) -> HRESULT {
    if escape {
        DRAGDROP_S_CANCEL
    } else if keys & 3 == 0 {
        DRAGDROP_S_DROP
    } else {
        HRESULT(0)
    }
}

struct ActiveDrag;
impl Drop for ActiveDrag {
    fn drop(&mut self) {
        ACTIVE.store(false, Ordering::Release);
    }
}

/// Must run on the window's OLE-initialized main STA; DoDragDrop pumps its nested message loop.
pub fn start(path: &str) -> Result<(), String> {
    if !std::path::Path::new(path).exists() {
        return Err("dock.notFound".into());
    }
    if ACTIVE.swap(true, Ordering::AcqRel) {
        return Err("dock.error".into());
    }
    let _active = ActiveDrag;
    let path: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    // SAFETY: the UTF-16 path outlives creation; COM interfaces own their references. The
    // apartment and all pointers remain live throughout the synchronous OLE message loop.
    unsafe {
        let item: IShellItem =
            SHCreateItemFromParsingName(PCWSTR(path.as_ptr()), None).map_err(|e| e.to_string())?;
        let data: IDataObject = item
            .BindToHandler(None, &BHID_DataObject)
            .map_err(|e| e.to_string())?;
        let source: IDropSource = Source.into();
        let mut effect = DROPEFFECT::default();
        DoDragDrop(&data, &source, DROPEFFECT_COPY, &mut effect)
            .ok()
            .map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_cancels_and_releasing_mouse_drops_a_copy() {
        assert_eq!(drag_status(true, 1), DRAGDROP_S_CANCEL);
        assert_eq!(drag_status(false, 1), HRESULT(0));
        assert_eq!(drag_status(false, 2), HRESULT(0));
        assert_eq!(drag_status(false, 0), DRAGDROP_S_DROP);
        assert_eq!(drag_status(false, 4), DRAGDROP_S_DROP); // Shift is not a mouse button.
    }
}
