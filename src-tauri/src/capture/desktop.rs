use super::model::{Rect, monitor_at};
use windows::{
    Win32::{
        Foundation::{LPARAM, POINT, RECT},
        Graphics::Gdi::*,
        UI::WindowsAndMessaging::*,
    },
    core::BOOL,
};

pub struct Snapshot {
    pub bounds: Rect,
    pub pixels: Vec<u8>,
}
pub fn bitmap_info(width: i32, height: i32) -> BITMAPINFO {
    BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: -height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    }
}
/// All queries and GDI operations run on the same per-monitor-aware thread as the native overlay.
pub fn capture(screen_only: bool) -> Result<Snapshot, String> {
    // SAFETY: callback receives our live Vec pointer only for this synchronous enumeration.
    unsafe extern "system" fn enumerate(
        _: HMONITOR,
        _: HDC,
        rect: *mut RECT,
        data: LPARAM,
    ) -> BOOL {
        // SAFETY: both pointers are supplied by EnumDisplayMonitors / our invocation below.
        unsafe {
            let r = *rect;
            (&mut *(data.0 as *mut Vec<Rect>)).push(Rect {
                left: r.left,
                top: r.top,
                right: r.right,
                bottom: r.bottom,
            });
        }
        true.into()
    }
    // SAFETY: monitor/DC handles are system-owned; bitmap and compatible DC are restored/freed below.
    unsafe {
        let mut monitors = Vec::<Rect>::new();
        EnumDisplayMonitors(
            None,
            None,
            Some(enumerate),
            LPARAM(&mut monitors as *mut _ as isize),
        )
        .ok()
        .map_err(|e| e.to_string())?;
        let mut cursor = POINT::default();
        GetCursorPos(&mut cursor).map_err(|e| e.to_string())?;
        let bounds = if screen_only {
            monitor_at(&monitors, (cursor.x, cursor.y)).ok_or("monitor not found")?
        } else {
            Rect {
                left: GetSystemMetrics(SM_XVIRTUALSCREEN),
                top: GetSystemMetrics(SM_YVIRTUALSCREEN),
                right: GetSystemMetrics(SM_XVIRTUALSCREEN) + GetSystemMetrics(SM_CXVIRTUALSCREEN),
                bottom: GetSystemMetrics(SM_YVIRTUALSCREEN) + GetSystemMetrics(SM_CYVIRTUALSCREEN),
            }
        };
        let (width, height) = (bounds.width(), bounds.height());
        if width <= 0 || height <= 0 || width as u64 * height as u64 > 64 * 1024 * 1024 {
            return Err("desktop dimensions exceed capture limit".into());
        }
        let dc = GetDC(None);
        if dc.is_invalid() {
            return Err("desktop DC unavailable".into());
        }
        let memory = CreateCompatibleDC(Some(dc));
        if memory.is_invalid() {
            ReleaseDC(None, dc);
            return Err("capture DC unavailable".into());
        }
        let mut bits = std::ptr::null_mut();
        let info = bitmap_info(width, height);
        let bitmap = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0);
        let result = match bitmap {
            Ok(bitmap) => {
                let old = SelectObject(memory, bitmap.into());
                let result = BitBlt(
                    memory,
                    0,
                    0,
                    width,
                    height,
                    Some(dc),
                    bounds.left,
                    bounds.top,
                    SRCCOPY | CAPTUREBLT,
                )
                .map(|()| {
                    let pixels = std::slice::from_raw_parts(
                        bits as *const u8,
                        width as usize * height as usize * 4,
                    )
                    .to_vec();
                    Snapshot { bounds, pixels }
                })
                .map_err(|e| e.to_string());
                SelectObject(memory, old);
                let _ = DeleteObject(bitmap.into());
                result
            }
            Err(e) => Err(e.to_string()),
        };
        let _ = DeleteDC(memory);
        ReleaseDC(None, dc);
        result
    }
}
impl Snapshot {
    pub fn color_at(&self, point: (i32, i32)) -> Option<super::model::PickedColor> {
        if !self.bounds.contains(point) {
            return None;
        }
        let i = ((point.1 - self.bounds.top) as usize * self.bounds.width() as usize
            + (point.0 - self.bounds.left) as usize)
            * 4;
        Some(super::model::PickedColor::rgb(
            self.pixels[i + 2],
            self.pixels[i + 1],
            self.pixels[i],
        ))
    }
    pub fn crop(&self, rect: Rect) -> Vec<u8> {
        let stride = self.bounds.width() as usize * 4;
        let mut out = Vec::with_capacity(rect.width() as usize * rect.height() as usize * 4);
        for y in rect.top..rect.bottom {
            let start = (y - self.bounds.top) as usize * stride
                + (rect.left - self.bounds.left) as usize * 4;
            for bgra in self.pixels[start..start + rect.width() as usize * 4]
                .as_chunks::<4>()
                .0
            {
                out.extend_from_slice(&[bgra[2], bgra[1], bgra[0], 255]);
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn crop_uses_physical_offsets_with_negative_monitor_origins() {
        let snapshot = Snapshot {
            bounds: Rect {
                left: -2,
                top: -1,
                right: 0,
                bottom: 1,
            },
            pixels: vec![0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0],
        };
        let pixels = snapshot.crop(Rect {
            left: -1,
            top: -1,
            right: 0,
            bottom: 1,
        });
        assert_eq!(pixels, [0, 255, 0, 255, 255, 255, 255, 255]);
    }
}
