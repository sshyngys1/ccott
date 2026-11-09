//! Track metadata clean-up before a lookup, and tolerant comparison of names (case, diacritics, punctuation).

/// First words of a "decoration" of a title: `(feat. X)`, `- Remastered 2011`, `(Explicit)`, ...
const DECORATIONS: &[&str] = &[
    "feat",
    "ft",
    "featuring",
    "with",
    "single",
    "explicit",
    "clean",
    "live",
    "deluxe",
    "bonus",
    "mono",
    "stereo",
    "from",
    "radio",
    "album",
    "original",
    "version",
    "edit",
];

fn is_decoration(text: &str) -> bool {
    let t = text.trim().to_lowercase();
    let first = t
        .split(|c: char| !c.is_alphabetic())
        .next()
        .unwrap_or_default();
    t.contains("remaster") || DECORATIONS.contains(&first)
}

/// Removes every `(...)` / `[...]` group that is a decoration (feat., remaster, explicit, live, ...).
fn strip_groups(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let chars: Vec<char> = s.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let close = match chars[i] {
            '(' => Some(')'),
            '[' => Some(']'),
            _ => None,
        };
        if let Some(close) = close
            && let Some(len) = chars[i + 1..].iter().position(|c| *c == close)
        {
            let inner: String = chars[i + 1..i + 1 + len].iter().collect();
            if is_decoration(&inner) {
                i += len + 2;
                continue;
            }
        }
        out.push(chars[i]);
        i += 1;
    }
    out
}

/// Byte index of the first occurrence of the ASCII `needle` in `s`, comparing ASCII case-insensitively
/// char by char. The index always belongs to `s` itself (lower-casing a copy can change byte lengths).
fn find_ci(s: &str, needle: &str) -> Option<usize> {
    s.char_indices().map(|(i, _)| i).find(|&i| {
        let mut hay = s[i..].chars();
        needle
            .chars()
            .all(|n| hay.next().is_some_and(|h| h.eq_ignore_ascii_case(&n)))
    })
}

/// Cut position of a " - Suffix" that is a known decoration (remaster, live recording, single / radio
/// version, explicit / clean, deluxe, bonus, mono / stereo, feat.). Other dashes are part of the name.
fn dash_decoration_start(s: &str) -> Option<usize> {
    s.match_indices(" - ").map(|(pos, _)| pos).find(|&pos| {
        let tail = &s[pos + 3..];
        // Only the segment up to the next dash is judged.
        let segment = tail.find(" - ").map_or(tail, |end| &tail[..end]);
        let rest = segment.trim().to_lowercase();
        let words: Vec<&str> = rest
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
            .collect();
        let first = words.first().copied().unwrap_or_default();
        let second = words.get(1).copied().unwrap_or_default();
        rest.contains("remaster")
            || match first {
                "single" | "explicit" | "clean" | "deluxe" | "bonus" | "mono" | "stereo"
                | "feat" | "ft" | "featuring" => true,
                "live" => matches!(
                    second,
                    "" | "at"
                        | "from"
                        | "in"
                        | "on"
                        | "version"
                        | "session"
                        | "performance"
                        | "acoustic"
                ),
                "radio" => matches!(second, "edit" | "version" | "mix"),
                "album" | "original" => second == "version",
                _ => false,
            }
    })
}

