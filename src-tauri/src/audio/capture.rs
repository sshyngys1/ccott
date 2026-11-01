//! Bounded packet consumption and format validation, independent of WASAPI for fault injection.
use super::dsp;
use std::time::{Duration, Instant};

pub const MAX_SAMPLES: usize = 2048;
pub const MAX_PACKETS: usize = 8;

pub fn encoding(tag: u16, subtype: Option<windows::core::GUID>) -> Option<bool> {
    match tag {
        1 => Some(false),
        3 => Some(true),
        0xFFFE => match subtype? {
            id if id == windows::core::GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71) => {
                Some(true)
            }
            id if id == windows::core::GUID::from_u128(0x00000001_0000_0010_8000_00aa00389b71) => {
                Some(false)
            }
            _ => None,
        },
        _ => None,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Format {
    pub rate: u32,
    pub channels: u16,
    pub bits: u16,
    pub block_align: usize,
    pub float: bool,
}

impl Format {
    pub fn validate(
        rate: u32,
        channels: u16,
        bits: u16,
        valid_bits: u16,
        align: u16,
        average: u32,
        float: bool,
    ) -> Option<Self> {
        if !(8000..=384000).contains(&rate)
            || !(1..=32).contains(&channels)
            || (float && (bits != 32 || valid_bits != 32))
            || (!float && ![16, 24, 32].contains(&bits))
            || valid_bits == 0
            || valid_bits > bits
        {
            return None;
        }
        let expected = channels.checked_mul(bits.checked_div(8)?)?;
        if align != expected || average != rate.checked_mul(u32::from(align))? {
            return None;
        }
        Some(Self {
            rate,
            channels,
            bits,
            block_align: usize::from(align),
            float,
        })
    }

    pub fn byte_count(&self, frames: u32, buffer_frames: u32) -> Option<usize> {
        if frames == 0 || frames > buffer_frames || frames > self.rate.checked_mul(2)? {
            return None;
        }
        let bytes = (frames as usize).checked_mul(self.block_align)?;
        (bytes <= isize::MAX as usize).then_some(bytes)
    }
}

pub struct Packet {
    pub frames: usize,
    pub samples: Vec<f32>,
    pub reset: bool,
}
pub trait PacketReader {
    type Error;
    fn next_size(&mut self) -> Result<u32, Self::Error>;
    fn read(&mut self) -> Result<Packet, Self::Error>;
}

#[derive(Default)]
pub struct Samples {
    ring: Vec<f32>,
    agc: dsp::SpectrumAgc,
    last_frame: Option<Instant>,
}

impl Samples {
    fn reset(&mut self) {
        self.ring.clear();
        self.agc = dsp::SpectrumAgc::default();
        self.last_frame = None;
    }

    pub fn drain<R: PacketReader>(
        &mut self,
        reader: &mut R,
        rate: u32,
        active: impl Fn() -> bool,
    ) -> Result<Option<[f32; 4]>, R::Error> {
        let mut frames = 0usize;
        for _ in 0..MAX_PACKETS {
            if !active() {
                self.reset();
                return Ok(None);
            }
            // Errors are propagated, not confused with an empty capture queue.
            let next = match reader.next_size() {
                Ok(next) => next,
                Err(error) => {
                    self.reset();
                    return Err(error);
                }
            };
            if next == 0 {
                break;
            }
            let packet = match reader.read() {
                Ok(packet) => packet,
                Err(error) => {
                    self.reset();
                    return Err(error);
                }
            };
            if packet.frames == 0 {
                break;
            }
            frames = frames.saturating_add(packet.frames);
            if packet.reset {
                self.reset();
            }
            let samples = &packet.samples[packet.samples.len().saturating_sub(MAX_SAMPLES)..];
            let excess = (self.ring.len() + samples.len()).saturating_sub(MAX_SAMPLES);
            self.ring.drain(..excess);
            self.ring.extend_from_slice(samples);
            if frames >= rate as usize / 4 {
                break;
            }
        }
        if !active() {
            self.reset();
            return Ok(None);
        }
        if frames == 0 {
            // No new PCM is not permission to reissue the previous music with a new timestamp.
            self.reset();
        }
        let now = Instant::now();
        let elapsed = self
            .last_frame
            .replace(now)
            .map_or(Duration::from_millis(50), |last| now - last);
        Ok(Some(self.agc.process(
            dsp::calculate_spectrum_bands(&self.ring, rate),
            elapsed,
        )))
    }
}

#[derive(Default)]
pub struct EndpointTracker {
    current: Option<String>,
}
impl EndpointTracker {
    pub fn update(&mut self, current: Option<&str>) -> bool {
        if self.current.as_deref() == current {
            return false;
        }
        self.current = current.map(str::to_owned);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Reader {
        next: Result<u32, &'static str>,
        read: Result<(), &'static str>,
        calls: usize,
    }
    impl PacketReader for Reader {
        type Error = &'static str;
        fn next_size(&mut self) -> Result<u32, Self::Error> {
            self.next
        }
        fn read(&mut self) -> Result<Packet, Self::Error> {
            self.calls += 1;
            self.read?;
            Ok(Packet {
                frames: 1024,
                samples: vec![0.5; MAX_SAMPLES],
                reset: false,
            })
        }
    }

    struct SignalReader {
        packet: Option<Packet>,
    }

    impl SignalReader {
        fn sine(amplitude: f32, reset: bool) -> Self {
            Self {
                packet: Some(Packet {
                    frames: dsp::FFT_SIZE,
                    samples: (0..dsp::FFT_SIZE)
                        .map(|i| {
                            amplitude * (std::f32::consts::TAU * 100.0 * i as f32 / 48000.0).sin()
                        })
                        .collect(),
                    reset,
                }),
            }
        }
    }

    impl PacketReader for SignalReader {
        type Error = ();

        fn next_size(&mut self) -> Result<u32, Self::Error> {
            Ok(self
                .packet
                .as_ref()
                .map_or(0, |packet| packet.frames as u32))
        }

        fn read(&mut self) -> Result<Packet, Self::Error> {
            self.packet.take().ok_or(())
        }
    }

    fn signal(samples: &mut Samples, amplitude: f32, reset: bool) -> [f32; 4] {
        samples
            .drain(&mut SignalReader::sine(amplitude, reset), 48000, || true)
            .unwrap()
            .unwrap()
    }

    #[test]
    fn packet_discontinuity_and_silence_reset_agc_with_pcm() {
        let mut samples = Samples::default();
        assert_eq!(signal(&mut samples, 0.8, false)[0], 1.0);
        // A much quieter signal following a reset must not inherit the old loud reference.
        assert_eq!(signal(&mut samples, 0.008, true)[0], 1.0);
        assert_eq!(signal(&mut samples, 0.0, true), [0.0; 4]);
        assert_eq!(signal(&mut samples, 0.008, false)[0], 1.0);
        // A packet gap must clear both the previous PCM and the release envelope immediately.
        assert_eq!(
            samples.drain(&mut SignalReader { packet: None }, 48000, || true),
            Ok(Some([0.0; 4]))
        );
        assert_eq!(signal(&mut samples, 0.008, false)[0], 1.0);
        assert_eq!(
            samples.drain(&mut SignalReader::sine(0.8, false), 48000, || false),
            Ok(None)
        );
        assert_eq!(signal(&mut samples, 0.008, false)[0], 1.0);
    }

    #[test]
    fn endpoint_session_replacement_starts_with_fresh_agc() {
        let mut endpoint = EndpointTracker::default();
        assert!(endpoint.update(Some("speakers")));
        let mut samples = Samples::default();
        signal(&mut samples, 0.8, false);
        samples.last_frame = Some(Instant::now() - Duration::from_millis(500));
        assert!(signal(&mut samples, 0.008, false)[0] < 0.1);
        // LoopbackSession owns Samples; opening the changed endpoint constructs a fresh default.
        assert!(endpoint.update(Some("headphones")));
        samples = Samples::default();
        assert_eq!(signal(&mut samples, 0.008, false)[0], 1.0);
    }

    #[test]
    fn no_packets_clear_previous_pcm_and_errors_propagate() {
        let mut samples = Samples {
            ring: (0..1024).map(|i| (i as f32 / 10.0).sin()).collect(),
            ..Default::default()
        };
        let mut reader = Reader {
            next: Ok(0),
            read: Ok(()),
            calls: 0,
        };
        // Controlled ticks after a nonzero window must all remain quiet without packets.
        for _tick in [50, 100, 500, 1000] {
            assert_eq!(
                samples.drain(&mut reader, 48000, || true),
                Ok(Some([0.0; 4]))
            );
        }
        reader.next = Err("GetNextPacketSize failed");
        assert_eq!(
            samples.drain(&mut reader, 48000, || true),
            Err("GetNextPacketSize failed")
        );
        reader.next = Ok(10);
        reader.read = Err("GetBuffer failed");
        assert_eq!(
            samples.drain(&mut reader, 48000, || true),
            Err("GetBuffer failed")
        );
    }
    #[test]
    fn continuous_packets_are_bounded_and_disable_interrupts_drain() {
        let mut reader = Reader {
            next: Ok(1024),
            read: Ok(()),
            calls: 0,
        };
        let mut samples = Samples::default();
        samples.drain(&mut reader, 384000, || true).unwrap();
        assert_eq!(reader.calls, MAX_PACKETS);
        assert!(samples.ring.len() <= MAX_SAMPLES);
        assert_eq!(samples.drain(&mut reader, 48000, || false).unwrap(), None);
        assert!(samples.ring.is_empty());
    }
    #[test]
    fn format_lengths_and_still_valid_endpoint_switch_are_checked() {
        let format = Format::validate(48000, 2, 32, 32, 8, 384000, true).unwrap();
        assert_eq!(format.byte_count(100, 48000), Some(800));
        assert_eq!(format.byte_count(u32::MAX, u32::MAX), None);
        for (rate, channels, bits, valid, align, average, float) in [
            (0, 2, 32, 32, 8, 0, true),
            (48000, 0, 32, 32, 0, 0, true),
            (48000, 2, 64, 64, 16, 768000, true),
            (48000, 2, 16, 16, 8, 384000, false),
            (48000, 2, 32, 33, 8, 384000, false),
            (48000, 2, 32, 32, 8, 1, true),
        ] {
            assert!(Format::validate(rate, channels, bits, valid, align, average, float).is_none());
        }
        let mut endpoint = EndpointTracker::default();
        assert!(endpoint.update(Some("old-valid")));
        assert!(!endpoint.update(Some("old-valid")));
        // The old endpoint need not fail: a changed default still mandates reopening capture.
        assert!(endpoint.update(Some("new-valid")));
        assert!(endpoint.update(None));
        assert!(endpoint.update(Some("new-valid")));
    }

    #[test]
    fn unknown_encoding_is_not_treated_as_pcm() {
        use windows::core::GUID;
        assert_eq!(encoding(1, None), Some(false));
        assert_eq!(encoding(3, None), Some(true));
        assert_eq!(encoding(0x1234, None), None);
        assert_eq!(encoding(0xFFFE, None), None);
        assert_eq!(encoding(0xFFFE, Some(GUID::zeroed())), None);
        assert_eq!(
            encoding(
                0xFFFE,
                Some(GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71))
            ),
            Some(true)
        );
    }
}
