//! Volume conversions (pure).

/// UI percent (0..100, may be fractional) → Core Audio scalar (0.0..=1.0). Out-of-range values are
/// clamped; NaN is rejected.
pub fn percent_to_scalar(percent: f64) -> Result<f32, String> {
    if percent.is_nan() {
        return Err("volume is not a number".into());
    }
    Ok((percent.clamp(0.0, 100.0) / 100.0) as f32)
}

/// Core Audio scalar → whole percent 0..=100.
pub fn scalar_to_percent(scalar: f32) -> u8 {
    if scalar.is_nan() {
        return 0;
    }
    (scalar.clamp(0.0, 1.0) * 100.0).round() as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percent_is_clamped() {
        assert_eq!(percent_to_scalar(50.0).unwrap(), 0.5);
        assert_eq!(percent_to_scalar(-10.0).unwrap(), 0.0);
        assert_eq!(percent_to_scalar(250.0).unwrap(), 1.0);
        assert_eq!(percent_to_scalar(f64::INFINITY).unwrap(), 1.0);
        assert!(percent_to_scalar(f64::NAN).is_err());
    }

    #[test]
    fn scalar_rounds_to_percent() {
        assert_eq!(scalar_to_percent(0.0), 0);
        assert_eq!(scalar_to_percent(1.0), 100);
        assert_eq!(scalar_to_percent(0.504), 50);
        assert_eq!(scalar_to_percent(0.376), 38);
        assert_eq!(scalar_to_percent(2.0), 100);
        assert_eq!(scalar_to_percent(-1.0), 0);
        assert_eq!(scalar_to_percent(f32::NAN), 0);
    }

    #[test]
    fn roundtrip_is_stable_for_all_percents() {
        for p in 0..=100u8 {
            let s = percent_to_scalar(f64::from(p)).unwrap();
            assert_eq!(scalar_to_percent(s), p);
        }
    }
}
