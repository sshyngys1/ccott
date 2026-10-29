//! Bounded packet consumption and format validation, independent of WASAPI for fault injection.
use super::dsp;

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
}

impl Samples {
    pub fn drain<R: PacketReader>(
        &mut self,
        reader: &mut R,
        rate: u32,
        active: impl Fn() -> bool,
    ) -> Result<Option<[f32; 4]>, R::Error> {
        let mut frames = 0usize;
        for _ in 0..MAX_PACKETS {
            if !active() {
                self.ring.clear();
                return Ok(None);
            }
            // Errors are propagated, not confused with an empty capture queue.
            let next = match reader.next_size() {
                Ok(next) => next,
                Err(error) => {
                    self.ring.clear();
                    return Err(error);
                }
            };
            if next == 0 {
                break;
            }
            let packet = match reader.read() {
                Ok(packet) => packet,
                Err(error) => {
                    self.ring.clear();
                    return Err(error);
                }
            };
            if packet.frames == 0 {
                break;
            }
            frames = frames.saturating_add(packet.frames);
            if packet.reset {
                self.ring.clear();
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
            self.ring.clear();
            return Ok(None);
        }
        if frames == 0 {
            // No new PCM is not permission to reissue the previous music with a new timestamp.
            self.ring.clear();
        }
        Ok(Some(dsp::calculate_spectrum_bands(&self.ring, rate)))
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
    #[test]
    fn no_packets_clear_previous_pcm_and_errors_propagate() {
        let mut samples = Samples {
            ring: (0..1024).map(|i| (i as f32 / 10.0).sin()).collect(),
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
