use super::model::*;
use serde::Deserialize;
use serde_json::Value;

const INVALID: &str = "Weather provider returned incomplete data.";
fn number(v: &Value, key: &str) -> Result<f64, String> {
    v[key]
        .as_f64()
        .filter(|v| v.is_finite())
        .ok_or_else(|| INVALID.into())
}
fn at(v: &Value, key: &str, i: usize) -> Result<f64, String> {
    v[key][i]
        .as_f64()
        .filter(|v| v.is_finite())
        .ok_or_else(|| INVALID.into())
}
fn code(v: &Value, key: &str, i: usize) -> Result<WeatherCode, String> {
    wmo(v[key][i]
        .as_u64()
        .and_then(|n| u16::try_from(n).ok())
        .ok_or(INVALID)?)
}
fn probability(v: &Value, key: &str, i: usize) -> Option<f64> {
    v[key][i].as_f64().filter(|n| (0.0..=100.0).contains(n))
}

// Gregorian civil date from Unix days (including the provider's local UTC offset).
fn date(seconds: i64) -> String {
    let z = seconds.div_euclid(86400) + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    y += i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

pub fn parse(v: Value, location: WeatherLocation) -> Result<WeatherReport, String> {
    let current = &v["current"];
    let now = current["time"].as_i64().ok_or(INVALID)?;
    let mut report = WeatherReport {
        location,
        updated_at: now * 1000,
        now: WeatherNow {
            temp_c: number(current, "temperature_2m")?,
            feels_like_c: number(current, "apparent_temperature")?,
            code: wmo(current["weather_code"]
                .as_u64()
                .and_then(|n| u16::try_from(n).ok())
                .ok_or(INVALID)?)?,
            is_day: current["is_day"].as_u64().ok_or(INVALID)? == 1,
            wind_kmh: number(current, "wind_speed_10m")?,
            humidity: number(current, "relative_humidity_2m")?,
        },
        hours: vec![],
        days: vec![],
        precip_in_min: None,
        precip_kind: None,
        stale: false,
    };
    if !(0.0..=100.0).contains(&report.now.humidity) || report.now.wind_kmh < 0.0 {
        return Err(INVALID.into());
    }
    let hourly = &v["hourly"];
    for (i, time) in hourly["time"].as_array().ok_or(INVALID)?.iter().enumerate() {
        let time = time.as_i64().ok_or(INVALID)?;
        if time < now.div_euclid(3600) * 3600 {
            continue;
        }
        report.hours.push(WeatherHour {
            time: time * 1000,
            temp_c: at(hourly, "temperature_2m", i)?,
            code: code(hourly, "weather_code", i)?,
            precip_prob: probability(hourly, "precipitation_probability", i),
        });
        if report.hours.len() == 24 {
            break;
        }
    }
    let daily = &v["daily"];
    let offset = v["utc_offset_seconds"].as_i64().ok_or(INVALID)?;
    for (i, time) in daily["time"]
        .as_array()
        .ok_or(INVALID)?
        .iter()
        .take(7)
        .enumerate()
    {
        report.days.push(WeatherDay {
            date: date(time.as_i64().ok_or(INVALID)? + offset),
            min_c: at(daily, "temperature_2m_min", i)?,
            max_c: at(daily, "temperature_2m_max", i)?,
            code: code(daily, "weather_code", i)?,
            precip_prob: probability(daily, "precipitation_probability_max", i),
        });
    }
    let minutes = &v["minutely_15"];
    for (i, time) in minutes["time"]
        .as_array()
        .ok_or(INVALID)?
        .iter()
        .enumerate()
    {
        // Precipitation is the preceding 15-minute sum; an overlapping interval means already raining.
        let end = time.as_i64().ok_or(INVALID)?;
        if end < now || end - 900 > now + 7200 {
            continue;
        }
        if at(minutes, "precipitation", i)? >= 0.1 {
            report.precip_in_min = Some(((end - 900 - now).max(0) / 60) as u32);
            let hour = hourly["time"]
                .as_array()
                .ok_or(INVALID)?
                .iter()
                .position(|t| {
                    t.as_i64()
                        .is_some_and(|t| t <= end - 900 && t + 3600 > end - 900)
                });
            let snow = hour.is_some_and(|h| {
                code(hourly, "weather_code", h).is_ok_and(|c| c == WeatherCode::Snow)
                    || at(hourly, "temperature_2m", h).is_ok_and(|t| t <= 0.0)
            });
            report.precip_kind = Some(if snow { "snow" } else { "rain" }.into());
            break;
        }
    }
    if report.hours.len() != 24 || report.days.len() != 7 {
        return Err(INVALID.into());
    }
    Ok(report)
}

async fn json(
    client: &reqwest::Client,
    url: &str,
    query: &[(&str, String)],
) -> Result<Value, String> {
    let mut url = reqwest::Url::parse(url).map_err(|_| INVALID)?;
    url.query_pairs_mut()
        .extend_pairs(query.iter().map(|(k, v)| (*k, v)));
    let mut response = client
        .get(url)
        .header(
            reqwest::header::USER_AGENT,
            concat!(
                "CCOTT/",
                env!("CARGO_PKG_VERSION"),
                " (+https://github.com/sshyngys1/ccott)"
            ),
        )
        .send()
        .await
        .map_err(|_| "Weather service is unavailable. Check your internet connection.")?
        .error_for_status()
        .map_err(|_| "Weather service rejected the request.")?;
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| INVALID)? {
        if body.len() + chunk.len() > 512 * 1024 {
            return Err(INVALID.into());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| INVALID.into())
}
pub async fn fetch(
    client: &reqwest::Client,
    location: WeatherLocation,
) -> Result<WeatherReport, String> {
    let q = [
        ("latitude", location.lat.to_string()), ("longitude", location.lon.to_string()),
        ("current", "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m".into()),
        ("hourly", "temperature_2m,weather_code,precipitation_probability".into()),
        ("daily", "temperature_2m_min,temperature_2m_max,weather_code,precipitation_probability_max".into()),
        ("minutely_15", "precipitation".into()), ("forecast_minutely_15", "10".into()),
        ("forecast_hours", "24".into()), ("forecast_days", "7".into()),
        ("timezone", "auto".into()), ("timeformat", "unixtime".into()),
    ];
    parse(
        json(client, "https://api.open-meteo.com/v1/forecast", &q).await?,
        location,
    )
}

#[derive(Deserialize)]
struct Search {
    #[serde(default)]
    results: Vec<City>,
}
#[derive(Deserialize)]
struct City {
    name: String,
    latitude: f64,
    longitude: f64,
    country: Option<String>,
    admin1: Option<String>,
}
pub async fn search(
    client: &reqwest::Client,
    query: String,
    lang: String,
) -> Result<Vec<WeatherLocation>, String> {
    if !matches!(lang.as_str(), "ru" | "en") {
        return Err("Unsupported location search language.".into());
    }
    let query = query.trim();
    if query.chars().count() < 2 {
        return Ok(vec![]);
    }
    if query.chars().count() > 120 {
        return Err("Location search is too long.".into());
    }
    let value = json(
        client,
        "https://geocoding-api.open-meteo.com/v1/search",
        &[
            ("name", query.into()),
            ("language", lang),
            ("count", "8".into()),
        ],
    )
    .await?;
    let cities: Search = serde_json::from_value(value).map_err(|_| INVALID)?;
    Ok(cities
        .results
        .into_iter()
        .take(8)
        .map(|city| {
            let mut names = vec![city.name];
            for part in [city.admin1, city.country].into_iter().flatten() {
                if !names.contains(&part) {
                    names.push(part);
                }
            }
            WeatherLocation {
                name: names.join(", ").chars().take(120).collect(),
                lat: city.latitude,
                lon: city.longitude,
            }
        })
        .filter(WeatherLocation::valid)
        .collect())
}
