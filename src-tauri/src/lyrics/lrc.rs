//! LRC parsing: `[mm:ss.xx]text`, several tags per line, `[offset:±ms]`.

use super::LyricsLine;

const MAX_LINES: usize = 3000;

/// `mm:ss`, `mm:ss.f`, `mm:ss.ff`, `mm:ss.fff` (also `mm:ss:ff`) → milliseconds.
fn timestamp(tag: &str) -> Option<i64> {
    let (min, rest) = tag.split_once(':')?;
    if min.is_empty() || min.len() > 4 || !min.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (sec, frac) = match rest.find(['.', ':']) {
        Some(i) => (&rest[..i], &rest[i + 1..]),
        None => (rest, ""),
    };
    if sec.is_empty() || sec.len() > 2 || !sec.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if !frac.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let mut ms = 0i64;
    let mut scale = 100;
    for b in frac.bytes().take(3) {
        ms += i64::from(b - b'0') * scale;
        scale /= 10;
    }
    Some(min.parse::<i64>().ok()? * 60_000 + sec.parse::<i64>().ok()? * 1000 + ms)
}

/// Removes enhanced-LRC word tags such as `<00:12.30>`.
fn strip_word_tags(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('<') {
        match rest[start..].find('>') {
            Some(end) if timestamp(&rest[start + 1..start + end]).is_some() => {
                out.push_str(&rest[..start]);
                rest = &rest[start + end + 1..];
            }
            _ => {
                out.push_str(&rest[..=start]);
                rest = &rest[start + 1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Parses an LRC document. Lines without a time tag are skipped (metadata, comments).
/// An empty text keeps its line: it marks an instrumental break. Sorted by time (stable).
pub fn parse(lrc: &str) -> Vec<LyricsLine> {
    let mut offset = 0i64;
    let mut lines: Vec<LyricsLine> = Vec::new();
    for raw in lrc.lines() {
        let mut rest = raw.trim_start_matches('\u{feff}').trim_start();
        let mut times: Vec<i64> = Vec::new();
        while let Some(body) = rest.strip_prefix('[') {
            let Some(end) = body.find(']') else { break };
            let tag = &body[..end];
            if let Some(t) = timestamp(tag) {
                times.push(t);
            } else if let Some(value) = tag
                .strip_prefix("offset:")
                .or_else(|| tag.strip_prefix("Offset:"))
                .or_else(|| tag.strip_prefix("OFFSET:"))
            {
                if let Ok(v) = value.trim().parse::<i64>() {
                    offset = v;
                }
            } else if !tag.contains(':') {
                break;
            }
            rest = body[end + 1..].trim_start();
        }
        if times.is_empty() {
            continue;
        }
        let text = strip_word_tags(rest).trim().to_string();
        for t in times {
            if lines.len() >= MAX_LINES {
                break;
            }
            lines.push(LyricsLine {
                time_ms: t,
                text: text.clone(),
            });
        }
    }
    if offset != 0 {
        // LRC: a positive offset makes the lyrics appear sooner.
        for line in &mut lines {
            line.time_ms = (line.time_ms - offset).max(0);
        }
    }
    lines.sort_by_key(|l| l.time_ms);
    lines
}
