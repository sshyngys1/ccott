//! Windows-only discovery and launch. Every COM interface stays on its initializing thread.
use super::{
    automation::Dispatch,
    model::{Entry, Kind, LaunchMode, parse_url},
};
use crate::system::worker::Control;
use std::{
    collections::VecDeque,
    os::windows::fs::MetadataExt,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use windows::{
    Win32::{
        Foundation::ERROR_CANCELLED,
        System::Com::*,
        UI::{Shell::*, WindowsAndMessaging::SW_SHOWNORMAL},
    },
    core::{BSTR, GUID, Interface, PCWSTR, PWSTR, w},
};

pub struct Apartment;
impl Apartment {
    pub fn new() -> windows::core::Result<Self> {
        // SAFETY: dedicated worker/blocking thread; successful initialization is balanced in Drop.
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
        }
        Ok(Self)
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        // SAFETY: this guard successfully initialized COM on this thread.
        unsafe {
            CoUninitialize();
        }
    }
}
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(Some(0)).collect()
}
fn buffer_text(value: &[u16]) -> String {
    String::from_utf16_lossy(&value[..value.iter().position(|c| *c == 0).unwrap_or(value.len())])
}
fn owned_text(value: PWSTR) -> windows::core::Result<String> {
    // SAFETY: shell allocated this terminated string with CoTaskMemAlloc. Free it even on UTF-16 error.
    unsafe {
        let result = value.to_string();
        CoTaskMemFree(Some(value.0.cast()));
        Ok(result?)
    }
}

pub fn known_folder(id: &GUID) -> windows::core::Result<PathBuf> {
    // SAFETY: plain known-folder lookup for this user, output freed by owned_text.
    unsafe { owned_text(SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None)?).map(PathBuf::from) }
}

/// Breadth-first, bounded, no junction/symlink traversal or network recursion.
pub fn walk(
    roots: Vec<PathBuf>,
    depth: usize,
    max: usize,
    budget: Duration,
    stop: &Control,
) -> Vec<PathBuf> {
    let started = Instant::now();
    let mut queue: VecDeque<_> = roots.into_iter().map(|p| (p, 0)).collect();
    let mut result = Vec::new();
    let mut visited = 0;
    while let Some((folder, level)) = queue.pop_front() {
        if stop.stopped() || started.elapsed() > budget || visited >= max {
            break;
        }
        if folder.to_string_lossy().starts_with("\\\\") {
            continue;
        }
        if folder
            .symlink_metadata()
            .is_ok_and(|m| m.file_attributes() & 0x400 != 0)
        {
            continue;
        }
        let Ok(children) = std::fs::read_dir(folder) else {
            continue;
        };
        for child in children.flatten() {
            visited += 1;
            if visited > max || stop.stopped() || started.elapsed() > budget {
                break;
            }
            let Ok(meta) = child.path().symlink_metadata() else {
                continue;
            };
            // FILE_ATTRIBUTE_REPARSE_POINT: don't follow junctions or hydrate cloud placeholders.
            if meta.file_attributes() & 0x400 != 0 {
                continue;
            }
            if meta.is_dir() && level < depth {
                queue.push_back((child.path(), level + 1));
            }
            result.push(child.path());
        }
    }
    result
}

pub fn file_entry(path: PathBuf) -> Option<Entry> {
    let title = path.file_name()?.to_string_lossy().into_owned();
    let subtitle = path.parent()?.to_string_lossy().into_owned();
    let kind = if path.is_dir() {
        Kind::Folder
    } else {
        Kind::File
    };
    let path = path.to_string_lossy().into_owned();
    Some(Entry {
        kind,
        title,
        subtitle,
        launch: path.clone(),
        resolved: path,
        arguments: String::new(),
        directory: String::new(),
        aumid: None,
    })
}

pub fn fallback(stop: &Control) -> Vec<Entry> {
    let roots = [
        FOLDERID_Desktop,
        FOLDERID_Documents,
        FOLDERID_Downloads,
        FOLDERID_Pictures,
    ]
    .iter()
    .filter_map(|id| known_folder(id).ok())
    .collect();
    walk(roots, 4, 8000, Duration::from_millis(750), stop)
        .into_iter()
        .filter_map(file_entry)
        .collect()
}

