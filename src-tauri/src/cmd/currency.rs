//! HTTPS exchange rates; disk cache and injectable transport for offline tests.
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    future::Future,
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const FRESH_MS: i64 = 12 * 60 * 60 * 1000;
const MAX_BYTES: usize = 128 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrencyRates {
    pub base: String,
    pub rates: BTreeMap<String, f64>,
    pub updated_at: i64,
    pub stale: bool,
}

#[derive(Deserialize, Serialize)]
struct Cached {
    fetched_at: i64,
    value: CurrencyRates,
}

#[derive(Deserialize)]
struct Provider {
    result: String,
    base_code: String,
    time_last_update_unix: i64,
    rates: BTreeMap<String, f64>,
}

pub fn code(value: &str) -> Result<String, String> {
    let value = value.trim().to_ascii_uppercase();
    if value.len() == 3 && value.bytes().all(|c| c.is_ascii_uppercase()) {
        Ok(value)
    } else {
        Err("Use a three-letter currency code, for example USD.".into())
    }
}

pub fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn valid(value: &CurrencyRates, base: &str) -> bool {
    value.base == base
        && value.updated_at > 0
        && !value.rates.is_empty()
        && value.rates.len() <= 300
        && value
            .rates
            .get(base)
            .is_some_and(|r| (*r - 1.0).abs() < 0.000001)
        && value.rates.iter().all(|(key, value)| {
            code(key).is_ok_and(|c| c == *key) && value.is_finite() && *value > 0.0
        })
}

fn read(path: &Path, base: &str) -> Option<Cached> {
    let file = std::fs::File::open(path).ok()?;
    if file.metadata().ok()?.len() > MAX_BYTES as u64 {
        return None;
    }
    let cached: Cached = serde_json::from_reader(file).ok()?;
    valid(&cached.value, base).then_some(cached)
}

