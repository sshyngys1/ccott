//! Pure DSP functions for computing 4-band audio spectrum. Owner: R2 (Rust-System).

use std::f32::consts::PI;

#[derive(Clone, Copy, Debug)]
struct Complex {
    re: f32,
    im: f32,
}

impl Complex {
    #[inline]
    fn new(re: f32, im: f32) -> Self {
        Self { re, im }
    }

    #[inline]
    fn add(self, other: Self) -> Self {
        Self::new(self.re + other.re, self.im + other.im)
    }

    #[inline]
    fn sub(self, other: Self) -> Self {
        Self::new(self.re - other.re, self.im - other.im)
    }

    #[inline]
    fn mul(self, other: Self) -> Self {
        Self::new(
            self.re * other.re - self.im * other.im,
            self.re * other.im + self.im * other.re,
        )
    }

    #[inline]
    fn norm_sq(self) -> f32 {
        self.re * self.re + self.im * self.im
    }
}

/// In-place radix-2 Cooley-Tukey FFT. Length of `buffer` must be a power of 2.
fn fft(buffer: &mut [Complex]) {
    let n = buffer.len();
    if n <= 1 {
        return;
    }

    // Bit-reversal permutation
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            buffer.swap(i, j);
        }
    }

    // Butterfly passes
    let mut len = 2;
    while len <= n {
        let half = len / 2;
        let angle = -2.0 * PI / (len as f32);
        let w_step = Complex::new(angle.cos(), angle.sin());

        let mut i = 0;
        while i < n {
            let mut w = Complex::new(1.0, 0.0);
            for k in 0..half {
                let u = buffer[i + k];
                let v = buffer[i + k + half].mul(w);
                buffer[i + k] = u.add(v);
                buffer[i + k + half] = u.sub(v);
                w = w.mul(w_step);
            }
            i += len;
        }
        len <<= 1;
    }
}

pub const FFT_SIZE: usize = 1024;

/// Computes 4 frequency bands [0..1] from mono PCM samples:
/// Band 0: Bass (20 - 250 Hz)
/// Band 1: Low-mids (250 - 1000 Hz)
/// Band 2: Mid-highs (1000 - 4000 Hz)
/// Band 3: Highs (4000 - 16000 Hz)
pub fn calculate_spectrum_bands(samples: &[f32], sample_rate: u32) -> [f32; 4] {
    if samples.is_empty() || sample_rate == 0 {
        return [0.0, 0.0, 0.0, 0.0];
    }

    // Prepare buffer of size FFT_SIZE (1024)
    let mut buffer = [Complex::new(0.0, 0.0); FFT_SIZE];
    let take_count = samples.len().min(FFT_SIZE);
    let start_idx = samples.len() - take_count;
    let offset = FFT_SIZE - take_count;

    // Apply Hann window and sanitize samples
    for i in 0..take_count {
        let s = samples[start_idx + i];
        let val = if s.is_finite() { s } else { 0.0 };
        let win = 0.5 * (1.0 - (2.0 * PI * (i as f32) / ((take_count - 1).max(1) as f32)).cos());
        buffer[offset + i] = Complex::new(val * win, 0.0);
    }

    fft(&mut buffer);

    let num_bins = FFT_SIZE / 2;
    let bin_freq = (sample_rate as f32) / (FFT_SIZE as f32);

    let mut band_sums = [0.0f32; 4];
    let mut band_counts = [0usize; 4];

    // Compute power across frequency bins
    for (k, sample) in buffer.iter().enumerate().take(num_bins).skip(1) {
        let freq = (k as f32) * bin_freq;
        let pwr = sample.norm_sq();

        let band_idx = if (20.0..250.0).contains(&freq) {
            Some(0)
        } else if (250.0..1000.0).contains(&freq) {
            Some(1)
        } else if (1000.0..4000.0).contains(&freq) {
            Some(2)
        } else if (4000.0..=16000.0).contains(&freq) {
            Some(3)
        } else {
            None
        };

        if let Some(idx) = band_idx {
            band_sums[idx] += pwr;
            band_counts[idx] += 1;
        }
    }

    let mut result = [0.0f32; 4];
    for i in 0..4 {
        if band_counts[i] > 0 {
            let mean_pwr = band_sums[i] / (band_counts[i] as f32);
            let rms = mean_pwr.sqrt() / (FFT_SIZE as f32 / 2.0);

            // Perceptual dynamic scaling: boost quiet signals smoothly without clipping
            // Gain factor per band to balance typical acoustic spectrum (higher frequencies have lower energy)
            let band_gain = match i {
                0 => 12.0, // Bass
                1 => 14.0, // Low-mids
                2 => 18.0, // High-mids
                3 => 24.0, // Highs
                _ => 15.0,
            };

            let scaled = (rms * band_gain).powf(0.65);
            let clamped = if scaled.is_finite() {
                scaled.clamp(0.0, 1.0)
            } else {
                0.0
            };
            result[i] = clamped;
        }
    }

    result
}