fn collapse(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Title for the lookup: no feat./remaster/explicit/live/single decorations, single spaces.
pub fn clean_title(title: &str) -> String {
    let mut t = strip_groups(title);
    // " - Remastered 2011", " - Single", " - Live at ...": only a known decoration after the dash is cut.
    if let Some(pos) = dash_decoration_start(&t) {
        t.truncate(pos);
    }
    // A trailing "feat. X" / "ft. X" without brackets.
    let cut = [" feat. ", " feat ", " ft. ", " ft ", " featuring "]
        .iter()
        .filter_map(|marker| find_ci(&t, marker))
        .min();
    if let Some(pos) = cut {
        t.truncate(pos);
    }
    let cleaned = collapse(&t);
    if cleaned.is_empty() {
        collapse(title)
    } else {
        cleaned
    }
}

/// Album for the lookup: decorations such as "(Deluxe)" removed.
pub fn clean_album(album: &str) -> String {
    let mut t = strip_groups(album);
    if let Some(pos) = dash_decoration_start(&t) {
        t.truncate(pos);
    }
    collapse(&t)
}

/// First artist of "A, B", "A & B", "A feat. B", "A x B", "A; B", "A and B" lists.
pub fn first_artist(artist: &str) -> String {
    let a = collapse(&strip_groups(artist));
    let end = [
        ",",
        ";",
        " & ",
        " feat. ",
        " feat ",
        " ft. ",
        " ft ",
        " featuring ",
        " x ",
        " × ",
        " with ",
        " and ",
        " + ",
    ]
    .iter()
    .filter_map(|sep| find_ci(&a, sep))
    .min()
    .unwrap_or(a.len());
    let first = collapse(&a[..end]);
    if first.is_empty() { a } else { first }
}

fn fold_char(c: char) -> Option<char> {
    const TABLE: &[(&str, char)] = &[
        ("àáâãäåāăą", 'a'),
        ("çćĉċč", 'c'),
        ("ďđ", 'd'),
        ("èéêëēĕėęě", 'e'),
        ("ĝğġģ", 'g'),
        ("ìíîïĩīĭįı", 'i'),
        ("ĺļľł", 'l'),
        ("ñńņň", 'n'),
        ("òóôõöøōŏő", 'o'),
        ("ŕŗř", 'r'),
        ("śŝşš", 's'),
        ("ţťŧ", 't'),
        ("ùúûüũūŭůűų", 'u'),
        ("ýÿŷ", 'y'),
        ("źżž", 'z'),
        ("ё", 'е'),
        ("й", 'и'),
    ];
    let lower = c.to_lowercase().next().unwrap_or(c);
    if lower.is_alphanumeric() {
        Some(
            TABLE
                .iter()
                .find(|(set, _)| set.contains(lower))
                .map_or(lower, |(_, base)| *base),
        )
    } else if lower.is_whitespace() || "&+".contains(lower) {
        Some(' ')
    } else {
        None // punctuation vanishes: "Don't" == "Dont", "A.B." == "AB"
    }
}

/// Comparison form: lower-case, diacritics and punctuation removed, single spaces.
pub fn fold(s: &str) -> String {
    collapse(&s.chars().filter_map(fold_char).collect::<String>())
}

/// How well `candidate` matches `wanted`: 2 = same after folding, 1 = one contains the other
/// (at least 3 characters), 0 = unrelated.
pub fn similarity(wanted: &str, candidate: &str) -> u8 {
    let (a, b) = (fold(wanted), fold(candidate));
    if a.is_empty() || b.is_empty() {
        return 0;
    }
    if a == b {
        2
    } else if a.chars().count() >= 3 && b.chars().count() >= 3 && (a.contains(&b) || b.contains(&a))
    {
        1
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titles_lose_decorations() {
        for (raw, want) in [
            ("Night Signal (feat. Someone)", "Night Signal"),
            ("Night Signal [feat. Someone Else]", "Night Signal"),
            ("Night Signal (Feat. A & B)", "Night Signal"),
            ("Night Signal ft. Someone", "Night Signal"),
            ("Night Signal (ft. Someone) (Explicit)", "Night Signal"),
            ("Night Signal - Remastered 2011", "Night Signal"),
            ("Night Signal (2011 Remaster)", "Night Signal"),
            ("Night Signal (Remastered)", "Night Signal"),
            ("Night Signal - 2009 Remaster", "Night Signal"),
            ("Night Signal - Single", "Night Signal"),
            ("Night Signal - Single Version", "Night Signal"),
            ("Night Signal (Explicit)", "Night Signal"),
            ("Night Signal [Clean]", "Night Signal"),
            ("Night Signal - Live at Some Hall", "Night Signal"),
            ("Night Signal (Live)", "Night Signal"),
            ("Night Signal (Radio Edit)", "Night Signal"),
            ("Night Signal (with Someone)", "Night Signal"),
            ("  Night   Signal  ", "Night Signal"),
            ("Night Signal (feat. A) - Remastered 2020", "Night Signal"),
            ("Night Signal - Deluxe Edition", "Night Signal"),
            // Real parts of a title stay.
            ("Night Signal (Part 2)", "Night Signal (Part 2)"),
            ("Night Signal - Part Two", "Night Signal - Part Two"),
            ("Liverpool Lights", "Liverpool Lights"),
            ("Alive (Reprise)", "Alive (Reprise)"),
            ("Не спеши (feat. Кто-то)", "Не спеши"),
            ("Clean Slate", "Clean Slate"),
        ] {
            assert_eq!(clean_title(raw), want, "{raw}");
        }
    }

    #[test]
    fn dashes_that_are_part_of_the_name_stay() {
        for name in [
            "Night Signal - Part Two",
            "Re-Entry - Live Wire",
            "Alone - Together Again",
            "Time - The Reckoning",
            "Single Ladies - Dance Floor",
            "Song - Radio Silence",
            "A - B - C",
        ] {
            assert_eq!(clean_title(name), name, "{name}");
        }
        // Known suffixes are cut even after a name with a real dash.
        assert_eq!(
            clean_title("Re-Entry - Live Wire - Remastered 2011"),
            "Re-Entry - Live Wire"
        );
        assert_eq!(
            clean_title("Alone - Together - Single Version"),
            "Alone - Together"
        );
        assert_eq!(clean_title("Night Signal - Radio Edit"), "Night Signal");
        assert_eq!(clean_title("Night Signal - Live"), "Night Signal");
        assert_eq!(clean_title("Night Signal - Explicit"), "Night Signal");
        assert_eq!(
            clean_album("Night Shift - Part Two"),
            "Night Shift - Part Two"
        );
    }

    #[test]
    fn case_changing_characters_before_a_marker_do_not_panic_or_misalign() {
        // Lower-casing these changes the byte length: offsets of a lowered copy would be wrong.
        for (raw, want) in [
            ("İstanbul Nights ft. Guest", "İstanbul Nights"),
            ("STRAẞE feat. Guest", "STRAẞE"),
            ("ẞẞẞ Signal (feat. A) ft. B", "ẞẞẞ Signal"),
            ("İİİ Night FEATURING Someone", "İİİ Night"),
            ("Straße - Remastered 2011", "Straße"),
            ("İ - Part Two", "İ - Part Two"),
        ] {
            assert_eq!(clean_title(raw), want, "{raw}");
        }
        for (raw, want) in [
            ("İstanbul Band feat. Guest", "İstanbul Band"),
            ("ẞẞ Collective, Other", "ẞẞ Collective"),
            ("İİİ & Friends", "İİİ"),
            ("STRAẞE X Guest", "STRAẞE"),
            ("Ǆ Crew Ft. Guest", "Ǆ Crew"),
        ] {
            assert_eq!(first_artist(raw), want, "{raw}");
        }
    }

    #[test]
    fn a_title_that_is_only_decoration_is_kept() {
        assert_eq!(clean_title("(Explicit)"), "(Explicit)");
        assert_eq!(clean_title("  "), "");
    }

    #[test]
    fn artists_become_the_first_one() {
        for (raw, want) in [
            ("Some Artist", "Some Artist"),
            ("Some Artist, Other One", "Some Artist"),
            ("Some Artist & Other One", "Some Artist"),
            ("Some Artist feat. Other One", "Some Artist"),
            ("Some Artist Feat. Other One", "Some Artist"),
            ("Some Artist ft. Other One", "Some Artist"),
            ("Some Artist x Other One", "Some Artist"),
            ("Some Artist × Other One", "Some Artist"),
            ("Some Artist; Other One", "Some Artist"),
            ("Some Artist (feat. Other One)", "Some Artist"),
            ("Some Artist and Other One", "Some Artist"),
            ("  Some   Artist ", "Some Artist"),
            ("Xavier", "Xavier"),
            ("AC/DC", "AC/DC"),
            ("Артист, Другой", "Артист"),
        ] {
            assert_eq!(first_artist(raw), want, "{raw}");
        }
    }

    #[test]
    fn albums_lose_edition_suffixes() {
        assert_eq!(clean_album("Night Shift (Deluxe)"), "Night Shift");
        assert_eq!(clean_album("Night Shift - Remastered 2015"), "Night Shift");
        assert_eq!(clean_album("Night Shift"), "Night Shift");
    }

    #[test]
    fn folding_ignores_case_diacritics_and_punctuation() {
        assert_eq!(fold("Beyoncé"), "beyonce");
        assert_eq!(fold("Don't  Stop!"), "dont stop");
        assert_eq!(fold("Ёлка — Й"), "елка и");
        assert_eq!(fold("A&B"), "a b");
        assert_eq!(similarity("Night Signal", "NIGHT SIGNAL!"), 2);
        assert_eq!(similarity("Café Noir", "cafe noir"), 2);
        assert_eq!(similarity("Night Signal", "Night Signal (Live Version)"), 1);
        assert_eq!(similarity("Night Signal", "Other Song"), 0);
        assert_eq!(similarity("ab", "abc"), 0, "too short to be a fuzzy match");
        assert_eq!(similarity("", "x"), 0);
    }
}