fn save(path: &Path, cached: &Cached) -> std::io::Result<()> {
    use std::{
        io::Write,
        sync::atomic::{AtomicU64, Ordering},
    };
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temp = path.with_extension(format!(
        "{}-{}.tmp",
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    let result = (|| {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(&serde_json::to_vec(cached)?)?;
        file.sync_all()?;
        std::fs::rename(&temp, path)
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temp);
    }
    result
}

pub fn client() -> Result<reqwest::Client, String> {
    // Match updater's existing ring provider. Its delayed first request may not have installed
    // the provider yet; rustls-no-provider requires it before constructing a reqwest Client.
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .https_only(true)
        .timeout(Duration::from_secs(5))
        .connect_timeout(Duration::from_secs(5))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "Could not initialize the currency rate connection.".into())
}

async fn fetch(client: reqwest::Client, base: String) -> Result<CurrencyRates, String> {
    // Only the validated currency code leaves the computer. No query, path or user identifier.
    let mut response = client
        .get(format!("https://open.er-api.com/v6/latest/{base}"))
        .send()
        .await
        .map_err(|_| "Currency provider is unavailable.")?
        .error_for_status()
        .map_err(|_| "Currency provider rejected the request.")?;
    let mut body = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read currency rates.")?
    {
        if body.len() + chunk.len() > MAX_BYTES {
            return Err("Currency provider response is too large.".into());
        }
        body.extend_from_slice(&chunk);
    }
    let provider: Provider =
        serde_json::from_slice(&body).map_err(|_| "Currency provider returned invalid data.")?;
    let value = CurrencyRates {
        base: provider.base_code,
        rates: provider.rates,
        updated_at: provider.time_last_update_unix.saturating_mul(1000),
        stale: false,
    };
    if provider.result != "success" || !valid(&value, &base) {
        return Err("Currency provider returned invalid rates.".into());
    }
    Ok(value)
}

pub async fn get(
    dir: PathBuf,
    base: String,
    client: reqwest::Client,
) -> Result<CurrencyRates, String> {
    load_or_fetch(dir, base, now_ms(), |base| fetch(client, base)).await
}

async fn load_or_fetch<F, Fut>(
    dir: PathBuf,
    base: String,
    now: i64,
    http: F,
) -> Result<CurrencyRates, String>
where
    F: FnOnce(String) -> Fut,
    Fut: Future<Output = Result<CurrencyRates, String>>,
{
    let base = code(&base)?;
    let path = dir.join(format!("{base}.json"));
    let read_path = path.clone();
    let read_base = base.clone();
    let cached = tauri::async_runtime::spawn_blocking(move || read(&read_path, &read_base))
        .await
        .map_err(|e| e.to_string())?;
    if let Some(cached) = &cached
        && (0..=FRESH_MS).contains(&now.saturating_sub(cached.fetched_at))
    {
        let mut value = cached.value.clone();
        value.stale = false;
        return Ok(value);
    }
    match http(base.clone()).await.and_then(|value| {
        if valid(&value, &base) { Ok(value) } else { Err("Invalid currency rates.".into()) }
    }) {
        Ok(mut value) => {
            value.stale = false;
            let write = Cached { fetched_at: now, value: value.clone() };
            let _ = tauri::async_runtime::spawn_blocking(move || save(&path, &write)).await;
            Ok(value)
        }
        Err(_) => cached.map(|mut cache| { cache.value.stale = true; cache.value })
            .ok_or_else(|| "Currency rates are unavailable: no internet connection and no saved rates for this currency.".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    fn value() -> CurrencyRates {
        CurrencyRates {
            base: "USD".into(),
            rates: [("USD".into(), 1.0), ("KZT".into(), 500.0)].into(),
            updated_at: 1000,
            stale: false,
        }
    }
    #[test]
    fn fresh_expired_offline_missing_corrupt_and_separate_bases() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("target/cmd-currency-tests")
            .join(std::process::id().to_string());
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("USD.json");
        let calls = AtomicUsize::new(0);
        let now = 100_000_000;
        tauri::async_runtime::block_on(async {
            save(
                &path,
                &Cached {
                    fetched_at: now - FRESH_MS,
                    value: value(),
                },
            )
            .unwrap();
            let fresh = load_or_fetch(dir.clone(), " usd ".into(), now, |_| async {
                calls.fetch_add(1, Ordering::Relaxed);
                Err("offline".into())
            })
            .await
            .unwrap();
            assert!(!fresh.stale);
            assert_eq!(calls.load(Ordering::Relaxed), 0);
            let stale = load_or_fetch(dir.clone(), "USD".into(), now + 1, |_| async {
                Err("offline".into())
            })
            .await
            .unwrap();
            assert!(stale.stale);
            let mut updated = value();
            updated.updated_at = 2000;
            let refreshed = load_or_fetch(dir.clone(), "USD".into(), now + 1, |_| async {
                calls.fetch_add(1, Ordering::Relaxed);
                Ok(updated)
            })
            .await
            .unwrap();
            assert!(!refreshed.stale);
            assert_eq!(refreshed.updated_at, 2000);
            assert_eq!(read(&path, "USD").unwrap().fetched_at, now + 1);
            assert!(
                load_or_fetch(dir.clone(), "EUR".into(), now, |_| async {
                    Err("offline".into())
                })
                .await
                .is_err()
            );
            std::fs::write(&path, b"broken").unwrap();
            assert!(
                load_or_fetch(dir.clone(), "USD".into(), now, |_| async {
                    Err("offline".into())
                })
                .await
                .is_err()
            );
            save(
                &path,
                &Cached {
                    fetched_at: now + 1000,
                    value: value(),
                },
            )
            .unwrap();
            assert!(
                load_or_fetch(dir.clone(), "USD".into(), now, |_| async {
                    Err("offline".into())
                })
                .await
                .unwrap()
                .stale
            );
        });
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn rejects_bad_codes_and_provider_values() {
        for bad in ["", "US", "USDD", "../USD", "ÜSD", "USD?secret=1"] {
            assert!(code(bad).is_err());
        }
        let mut invalid = value();
        invalid.rates.insert("KZT".into(), f64::NAN);
        assert!(!valid(&invalid, "USD"));
        assert!(!valid(&value(), "EUR"));
    }
}