fn shortcut(path: &Path) -> windows::core::Result<Entry> {
    let launch = path.to_string_lossy().into_owned();
    let mut entry = Entry {
        kind: Kind::App,
        title: path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned(),
        subtitle: launch.clone(),
        launch: launch.clone(),
        resolved: launch,
        arguments: String::new(),
        directory: String::new(),
        aumid: None,
    };
    if path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("url"))
    {
        if std::fs::metadata(path).is_ok_and(|m| m.len() <= 65536)
            && let Ok(bytes) = std::fs::read(path)
            && let Some(url) = parse_url(&bytes)
        {
            entry.resolved = url.clone();
            entry.subtitle = url;
        }
        return Ok(entry);
    }
    // SAFETY: COM initialized on this worker; persistent link and all output buffers are live.
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        let persist: IPersistFile = link.cast()?;
        let name = wide(&entry.launch);
        persist.Load(PCWSTR(name.as_ptr()), STGM_READ)?;
        let mut buffer = vec![0; 32768];
        link.GetPath(&mut buffer, std::ptr::null_mut(), 0)?;
        let target = buffer_text(&buffer);
        if !target.is_empty() {
            entry.resolved = target.clone();
            entry.subtitle = target;
        }
        link.GetArguments(&mut buffer)?;
        entry.arguments = buffer_text(&buffer);
        link.GetWorkingDirectory(&mut buffer)?;
        entry.directory = buffer_text(&buffer);
    }
    Ok(entry)
}

pub fn applications(stop: &Control) -> Vec<Entry> {
    let roots = ["ProgramData", "APPDATA"]
        .iter()
        .filter_map(std::env::var_os)
        .map(|p| PathBuf::from(p).join("Microsoft/Windows/Start Menu/Programs"))
        .collect();
    let mut entries: Vec<_> = walk(roots, 10, 12000, Duration::from_secs(10), stop)
        .into_iter()
        .filter(|p| {
            p.extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("lnk") || e.eq_ignore_ascii_case("url"))
        })
        .take_while(|_| !stop.stopped())
        .filter_map(|p| shortcut(&p).ok())
        .collect();
    if !stop.stopped() {
        entries.extend(store_apps(stop).unwrap_or_default());
    }
    entries.sort_by_key(|e| (e.title.to_lowercase(), e.key()));
    entries.dedup_by(|a, b| {
        a.title.eq_ignore_ascii_case(&b.title) && a.resolved.eq_ignore_ascii_case(&b.resolved)
    });
    entries
}

fn store_apps(stop: &Control) -> windows::core::Result<Vec<Entry>> {
    // SAFETY: Shell interfaces and all allocated strings stay in this initialized apartment.
    unsafe {
        let folder: IShellItem = SHGetKnownFolderItem(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None)?;
        let items: IEnumShellItems = folder.BindToHandler(None, &BHID_EnumItems)?;
        let mut entries = Vec::new();
        for _ in 0..4096 {
            if stop.stopped() {
                break;
            }
            let mut next = [None];
            let mut fetched = 0;
            items.Next(&mut next, Some(&mut fetched))?;
            let Some(item) = next[0].take().filter(|_| fetched != 0) else {
                break;
            };
            let title = owned_text(item.GetDisplayName(SIGDN_NORMALDISPLAY)?)?;
            let parsing = owned_text(item.GetDisplayName(SIGDN_DESKTOPABSOLUTEPARSING)?)?;
            let id = parsing.rsplit('\\').next().unwrap_or(&parsing).to_string();
            // Packaged apps expose PackageFamilyName!AppId. Classic apps come from Start Menu.
            if !id.contains('!') {
                continue;
            }
            entries.push(Entry {
                kind: Kind::App,
                title,
                subtitle: id.clone(),
                launch: format!("shell:AppsFolder\\{id}"),
                resolved: parsing,
                arguments: String::new(),
                directory: String::new(),
                aumid: Some(id),
            });
        }
        Ok(entries)
    }
}

