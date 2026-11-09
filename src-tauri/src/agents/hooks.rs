use super::model::{MARKER, Tool};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use toml_edit::{DocumentMut, Item};

static NONCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
fn unique_stamp() -> String {
    format!(
        "{}-{}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        std::process::id(),
        NONCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )
}

const EVENTS: [&str; 4] = ["UserPromptSubmit", "PreToolUse", "Notification", "Stop"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    installed: bool,
    hooks_installed: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HooksStatus {
    claude_code: ToolStatus,
    codex: ToolStatus,
}

pub struct Config {
    pub profile: PathBuf,
    pub executable: PathBuf,
}
impl Config {
    pub fn current() -> Result<Self, String> {
        Ok(Self {
            profile: std::env::var_os("USERPROFILE")
                .map(PathBuf::from)
                .ok_or("USERPROFILE is unavailable")?,
            executable: std::env::current_exe()
                .map_err(|e| e.to_string())?
                .with_file_name("ccott-hook.exe"),
        })
    }
    fn path(&self, tool: &Tool) -> PathBuf {
        self.profile.join(match tool {
            Tool::ClaudeCode => ".claude/settings.json",
            Tool::Codex => ".codex/config.toml",
        })
    }
    fn command(&self, event: &str) -> Result<String, String> {
        let path = self
            .executable
            .to_str()
            .ok_or("CCOTT path is not valid Unicode")?;
        // cmd.exe expands percent variables even inside quotes. Fail instead of installing a broken command.
        if path.contains(['"', '%', '\r', '\n']) {
            return Err("CCOTT path cannot be safely used in a Claude hook command".into());
        }
        Ok(format!(
            "\"{path}\" --agent-hook {MARKER} claude-code {event}"
        ))
    }
    fn notify(&self) -> Vec<String> {
        vec![
            self.executable.to_string_lossy().into_owned(),
            "--agent-hook".into(),
            MARKER.into(),
            "codex".into(),
        ]
    }
    pub fn status(&self) -> HooksStatus {
        let claude_path = self.path(&Tool::ClaudeCode);
        let claude = fs::read_to_string(&claude_path)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok());
        let claude_current = self.executable.is_file()
            && EVENTS.iter().all(|event| {
                let Ok(command) = self.command(event) else {
                    return false;
                };
                claude
                    .as_ref()
                    .and_then(|v| v.get("hooks")?.get(event)?.as_array())
                    .is_some_and(|groups| {
                        groups.iter().any(|g| {
                            g.get("hooks")
                                .and_then(Value::as_array)
                                .is_some_and(|hooks| {
                                    hooks.iter().any(|h| {
                                        h.get("type").and_then(Value::as_str) == Some("command")
                                            && h.get("command").and_then(Value::as_str)
                                                == Some(&command)
                                    })
                                })
                        })
                    })
            });
        let codex_path = self.path(&Tool::Codex);
        let codex = fs::read_to_string(&codex_path)
            .ok()
            .and_then(|s| s.parse::<DocumentMut>().ok());
        let codex_current = self.executable.is_file()
            && codex
                .as_ref()
                .and_then(|d| notify_strings(d.get("notify")))
                .is_some_and(|a| a == self.notify());
        HooksStatus {
            claude_code: ToolStatus {
                installed: claude_path.parent().is_some_and(Path::is_dir),
                hooks_installed: claude_current,
            },
            codex: ToolStatus {
                installed: codex_path.parent().is_some_and(Path::is_dir),
                hooks_installed: codex_current,
            },
        }
    }
    pub fn set(&self, tool: Tool, installed: bool) -> Result<HooksStatus, String> {
        let path = self.path(&tool);
        if !path.parent().is_some_and(Path::is_dir) {
            return Err("Tool configuration folder was not found".into());
        }
        if installed && !self.executable.is_file() {
            return Err("CCOTT executable was not found".into());
        }
        let original = match fs::read_to_string(&path) {
            Ok(s) => Some(s),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.to_string()),
        };
        let updated = match tool {
            Tool::ClaudeCode => self.claude(original.as_deref().unwrap_or("{}"), installed)?,
            Tool::Codex => self.codex(original.as_deref().unwrap_or(""), installed)?,
        };
        if original.as_deref() != Some(&updated) && (installed || original.is_some()) {
            atomic_write(&path, original.as_deref(), &updated)?;
        }
        Ok(self.status())
    }
    fn claude(&self, raw: &str, installed: bool) -> Result<String, String> {
        let mut value: Value = serde_json::from_str(raw)
            .map_err(|e| format!("Cannot parse Claude settings.json; file was not changed: {e}"))?;
        let root = value
            .as_object_mut()
            .ok_or("Claude settings.json must contain an object; file was not changed")?;
        if !root.contains_key("hooks") && !installed {
            return Ok(raw.into());
        }
        let hooks = root
            .entry("hooks")
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .ok_or("Claude hooks must be an object; file was not changed")?;
        for event in EVENTS {
            if !hooks.contains_key(event) && !installed {
                continue;
            }
            let groups = hooks
                .entry(event)
                .or_insert_with(|| json!([]))
                .as_array_mut()
                .ok_or("Claude event hooks must be an array; file was not changed")?;
            let before = groups.clone();
            for group in groups.iter_mut() {
                if let Some(entries) = group.get_mut("hooks").and_then(Value::as_array_mut) {
                    entries.retain(|entry| !owned_claude(entry));
                }
            }
            // Remove a group only if removing our command made it empty. Preserve unrelated empty groups.
            let mut index = 0;
            groups.retain(|group| {
                let changed = before[index] != *group;
                index += 1;
                !(changed
                    && group
                        .get("hooks")
                        .and_then(Value::as_array)
                        .is_some_and(Vec::is_empty))
            });
            if installed {
                groups.push(json!({"matcher":"", "hooks":[{"type":"command", "command":self.command(event)?}]}));
            }
            if groups.is_empty() {
                hooks.remove(event);
            }
        }
        // An already-correct install/removal does not create needless backups.
        if serde_json::from_str::<Value>(raw).ok().as_ref() == Some(&value) {
            return Ok(raw.into());
        }
        serde_json::to_string_pretty(&value)
            .map(|s| s + "\n")
            .map_err(|e| e.to_string())
    }
    fn codex(&self, raw: &str, installed: bool) -> Result<String, String> {
        let mut doc = raw
            .parse::<DocumentMut>()
            .map_err(|e| format!("Cannot parse Codex config.toml; file was not changed: {e}"))?;
        if doc.contains_key("notify") {
            let owned = notify_strings(doc.get("notify")).is_some_and(|a| owned_notify(&a));
            if !owned {
                return if installed {
                    Err("Codex notify is already configured by another tool (уже настроено другим инструментом)".into())
                } else {
                    Ok(raw.into())
                };
            }
            if installed && notify_strings(doc.get("notify")) == Some(self.notify()) {
                return Ok(raw.into());
            }
            doc.remove("notify");
        }
        if installed {
            let mut array = toml_edit::Array::new();
            for arg in self.notify() {
                array.push(arg);
            }
            doc["notify"] = toml_edit::value(array);
        }
        Ok(doc.to_string())
    }
}
fn owned_claude(entry: &Value) -> bool {
    entry.get("type").and_then(Value::as_str) == Some("command")
        && entry
            .get("command")
            .and_then(Value::as_str)
            .is_some_and(|s| s.contains(&format!(" --agent-hook {MARKER} claude-code ")))
}
fn notify_strings(item: Option<&Item>) -> Option<Vec<String>> {
    item?
        .as_array()?
        .iter()
        .map(|v| v.as_str().map(String::from))
        .collect()
}
fn owned_notify(args: &[String]) -> bool {
    args.len() == 4 && args[1] == "--agent-hook" && args[2] == MARKER && args[3] == "codex"
}

