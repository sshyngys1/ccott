use std::sync::atomic::{AtomicBool, Ordering};
use windows::{
    Win32::{
        Foundation::{
            DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS, GlobalFree,
        },
        System::{
            Com::{
                CoTaskMemFree, DVASPECT_CONTENT, FORMATETC, IDataObject, STGMEDIUM, STGMEDIUM_0,
                TYMED_HGLOBAL,
            },
            DataExchange::RegisterClipboardFormatW,
            Memory::{GMEM_MOVEABLE, GMEM_ZEROINIT, GlobalAlloc, GlobalLock, GlobalUnlock},
            Ole::{
                DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_MOVE, DROPEFFECT_NONE, DoDragDrop,
                IDropSource, IDropSource_Impl, ReleaseStgMedium,
            },
            SystemServices::MODIFIERKEYS_FLAGS,
        },
        UI::Shell::{
            BHID_DataObject, Common::ITEMIDLIST, SHCreateShellItemArrayFromIDLists,
            SHParseDisplayName,
        },
    },
    core::{BOOL, HRESULT, PCWSTR, implement, w},
};

static ACTIVE: AtomicBool = AtomicBool::new(false);
#[implement(IDropSource)]
struct Source;
impl IDropSource_Impl for Source_Impl {
    fn QueryContinueDrag(&self, escape: BOOL, keys: MODIFIERKEYS_FLAGS) -> HRESULT {
        if escape.as_bool() {
            DRAGDROP_S_CANCEL
        } else if keys.0 & 3 == 0 {
            DRAGDROP_S_DROP
        } else {
            HRESULT(0)
        }
    }
    fn GiveFeedback(&self, _: DROPEFFECT) -> HRESULT {
        DRAGDROP_S_USEDEFAULTCURSORS
    }
}

/// The shell defaults to a copy; a destination can still explicitly request a move.
fn prefer_copy(data: &IDataObject) -> bool {
    // SAFETY: the medium owns a DWORD-sized global allocation. SetData(false) copies it;
    // ReleaseStgMedium frees our allocation after the call, including on failure.
    unsafe {
        let format = RegisterClipboardFormatW(w!("Preferred DropEffect"));
        if format == 0 {
            return false;
        }
        let Ok(memory) = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, size_of::<u32>()) else {
            return false;
        };
        let pointer = GlobalLock(memory).cast::<u32>();
        if pointer.is_null() {
            let _ = GlobalFree(Some(memory));
            return false;
        }
        pointer.write(DROPEFFECT_COPY.0);
        let _ = GlobalUnlock(memory);
        let format = FORMATETC {
            cfFormat: format as u16,
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
            ..Default::default()
        };
        let mut medium = STGMEDIUM {
            tymed: TYMED_HGLOBAL.0 as u32,
            u: STGMEDIUM_0 { hGlobal: memory },
            ..Default::default()
        };
        let result = data.SetData(&format, &medium, false).is_ok();
        ReleaseStgMedium(&mut medium);
        result
    }
}

fn completed_drop(result: HRESULT, effect: DROPEFFECT) -> bool {
    result == DRAGDROP_S_DROP && effect != DROPEFFECT_NONE
}
struct Active;
impl Drop for Active {
    fn drop(&mut self) {
        ACTIVE.store(false, Ordering::Release);
    }
}
struct IdList(*mut ITEMIDLIST);
impl Drop for IdList {
    fn drop(&mut self) {
        // SAFETY: SHParseDisplayName allocated this PIDL with the COM task allocator.
        unsafe { CoTaskMemFree(Some(self.0.cast())) };
    }
}

/// Called only on the window's OLE-initialized main STA. Cancellation is not a completed drop.
pub fn start(paths: &[String]) -> Result<bool, String> {
    if paths.is_empty() || paths.iter().any(|p| !std::path::Path::new(p).exists()) {
        return Err("shelf.missing".into());
    }
    if ACTIVE.swap(true, Ordering::AcqRel) {
        return Err("shelf.error".into());
    }
    let _active = Active;
    // SAFETY: PIDLs and COM objects remain live throughout the nested DoDragDrop message loop.
    // Owned PIDLs are freed on every return path; the shell array owns its own copies.
    unsafe {
        let mut lists = Vec::new();
        for path in paths {
            let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
            let mut pidl = std::ptr::null_mut();
            SHParseDisplayName(PCWSTR(wide.as_ptr()), None, &mut pidl, 0, None)
                .map_err(|_| "shelf.error")?;
            lists.push(IdList(pidl));
        }
        let pointers: Vec<*const ITEMIDLIST> = lists.iter().map(|p| p.0.cast_const()).collect();
        let array = SHCreateShellItemArrayFromIDLists(&pointers).map_err(|_| "shelf.error")?;
        let data: IDataObject = array
            .BindToHandler(None, &BHID_DataObject)
            .map_err(|_| "shelf.error")?;
        let source: IDropSource = Source.into();
        let mut effect = DROPEFFECT_NONE;
        let allowed = if prefer_copy(&data) {
            DROPEFFECT_COPY | DROPEFFECT_MOVE
        } else {
            DROPEFFECT_COPY
        };
        let result = DoDragDrop(&data, &source, allowed, &mut effect);
        result.ok().map_err(|_| "shelf.error")?;
        Ok(completed_drop(result, effect))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_confirmed_copy_or_move_counts_as_completed() {
        assert!(completed_drop(DRAGDROP_S_DROP, DROPEFFECT_COPY));
        assert!(completed_drop(DRAGDROP_S_DROP, DROPEFFECT_MOVE));
        assert!(!completed_drop(DRAGDROP_S_CANCEL, DROPEFFECT_COPY));
        assert!(!completed_drop(DRAGDROP_S_DROP, DROPEFFECT_NONE));
        assert!(!completed_drop(HRESULT(0), DROPEFFECT_COPY));
    }
}
