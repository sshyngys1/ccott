use serde::{Deserialize, Serialize};

#[derive(Clone, PartialEq, Serialize, Deserialize)]
pub struct WeatherLocation {
    pub name: String,
    pub lat: f64,
    pub lon: f64,
}

// Settings are debug-logged elsewhere; never expose coordinates through Debug.
impl std::fmt::Debug for WeatherLocation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("WeatherLocation(<private>)")
    }
}

impl WeatherLocation {
    pub fn valid(&self) -> bool {
        self.lat.is_finite()
            && (-90.0..=90.0).contains(&self.lat)
            && self.lon.is_finite()
            && (-180.0..=180.0).contains(&self.lon)
            && (1..=120).contains(&self.name.chars().count())
            && !self.name.trim().is_empty()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WeatherCode {
    Clear,
    Partly,
    Cloudy,
    Fog,
    Drizzle,
    Rain,
    Snow,
    Sleet,
    Thunder,
}

pub fn wmo(code: u16) -> Result<WeatherCode, String> {
    use WeatherCode::*;
    Ok(match code {
        0 => Clear,
        1 | 2 => Partly,
        3 => Cloudy,
        45 | 48 => Fog,
        51 | 53 | 55 => Drizzle,
        56 | 57 | 66 | 67 => Sleet,
        61 | 63 | 65 | 80..=82 => Rain,
        71 | 73 | 75 | 77 | 85 | 86 => Snow,
        95 | 96 | 99 => Thunder,
        _ => return Err("Invalid weather code.".into()),
    })
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherNow {
    pub temp_c: f64,
    pub feels_like_c: f64,
    pub code: WeatherCode,
    pub is_day: bool,
    pub wind_kmh: f64,
    pub humidity: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherHour {
    pub time: i64,
    pub temp_c: f64,
    pub code: WeatherCode,
    pub precip_prob: Option<f64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherDay {
    pub date: String,
    pub min_c: f64,
    pub max_c: f64,
    pub code: WeatherCode,
    pub precip_prob: Option<f64>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherReport {
    pub location: WeatherLocation,
    pub updated_at: i64,
    pub now: WeatherNow,
    pub hours: Vec<WeatherHour>,
    pub days: Vec<WeatherDay>,
    pub precip_in_min: Option<u32>,
    pub precip_kind: Option<String>,
    pub stale: bool,
}