fn atomic_write(path: &Path, old: Option<&str>, new: &str) -> Result<(), String> {
    let file_name = path.file_name().ok_or("Invalid path for backup")?;
    let stamp = unique_stamp();
    if let Some(old) = old {
        let backup = path.with_file_name(format!(
            "{}.ccott-backup-{stamp}",
            file_name.to_string_lossy()
        ));
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(backup)
            .map_err(|e| e.to_string())?;
        file.write_all(old.as_bytes())
            .and_then(|()| file.sync_all())
            .map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension(format!("ccott-tmp-{}-{stamp}", std::process::id()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        file.write_all(new.as_bytes())
            .and_then(|()| file.sync_all())
            .map_err(|e| e.to_string())?;
        drop(file);
        if fs::read_to_string(path).ok().as_deref() != old {
            return Err("Configuration changed during installation; please retry".into());
        }
        let from = super::native::wide(&temp.to_string_lossy());
        let to = super::native::wide(&path.to_string_lossy());
        // SAFETY: both paths are NUL-terminated; replacement is atomic on the same volume.
        unsafe {
            windows::Win32::Storage::FileSystem::MoveFileExW(
                windows::core::PCWSTR(from.as_ptr()),
                windows::core::PCWSTR(to.as_ptr()),
                windows::Win32::Storage::FileSystem::MOVEFILE_REPLACE_EXISTING
                    | windows::Win32::Storage::FileSystem::MOVEFILE_WRITE_THROUGH,
            )
        }
        .map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn invalid_backup_path_returns_error() {
        assert_eq!(
            atomic_write(Path::new("/"), Some("old"), "new").unwrap_err(),
            "Invalid path for backup"
        );
    }
    struct Fixture(Config);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("ccott-hooks-{}", unique_stamp()));
            fs::create_dir_all(path.join(".claude")).unwrap();
            fs::create_dir_all(path.join(".codex")).unwrap();
            let executable = path.join("CCOTT test.exe");
            fs::write(&executable, "test").unwrap();
            Self(Config {
                profile: path,
                executable,
            })
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0.profile);
        }
    }
    #[test]
    fn json_merge_remove_backup_and_stale_path() {
        let f = Fixture::new();
        let c = &f.0;
        let p = c.path(&Tool::ClaudeCode);
        let raw = r#"{"other":42,"hooks":{"Stop":[{"matcher":"*","hooks":[{"type":"command","command":"other-hook"}]}],"Custom":[{"keep":true}]}}"#;
        fs::write(&p, raw).unwrap();
        assert!(
            c.set(Tool::ClaudeCode, true)
                .unwrap()
                .claude_code
                .hooks_installed
        );
        assert!(fs::read_dir(p.parent().unwrap()).unwrap().any(|e| {
            e.unwrap()
                .file_name()
                .to_string_lossy()
                .contains("ccott-backup-")
        }));
        let stale = Config {
            profile: c.profile.clone(),
            executable: c.profile.join("other.exe"),
        };
        assert!(!stale.status().claude_code.hooks_installed);
        c.set(Tool::ClaudeCode, false).unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&fs::read_to_string(&p).unwrap()).unwrap(),
            serde_json::from_str::<Value>(raw).unwrap()
        );
    }
    #[test]
    fn toml_preserves_foreign_values_comments_and_refuses_notify() {
        let f = Fixture::new();
        let c = &f.0;
        let p = c.path(&Tool::Codex);
        let raw = "# keep\nmodel = 'my-model'\n[profiles.work]\nflag = true\n";
        fs::write(&p, raw).unwrap();
        assert!(c.set(Tool::Codex, true).unwrap().codex.hooks_installed);
        c.set(Tool::Codex, false).unwrap();
        assert_eq!(fs::read_to_string(&p).unwrap(), raw);
        fs::write(&p, "notify = ['other']\n").unwrap();
        assert!(
            c.set(Tool::Codex, true)
                .unwrap_err()
                .contains("another tool")
        );
        assert_eq!(fs::read_to_string(p).unwrap(), "notify = ['other']\n");
    }
    #[test]
    fn malformed_configs_untouched_without_backup() {
        let f = Fixture::new();
        for tool in [Tool::ClaudeCode, Tool::Codex] {
            let p = f.0.path(&tool);
            fs::write(&p, "{ invalid [").unwrap();
            assert!(f.0.set(tool, true).is_err());
            assert_eq!(fs::read_to_string(&p).unwrap(), "{ invalid [");
            assert_eq!(fs::read_dir(p.parent().unwrap()).unwrap().count(), 1);
        }
    }

    #[test]
    fn removes_only_our_command_from_a_mixed_group() {
        let f = Fixture::new();
        let path = f.0.path(&Tool::ClaudeCode);
        let foreign = json!({"type":"command", "command":"keep-me"});
        let own = json!({"type":"command", "command":format!("\"C:\\old CCOTT.exe\" --agent-hook {MARKER} claude-code Stop")});
        let raw = json!({"permissions":{"allow":["Read"]}, "hooks":{"Stop":[{"matcher":"*", "hooks":[foreign.clone(),own]}], "Unknown":[]}});
        fs::write(&path, serde_json::to_string(&raw).unwrap()).unwrap();
        f.0.set(Tool::ClaudeCode, false).unwrap();
        let result: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(
            result["hooks"]["Stop"][0],
            json!({"matcher":"*", "hooks":[foreign]})
        );
        assert_eq!(result["permissions"], raw["permissions"]);
        assert_eq!(result["hooks"]["Unknown"], raw["hooks"]["Unknown"]);
    }

    #[test]
    fn backups_are_exact_and_reinstall_is_idempotent_for_both_tools() {
        for tool in [Tool::ClaudeCode, Tool::Codex] {
            let f = Fixture::new();
            let path = f.0.path(&tool);
            let raw = if tool == Tool::Codex {
                "# preserved\nmodel = 'test'\n"
            } else {
                "{ \"other\": 42 }\n"
            };
            fs::write(&path, raw).unwrap();
            f.0.set(tool.clone(), true).unwrap();
            let backups: Vec<_> = fs::read_dir(path.parent().unwrap())
                .unwrap()
                .map(|e| e.unwrap().path())
                .filter(|p| {
                    p.file_name()
                        .unwrap()
                        .to_string_lossy()
                        .contains(".ccott-backup-")
                })
                .collect();
            assert_eq!(backups.len(), 1);
            assert_eq!(fs::read_to_string(&backups[0]).unwrap(), raw);
            let before = fs::read_to_string(&path).unwrap();
            f.0.set(tool, true).unwrap();
            assert_eq!(fs::read_to_string(path).unwrap(), before);
            assert_eq!(
                fs::read_dir(backups[0].parent().unwrap()).unwrap().count(),
                2
            );
        }
    }
}