fn sql_string(value: &str) -> String {
    value.replace('\'', "''")
}

fn within_profile(path: &Path, profile: &Path) -> bool {
    let path = PathBuf::from(path.to_string_lossy().to_lowercase());
    let profile = PathBuf::from(profile.to_string_lossy().to_lowercase());
    path.is_absolute()
        && path.starts_with(profile)
        && !path
            .components()
            .any(|part| matches!(part, std::path::Component::ParentDir))
}
fn sql_like(value: &str) -> String {
    value
        .chars()
        .map(|c| match c {
            '\'' => "''".into(),
            '%' => "[%]".into(),
            '_' => "[_]".into(),
            '[' => "[[]".into(),
            ']' => "[]]".into(),
            _ => c.to_string(),
        })
        .collect()
}
pub fn search_sql(profile: &str, query: &str) -> String {
    format!(
        "SELECT TOP 512 System.ItemPathDisplay FROM SystemIndex WHERE SCOPE='file:{}' AND System.FileName LIKE '%{}%' ORDER BY System.FileName",
        sql_string(&profile.replace('\\', "/")),
        sql_like(query)
    )
}

pub fn indexed_files(query: &str, stop: &Control) -> windows::core::Result<Vec<Entry>> {
    let profile = known_folder(&FOLDERID_Profile)?;
    let connection = Dispatch::create("ADODB.Connection")?;
    connection.put("ConnectionTimeout", 2i32.into())?;
    connection.put("CommandTimeout", 2i32.into())?;
    connection.call(
        "Open",
        vec!["Provider=Search.CollatorDSO;Extended Properties='Application=Windows';".into()],
    )?;
    // Execute on the connection returns a forward-only, read-only recordset.
    let sql = search_sql(&profile.to_string_lossy(), query);
    let rows_result = connection.call("Execute", vec![sql.as_str().into()]);
    let result = (|| {
        let rows = Dispatch::from(&rows_result?)?;
        let mut entries = Vec::new();
        for _ in 0..512 {
            if stop.stopped() || bool::try_from(&rows.get("EOF")?)? {
                break;
            }
            let fields = Dispatch::from(&rows.get("Fields")?)?;
            let value = fields.item("System.ItemPathDisplay")?.get("Value")?;
            let path = PathBuf::from(BSTR::try_from(&value)?.to_string());
            // Provider scope plus a lexical containment check: only filesystem profile results.
            if within_profile(&path, &profile)
                && let Some(entry) = file_entry(path)
            {
                entries.push(entry);
            }
            rows.call("MoveNext", vec![])?;
        }
        let _ = rows.call("Close", vec![]);
        Ok(entries)
    })();
    let _ = connection.call("Close", vec![]);
    result
}

pub fn launch(entry: &Entry, mode: LaunchMode) -> Result<(), String> {
    let _com = Apartment::new().map_err(|_| "Could not initialize Windows Shell.")?;
    if mode == LaunchMode::Reveal {
        return reveal(if entry.aumid.is_some() {
            &entry.launch
        } else if Path::new(&entry.resolved).is_absolute() {
            &entry.resolved
        } else {
            &entry.launch
        });
    }
    if mode == LaunchMode::Open
        && let Some(aumid) = &entry.aumid
    {
        let id = wide(aumid);
        // SAFETY: valid apartment-local activation manager and terminated AUMID, no external window handles.
        return unsafe {
            let manager: IApplicationActivationManager =
                CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_INPROC_SERVER)
                    .map_err(|_| "Could not initialize app activation.")?;
            manager
                .ActivateApplication(PCWSTR(id.as_ptr()), w!(""), AO_NONE)
                .map(|_| ())
                .map_err(|_| "Could not open this Store application.".into())
        };
    }
    let admin = mode == LaunchMode::Admin;
    let path = wide(if admin {
        &entry.resolved
    } else {
        &entry.launch
    });
    let args = wide(if admin { &entry.arguments } else { "" });
    let directory = wide(&entry.directory);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_FLAG_NO_UI | SEE_MASK_NOASYNC,
        lpVerb: if admin { w!("runas") } else { w!("open") },
        lpFile: PCWSTR(path.as_ptr()),
        lpParameters: PCWSTR(args.as_ptr()),
        lpDirectory: if entry.directory.is_empty() {
            PCWSTR::null()
        } else {
            PCWSTR(directory.as_ptr())
        },
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    // SAFETY: strings and structure live through synchronous ShellExecuteEx; no process handle requested.
    unsafe { execution_result(ShellExecuteExW(&mut info), admin) }
}