/// Parses PCM bytes from a WASAPI buffer into normalized mono f32 samples.
pub fn parse_pcm_to_mono_f32(
    data: &[u8],
    bits_per_sample: u16,
    channels: u16,
    is_float: bool,
) -> Vec<f32> {
    if data.is_empty()
        || !(1..=32).contains(&channels)
        || (is_float && bits_per_sample != 32)
        || (!is_float && ![16, 24, 32].contains(&bits_per_sample))
    {
        return Vec::new();
    }

    let bytes_per_sample = (bits_per_sample / 8) as usize;
    let bytes_per_frame = bytes_per_sample * (channels as usize);
    if bytes_per_frame == 0 || !data.len().is_multiple_of(bytes_per_frame) {
        return Vec::new();
    }

    let frame_count = (data.len() / bytes_per_frame).min(2048);
    let data = &data[data.len() - frame_count * bytes_per_frame..];
    let mut mono = Vec::with_capacity(frame_count);

    for frame_idx in 0..frame_count {
        let frame_offset = frame_idx * bytes_per_frame;
        let mut sum = 0.0f32;

        for ch in 0..(channels as usize) {
            let sample_offset = frame_offset + ch * bytes_per_sample;
            let sample_bytes = &data[sample_offset..sample_offset + bytes_per_sample];

            let sample_val = if is_float && bits_per_sample == 32 {
                let bytes: [u8; 4] = sample_bytes.try_into().unwrap_or([0; 4]);
                let f = f32::from_le_bytes(bytes);
                if f.is_finite() { f } else { 0.0 }
            } else if !is_float && bits_per_sample == 16 {
                let bytes: [u8; 2] = sample_bytes.try_into().unwrap_or([0; 2]);
                let s = i16::from_le_bytes(bytes);
                (s as f32) / 32768.0
            } else if !is_float && bits_per_sample == 24 {
                // 24-bit little endian signed int
                let b0 = sample_bytes[0] as i32;
                let b1 = (sample_bytes[1] as i32) << 8;
                let b2 = (sample_bytes[2] as i8 as i32) << 16; // sign extend
                let val = b0 | b1 | b2;
                (val as f32) / 8388608.0
            } else if !is_float && bits_per_sample == 32 {
                let bytes: [u8; 4] = sample_bytes.try_into().unwrap_or([0; 4]);
                let s = i32::from_le_bytes(bytes);
                (s as f32) / 2147483648.0
            } else {
                0.0
            };

            sum += sample_val;
        }

        mono.push((sum / (channels as f32)).clamp(-1.0, 1.0));
    }

    mono
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parser_rejects_unsupported_formats_partial_frames_and_bounds_allocations() {
        assert!(parse_pcm_to_mono_f32(&[0; 8], 64, 1, true).is_empty());
        assert!(parse_pcm_to_mono_f32(&[0; 8], 8, 1, false).is_empty());
        assert!(parse_pcm_to_mono_f32(&[0; 8], 16, 33, false).is_empty());
        assert!(parse_pcm_to_mono_f32(&[0; 3], 16, 2, false).is_empty());
        assert_eq!(
            parse_pcm_to_mono_f32(&vec![0; 40000], 16, 2, false).len(),
            2048
        );
        assert_eq!(
            parse_pcm_to_mono_f32(&2.0f32.to_le_bytes(), 32, 1, true),
            vec![1.0]
        );
    }

    #[test]
    fn silence_produces_all_zeros() {
        let silence = vec![0.0f32; 1024];
        let bands = calculate_spectrum_bands(&silence, 48000);
        assert_eq!(bands, [0.0, 0.0, 0.0, 0.0]);
    }

    #[test]
    fn sine_wave_bass_concentrates_in_band_0() {
        // 100 Hz tone at 48000 Hz sample rate
        let sample_rate = 48000;
        let mut samples = Vec::with_capacity(1024);
        for i in 0..1024 {
            let t = (i as f32) / (sample_rate as f32);
            samples.push((2.0 * PI * 100.0 * t).sin());
        }
        let bands = calculate_spectrum_bands(&samples, sample_rate);
        assert!(
            bands[0] > 0.3,
            "Band 0 (bass) should be active, got {}",
            bands[0]
        );
        assert!(bands[0] > bands[1], "Band 0 > Band 1");
        assert!(bands[0] > bands[2], "Band 0 > Band 2");
        assert!(bands[0] > bands[3], "Band 0 > Band 3");
    }

    #[test]
    fn sine_wave_low_mid_concentrates_in_band_1() {
        // 500 Hz tone at 48000 Hz
        let sample_rate = 48000;
        let mut samples = Vec::with_capacity(1024);
        for i in 0..1024 {
            let t = (i as f32) / (sample_rate as f32);
            samples.push((2.0 * PI * 500.0 * t).sin());
        }
        let bands = calculate_spectrum_bands(&samples, sample_rate);
        assert!(
            bands[1] > 0.3,
            "Band 1 (low-mid) should be active, got {}",
            bands[1]
        );
        assert!(bands[1] > bands[0]);
        assert!(bands[1] > bands[3]);
    }

    #[test]
    fn sine_wave_mid_high_concentrates_in_band_2() {
        // 2000 Hz tone at 48000 Hz
        let sample_rate = 48000;
        let mut samples = Vec::with_capacity(1024);
        for i in 0..1024 {
            let t = (i as f32) / (sample_rate as f32);
            samples.push((2.0 * PI * 2000.0 * t).sin());
        }
        let bands = calculate_spectrum_bands(&samples, sample_rate);
        assert!(
            bands[2] > 0.3,
            "Band 2 (mid-high) should be active, got {}",
            bands[2]
        );
        assert!(bands[2] > bands[0]);
        assert!(bands[2] > bands[3]);
    }

    #[test]
    fn sine_wave_high_concentrates_in_band_3() {
        // 8000 Hz tone at 48000 Hz
        let sample_rate = 48000;
        let mut samples = Vec::with_capacity(1024);
        for i in 0..1024 {
            let t = (i as f32) / (sample_rate as f32);
            samples.push((2.0 * PI * 8000.0 * t).sin());
        }
        let bands = calculate_spectrum_bands(&samples, sample_rate);
        assert!(
            bands[3] > 0.3,
            "Band 3 (high) should be active, got {}",
            bands[3]
        );
        assert!(bands[3] > bands[0]);
        assert!(bands[3] > bands[1]);
    }

    #[test]
    fn handles_nan_and_inf_safely() {
        let mut samples = vec![0.0f32; 512];
        samples[10] = f32::NAN;
        samples[20] = f32::INFINITY;
        samples[30] = f32::NEG_INFINITY;
        let bands = calculate_spectrum_bands(&samples, 48000);
        for b in bands {
            assert!(b.is_finite(), "Band must be finite, got {b}");
            assert!(
                (0.0..=1.0).contains(&b),
                "Band must be within 0..1, got {b}"
            );
        }
    }

    #[test]
    fn parses_float32_stereo() {
        // Two stereo frames of 32-bit float:
        // Frame 0: Left = 0.5, Right = 0.5 -> Mono = 0.5
        // Frame 1: Left = -1.0, Right = 0.0 -> Mono = -0.5
        let f0_l = 0.5f32.to_ne_bytes();
        let f0_r = 0.5f32.to_ne_bytes();
        let f1_l = (-1.0f32).to_ne_bytes();
        let f1_r = 0.0f32.to_ne_bytes();

        let mut data = Vec::new();
        data.extend_from_slice(&f0_l);
        data.extend_from_slice(&f0_r);
        data.extend_from_slice(&f1_l);
        data.extend_from_slice(&f1_r);

        let mono = parse_pcm_to_mono_f32(&data, 32, 2, true);
        assert_eq!(mono.len(), 2);
        assert!((mono[0] - 0.5).abs() < 1e-6);
        assert!((mono[1] - (-0.5)).abs() < 1e-6);
    }

    #[test]
    fn parses_pcm16_stereo() {
        // Frame 0: Left = 16384 (0.5), Right = 16384 (0.5) -> Mono = 0.5
        let s0_l = 16384i16.to_ne_bytes();
        let s0_r = 16384i16.to_ne_bytes();
        let mut data = Vec::new();
        data.extend_from_slice(&s0_l);
        data.extend_from_slice(&s0_r);

        let mono = parse_pcm_to_mono_f32(&data, 16, 2, false);
        assert_eq!(mono.len(), 1);
        assert!((mono[0] - 0.5).abs() < 1e-4);
    }
}