fn execution_result(result: windows::core::Result<()>, admin: bool) -> Result<(), String> {
    match result {
        Ok(()) => Ok(()),
        Err(error)
            if admin && error.code() == windows::core::HRESULT::from_win32(ERROR_CANCELLED.0) =>
        {
            Ok(())
        }
        Err(_) => Err(if admin {
            "Windows could not run this application as administrator."
        } else {
            "Windows could not open this search result."
        }
        .into()),
    }
}

fn reveal(path: &str) -> Result<(), String> {
    let path = wide(path);
    // SAFETY: Shell owns the allocated PIDL; passing zero children selects the item itself.
    // The PIDL is freed on both success and failure; all operations run in this COM apartment.
    unsafe {
        let mut pidl = std::ptr::null_mut();
        SHParseDisplayName(PCWSTR(path.as_ptr()), None, &mut pidl, 0, None)
            .map_err(|_| "This search result no longer exists.")?;
        let result = SHOpenFolderAndSelectItems(pidl, None, 0);
        CoTaskMemFree(Some(pidl.cast()));
        result.map_err(|_| "Could not show this item in File Explorer.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uac_cancel_is_quiet_only_for_elevation() {
        let cancelled = || {
            Err(windows::core::Error::from_hresult(
                windows::core::HRESULT::from_win32(ERROR_CANCELLED.0),
            ))
        };
        assert!(execution_result(cancelled(), true).is_ok());
        assert!(execution_result(cancelled(), false).is_err());
        assert!(
            execution_result(
                Err(windows::core::Error::from_hresult(
                    windows::core::HRESULT::from_win32(5)
                )),
                true
            )
            .is_err()
        );
    }
    #[test]
    fn sql_is_scoped_and_escapes_user_literals() {
        let sql = search_sql("C:\\Users\\O'Neil", "50%_['x");
        assert!(sql.contains("SCOPE='file:C:/Users/O''Neil'"));
        assert!(sql.contains("50[%][_][[]''x"));
        assert!(sql.contains("TOP 512"));
        assert!(within_profile(
            Path::new("c:/users/ALICE/report.txt"),
            Path::new("C:/Users/Alice")
        ));
        assert!(!within_profile(
            Path::new("C:/Users/Alice2/report.txt"),
            Path::new("C:/Users/Alice")
        ));
        assert!(!within_profile(
            Path::new("C:/Users/Alice/../Other/report.txt"),
            Path::new("C:/Users/Alice")
        ));
    }
    #[test]
    fn fallback_walk_bounds_depth_and_count_without_profile() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/cmd-walk-tests");
        std::fs::create_dir_all(root.join("a/b/c")).unwrap();
        std::fs::write(root.join("root.txt"), b"fixture").unwrap();
        std::fs::write(root.join("a/deep.txt"), b"fixture").unwrap();
        let control = Control::default();
        let paths = walk(vec![root.clone()], 0, 100, Duration::from_secs(2), &control);
        assert!(paths.contains(&root.join("root.txt")));
        assert!(!paths.contains(&root.join("a/deep.txt")));
        assert_eq!(
            walk(vec![root.clone()], 5, 1, Duration::from_secs(2), &control).len(),
            1
        );
        control.stop();
        assert!(walk(vec![root], 5, 100, Duration::from_secs(2), &control).is_empty());
    }
}
