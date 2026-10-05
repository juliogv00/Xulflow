use crate::settings::{DictionaryEntry, SnippetEntry};
use natural::phonetics::soundex;
use once_cell::sync::Lazy;
use regex::Regex;
use strsim::levenshtein;

/// Builds an n-gram string by cleaning and concatenating words
///
/// Strips punctuation from each word, lowercases, and joins without spaces.
/// This allows matching "Charge B" against "ChargeBee".
fn build_ngram(words: &[&str]) -> String {
    words
        .iter()
        .map(|w| build_match_key(w))
        .collect::<Vec<_>>()
        .concat()
}

fn build_match_key(word: &str) -> String {
    word.chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(|c| c.to_lowercase())
        .collect()
}

struct CustomWordMatchKey {
    word_index: usize,
    key: String,
}

fn build_custom_word_match_keys(word: &str, word_index: usize) -> Vec<CustomWordMatchKey> {
    let primary_key = build_match_key(word);
    let mut keys = Vec::with_capacity(2);

    // The fallback matcher is intentionally limited to ASCII terms. Its
    // whitespace tokenization and Soundex scoring are not suitable for CJK
    // scripts. Unicode custom words remain available to models that accept
    // them as native decode prompts; they are simply skipped by this fallback.
    if is_supported_fuzzy_key(&primary_key) {
        keys.push(CustomWordMatchKey {
            word_index,
            key: primary_key.clone(),
        });
    }

    if word.contains('&') {
        let expanded_key = build_match_key(&word.replace('&', " and "));
        if is_supported_fuzzy_key(&expanded_key) && expanded_key != primary_key {
            keys.push(CustomWordMatchKey {
                word_index,
                key: expanded_key,
            });
        }
    }

    keys
}

fn is_supported_fuzzy_key(key: &str) -> bool {
    !key.is_empty() && key.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Largest normalized edit distance that may still receive the Soundex boost.
/// Covers genuine mishearings ("chargeb" → "chargebee" = 0.22) while rejecting
/// unrelated words that merely share a Soundex code ("queno" → "qwen" = 0.4).
const MAX_PHONETIC_EDIT_SCORE: f64 = 0.34;

fn supports_soundex(key: &str) -> bool {
    !key.is_empty() && key.chars().all(|c| c.is_ascii_alphabetic())
}

/// Finds the best matching custom word for a candidate string
///
/// Uses Levenshtein distance and Soundex phonetic matching to find
/// the best match above the given threshold.
///
/// # Arguments
/// * `candidate` - The cleaned/lowercased candidate string to match
/// * `custom_words` - Original custom words (for returning the replacement)
/// * `custom_word_match_keys` - Normalized custom-word keys for comparison
/// * `threshold` - Maximum similarity score to accept
///
/// # Returns
/// The best matching custom word and its score, if any match was found
fn find_best_match<'a>(
    candidate: &str,
    custom_words: &'a [String],
    custom_word_match_keys: &[CustomWordMatchKey],
    threshold: f64,
) -> Option<(&'a String, f64)> {
    if !is_supported_fuzzy_key(candidate) || candidate.chars().count() > 50 {
        return None;
    }

    let mut best_match: Option<&String> = None;
    let mut best_score = f64::MAX;

    for custom_word_key in custom_word_match_keys {
        // Skip if lengths are too different (optimization + prevents over-matching)
        // Use percentage-based check: max 25% length difference (prevents n-grams from
        // matching significantly shorter custom words, e.g., "openaigpt" vs "openai")
        let candidate_len = candidate.chars().count();
        let custom_word_len = custom_word_key.key.chars().count();
        let len_diff = candidate_len.abs_diff(custom_word_len) as f64;
        let max_len = candidate_len.max(custom_word_len) as f64;
        let max_allowed_diff = (max_len * 0.25).max(2.0); // At least 2 chars difference allowed
        if len_diff > max_allowed_diff {
            continue;
        }

        // Calculate Levenshtein distance (normalized by length)
        let levenshtein_dist = levenshtein(candidate, &custom_word_key.key);
        let levenshtein_score = if max_len > 0.0 {
            levenshtein_dist as f64 / max_len
        } else {
            1.0
        };

        // Soundex is an English/ASCII phonetic algorithm. Numeric terms can
        // still use edit distance, but must not receive a phonetic boost.
        let phonetic_match = supports_soundex(candidate)
            && supports_soundex(&custom_word_key.key)
            && soundex(candidate, &custom_word_key.key);

        // Combine scores: favor phonetic matches, but also consider string similarity.
        // Soundex is coarse and English-centric, so the boost only applies when
        // the spelling is already plausibly close: without this cap, Spanish
        // "que no" ("queno", Q500) became "Qwen" (Q500) at a 0.4 edit score.
        let combined_score = if phonetic_match && levenshtein_score <= MAX_PHONETIC_EDIT_SCORE {
            levenshtein_score * 0.3 // Give significant boost to phonetic matches
        } else {
            levenshtein_score
        };

        // Accept if the score is good enough (configurable threshold)
        if combined_score < threshold && combined_score < best_score {
            best_match = Some(&custom_words[custom_word_key.word_index]);
            best_score = combined_score;
        }
    }

    best_match.map(|m| (m, best_score))
}

/// Applies custom word corrections to transcribed text using fuzzy matching
///
/// This function corrects words in the input text by finding the best matches
/// from a list of custom words using a combination of:
/// - Levenshtein distance for string similarity
/// - Soundex phonetic matching for pronunciation similarity
/// - N-gram matching for multi-word speech artifacts (e.g., "Charge B" -> "ChargeBee")
///
/// # Arguments
/// * `text` - The input text to correct
/// * `custom_words` - List of custom words to match against
/// * `threshold` - Maximum similarity score to accept (0.0 = exact match, 1.0 = any match)
///
/// # Returns
/// The corrected text with custom words applied
pub fn apply_custom_words(text: &str, custom_words: &[String], threshold: f64) -> String {
    if custom_words.is_empty() {
        return text.to_string();
    }

    // Pre-compute normalized comparison keys to avoid repeated allocations.
    let custom_word_match_keys: Vec<CustomWordMatchKey> = custom_words
        .iter()
        .enumerate()
        .flat_map(|(index, word)| build_custom_word_match_keys(word, index))
        .collect();

    let words: Vec<&str> = text.split_whitespace().collect();
    let mut result = Vec::new();
    let mut i = 0;

    while i < words.len() {
        let mut best_match: Option<(usize, &String, f64)> = None;

        // Consider n-grams up to three words and choose the closest match. A
        // longest-first match can consume a following ordinary word when both
        // candidates happen to share a Soundex code (for example,
        // "Charge B, che" matching "ChargeBee").
        for n in (1..=3).rev() {
            if i + n > words.len() {
                continue;
            }

            let ngram_words = &words[i..i + n];
            // Do not consume across a punctuation boundary. In
            // "Charge B, che", the comma closes the candidate at "B,".
            if ngram_words[..n.saturating_sub(1)]
                .iter()
                .any(|word| !extract_punctuation(word).1.is_empty())
            {
                continue;
            }
            let ngram = build_ngram(ngram_words);

            if let Some((replacement, score)) =
                find_best_match(&ngram, custom_words, &custom_word_match_keys, threshold)
            {
                let is_better = best_match
                    .as_ref()
                    .is_none_or(|(_, _, best_score)| score < *best_score);
                if is_better {
                    best_match = Some((n, replacement, score));
                }
            }
        }

        if let Some((n, replacement, _)) = best_match {
            let ngram_words = &words[i..i + n];
            // Extract punctuation from first and last words of the n-gram.
            let (prefix, _) = extract_punctuation(ngram_words[0]);
            let (_, suffix) = extract_punctuation(ngram_words[n - 1]);

            // Preserve case from first word.
            let corrected = preserve_case_pattern(ngram_words[0], replacement);

            result.push(format!("{}{}{}", prefix, corrected, suffix));
            i += n;
        } else {
            result.push(words[i].to_string());
            i += 1;
        }
    }

    result.join(" ")
}

/// Preserves the case pattern of the original word when applying a replacement
fn preserve_case_pattern(original: &str, replacement: &str) -> String {
    if original.chars().all(|c| c.is_uppercase()) {
        replacement.to_uppercase()
    } else if original.chars().next().is_some_and(|c| c.is_uppercase()) {
        let mut chars: Vec<char> = replacement.chars().collect();
        if let Some(first_char) = chars.get_mut(0) {
            *first_char = first_char.to_uppercase().next().unwrap_or(*first_char);
        }
        chars.into_iter().collect()
    } else {
        replacement.to_string()
    }
}

/// Extracts punctuation prefix and suffix from a word
fn extract_punctuation(word: &str) -> (&str, &str) {
    // String slices use byte offsets. Derive both boundaries from char_indices
    // so multibyte punctuation such as `。` and `「」` can never be split.
    let prefix_end = word
        .char_indices()
        .find(|(_, c)| c.is_alphanumeric())
        .map(|(index, _)| index)
        .unwrap_or(word.len());
    let suffix_start = word
        .char_indices()
        .rev()
        .find(|(_, c)| c.is_alphanumeric())
        .map(|(index, c)| index + c.len_utf8())
        .unwrap_or(0);

    let prefix = if prefix_end > 0 {
        &word[..prefix_end]
    } else {
        ""
    };

    let suffix = if suffix_start < word.len() {
        &word[suffix_start..]
    } else {
        ""
    };

    (prefix, suffix)
}

/// Applies user-defined "wrong → right" substitution pairs to the transcribed
/// text (e.g. "cloud" -> "Claude Code"). Unlike `apply_custom_words` (fuzzy
/// nearest-neighbor correction toward a vocabulary the model already produced
/// something close to), each entry here is a literal, case-insensitive,
/// whole-word(s) replacement the user configured explicitly, so no fuzzy
/// matching or threshold applies — either it matches or it doesn't.
pub fn apply_custom_dictionary(text: &str, entries: &[DictionaryEntry]) -> String {
    if entries.is_empty() {
        return text.to_string();
    }

    let mut result = text.to_string();
    for entry in entries {
        let from = entry.from.trim();
        if from.is_empty() {
            continue;
        }
        // Word-boundary, case-insensitive. `from`/`to` are user-typed, free-form
        // text (not necessarily regex-safe), so the pattern is escaped.
        //
        // When `to` has more words than `from` ("cloud" → "Claude Code") and
        // the model already wrote the rest ("Cloud Code"), the match swallows
        // that tail so the result isn't "Claude Code Code".
        let from_word_count = from.split_whitespace().count();
        let to_words: Vec<&str> = entry.to.split_whitespace().collect();
        let tails: Vec<String> = (1..=to_words.len().saturating_sub(from_word_count))
            .rev()
            .map(|len| {
                to_words[to_words.len() - len..]
                    .iter()
                    .map(|word| regex::escape(word))
                    .collect::<Vec<_>>()
                    .join(r"\s+")
            })
            .collect();
        let pattern = if tails.is_empty() {
            format!(r"(?i)\b{}\b", regex::escape(from))
        } else {
            format!(
                r"(?i)\b{}\b(?:\s+(?:{})\b)?",
                regex::escape(from),
                tails.join("|")
            )
        };
        let re = match Regex::new(&pattern) {
            Ok(re) => re,
            // Pathological input (e.g. only punctuation once escaped/stripped of
            // word chars) — skip this entry rather than fail the whole pass.
            Err(_) => continue,
        };
        result = re
            .replace_all(&result, |caps: &regex::Captures| {
                preserve_case_pattern(&caps[0], &entry.to)
            })
            .into_owned();
    }
    result
}

/// Fase 8: a snippet expands only when its trigger is the *entire* dictated
/// utterance — not a substring match like the custom dictionary — so saying
/// a snippet's trigger word mid-sentence doesn't unexpectedly swap in a much
/// longer block of text. Case-insensitive; a trailing punctuation mark the
/// punctuation-commands step (or the ASR itself) may have added is ignored
/// on both sides so it doesn't stop an otherwise exact match.
pub fn apply_snippets(text: &str, entries: &[SnippetEntry]) -> String {
    if entries.is_empty() {
        return text.to_string();
    }

    let normalized = text
        .trim()
        .trim_end_matches(['.', ',', '!', '?', '¡', '¿'])
        .trim();
    if normalized.is_empty() {
        return text.to_string();
    }

    for entry in entries {
        let trigger = entry
            .trigger
            .trim()
            .trim_end_matches(['.', ',', '!', '?', '¡', '¿'])
            .trim();
        if !trigger.is_empty() && trigger.to_lowercase() == normalized.to_lowercase() {
            return entry.expansion.clone();
        }
    }

    text.to_string()
}

/// Spoken punctuation commands, checked longest-phrase-first so a multi-word
/// command (e.g. "punto y aparte") isn't shadowed by a shorter one it
/// contains (e.g. "punto"). Fixed built-in table for v1 — not user-editable
/// via settings, unlike the custom dictionary above.
const PUNCTUATION_COMMANDS: &[(&str, &str)] = &[
    ("punto y aparte", "\n\n"),
    ("punto y coma", ";"),
    ("signo de interrogación", "?"),
    ("cierra interrogación", "?"),
    ("abre interrogación", "¿"),
    ("signo de exclamación", "!"),
    ("cierra exclamación", "!"),
    ("abre exclamación", "¡"),
    ("nueva línea", "\n"),
    ("salto de línea", "\n"),
    ("dos puntos", ":"),
    ("coma", ","),
    ("punto", "."),
    ("guion", "-"),
    ("comillas", "\""),
];

/// Marks that open a construct — the word after them hugs them directly (no
/// space), rather than closing/separating one, which gets exactly one
/// trailing space so the next word doesn't run into it. A mark containing a
/// newline supplies its own separation and needs neither.
fn punctuation_command_trailing(mark: &str) -> &'static str {
    if mark.contains('\n') || matches!(mark, "¿" | "¡") {
        ""
    } else {
        " "
    }
}

/// Replaces spoken punctuation commands ("coma", "punto y aparte", ...) with
/// their symbol. Whitespace around the spoken command is swallowed and
/// replaced with whatever spacing the mark itself needs, so "hola coma como"
/// becomes "hola, como" rather than "hola , como".
pub fn apply_punctuation_commands(text: &str) -> String {
    let mut result = text.to_string();

    for (phrase, mark) in PUNCTUATION_COMMANDS {
        let opens = matches!(*mark, "¿" | "¡");
        let pattern = if opens {
            // Hugs the word that follows — swallow only the whitespace
            // *after* the spoken command; leave whatever precedes it (the
            // space separating it from the previous word) alone.
            format!(r"(?i)\b{}\b\s*", regex::escape(phrase))
        } else {
            // Closes or separates — swallow whitespace on both sides so the
            // mark doesn't end up with a stray space glued in front of it.
            format!(r"(?i)\s*\b{}\b\s*", regex::escape(phrase))
        };
        let re = match Regex::new(&pattern) {
            Ok(re) => re,
            Err(_) => continue,
        };
        let replacement = format!("{}{}", mark, punctuation_command_trailing(mark));
        result = re.replace_all(&result, replacement.as_str()).into_owned();
    }

    // A command at the very end of the text (e.g. "... nos vemos punto")
    // leaves a trailing separator with nothing after it to separate — trim it.
    result.trim_end().to_string()
}

static XUL_TRIGGER_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)^\s*(?:oye[,]?\s+)?xul\b[,]?\s*").unwrap());

/// Detects the Asistente voice trigger ("Xul") at the start of a dictation,
/// tolerating a couple of natural phrasings ("Oye Xul", "Xul,"). Runs after
/// the custom dictionary and custom-words correction have already had a
/// chance to fix a mis-transcribed "Xul" (e.g. "Chul"), so in the common case
/// this is just a plain prefix check — the regex's own tolerance is a second
/// line of defense, not the primary fix.
///
/// Returns the remaining text (the actual instruction) with the trigger
/// stripped, or `None` if the text doesn't start with it — the safe default
/// that leaves the dictation alone.
pub fn strip_xul_trigger(text: &str) -> Option<String> {
    let m = XUL_TRIGGER_RE.find(text)?;
    Some(text[m.end()..].to_string())
}

static TEACH_TRIGGER_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r"(?i)^\s*(?:que\s+)?(?:aprende|recuerda)(?:s)?(?:\s+que)?\s*[:,]?\s*").unwrap()
});

/// Detects the dictionary-teach voice trigger ("Xul, aprende que..." /
/// "Xul, recuerda que...") within an already Xul-stripped instruction. A
/// fixed keyword rather than free-form intent detection — reliable without
/// an extra LLM round-trip just to guess whether the user is teaching a
/// correction or asking something else.
///
/// Returns the remaining clause (what to extract a correction from), or
/// `None` if the instruction doesn't start with the keyword.
pub fn strip_teach_trigger(text: &str) -> Option<String> {
    let m = TEACH_TRIGGER_RE.find(text)?;
    Some(text[m.end()..].to_string())
}

/// Evidence for the language of the text being cleaned.
///
/// This intentionally describes the transcription output, not Handy's UI
/// language. Unknown output languages fail closed: built-in filler removal is
/// skipped rather than applying a language profile speculatively.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum OutputLanguageEvidence {
    UserSelected(String),
    ModelConstrained(String),
    /// The transcription model itself identified the language (audio-based
    /// LID, e.g. Whisper in auto mode).
    ModelDetected(String),
    /// Detected from the transcribed text with high confidence, constrained to
    /// the model's supported languages. Weakest accepted evidence.
    TextDetected(String),
    TranslatedToEnglish,
    Unknown,
}

impl OutputLanguageEvidence {
    fn language(&self) -> Option<&str> {
        match self {
            Self::UserSelected(language)
            | Self::ModelConstrained(language)
            | Self::ModelDetected(language)
            | Self::TextDetected(language) => Some(language),
            Self::TranslatedToEnglish => Some("en"),
            Self::Unknown => None,
        }
    }
}

/// Filler tokens that are not lexical words in any language Handy's models can
/// output, so removing them cannot corrupt text regardless of the (possibly
/// unknown) output language. Kept deliberately conservative: anything that is a
/// real word somewhere ("um" pt/de, "ha" es, "ah"/"eh" interjections, "mm"
/// millimetres) belongs in the language-gated lists instead.
const UNIVERSAL_FILLER_WORDS: &[&str] = &[
    "uh", "uhm", "umm", "uhh", "uhhh", "ehh", "ehm", "ahm", "hmm", "hm", "mmm", "хм", "ммм",
];

/// Filler words that are only safe to remove with evidence for the output
/// language, because the same token is a real word elsewhere (e.g. Portuguese
/// "um" = "a/an", German "um" = "at/around", Spanish "ha" = "has").
fn gated_filler_words_for_language(lang: &str) -> &'static [&'static str] {
    let base_lang = lang.split(&['-', '_'][..]).next().unwrap_or(lang);

    match base_lang {
        "en" => &["um", "ah", "eh", "ha"],
        "de" => &["äh", "ähm"],
        "fr" => &["euh"],
        _ => &[],
    }
}

static MULTI_SPACE_PATTERN: Lazy<Regex> = Lazy::new(|| Regex::new(r"\s{2,}").unwrap());

/// Collapses repeated words (3+ repetitions) to a single instance.
/// E.g., "wh wh wh wh" -> "wh", "I I I I" -> "I"
fn collapse_stutters(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.is_empty() {
        return text.to_string();
    }

    let mut result: Vec<&str> = Vec::new();
    let mut i = 0;

    while i < words.len() {
        let word = words[i];
        let word_lower = word.to_lowercase();

        if word_lower.chars().all(|c| c.is_alphabetic()) {
            // Count consecutive repetitions (case-insensitive)
            let mut count = 1;
            while i + count < words.len() && words[i + count].to_lowercase() == word_lower {
                count += 1;
            }

            // If 3+ repetitions, collapse to single instance
            if count >= 3 {
                result.push(word);
                i += count;
            } else {
                result.push(word);
                i += 1;
            }
        } else {
            result.push(word);
            i += 1;
        }
    }

    result.join(" ")
}

/// Removes filler words from transcription output when enabled.
///
/// Built-in removal is two-tiered: [`UNIVERSAL_FILLER_WORDS`] apply regardless
/// of language evidence, while [`gated_filler_words_for_language`] tokens are
/// only removed when the output language is known. A custom list is an
/// explicit user override and replaces both tiers without requiring language
/// evidence. `Some(empty vec)` disables removal, preserving the legacy
/// power-user setting. The master toggle takes precedence over both built-in
/// and custom lists.
///
/// # Arguments
/// * `text` - The raw transcription text to filter
/// * `language` - Evidence for the language of the transcription output
/// * `custom_filler_words` - Optional user-provided filler word list. `Some(vec)` overrides
///   language defaults; `Some(empty vec)` disables filtering; `None` uses language defaults.
/// * `enabled` - Whether filler-word removal is enabled
///
/// # Returns
/// The text with configured filler words removed
pub fn remove_filler_words(
    text: &str,
    language: &OutputLanguageEvidence,
    custom_filler_words: &Option<Vec<String>>,
    enabled: bool,
) -> String {
    if !enabled {
        return text.to_string();
    }

    // Build filler patterns from custom list or the built-in tiers
    let patterns: Vec<Regex> = match custom_filler_words {
        Some(words) => words
            .iter()
            .filter_map(|word| Regex::new(&format!(r"(?i)\b{}\b[,.]?", regex::escape(word))).ok())
            .collect(),
        None => UNIVERSAL_FILLER_WORDS
            .iter()
            .chain(
                language
                    .language()
                    .map(gated_filler_words_for_language)
                    .unwrap_or_default(),
            )
            .map(|word| Regex::new(&format!(r"(?i)\b{}\b[,.]?", regex::escape(word))).unwrap())
            .collect(),
    };

    // Remove filler words
    let mut filtered = text.to_string();
    for pattern in &patterns {
        filtered = pattern.replace_all(&filtered, "").to_string();
    }

    filtered
}

/// Applies non-filler transcription cleanup.
///
/// Kept separate from [`remove_filler_words`] so disabling filler deletion
/// does not also disable the existing repeated-word and whitespace cleanup.
pub fn normalize_transcription_output(text: &str) -> String {
    let mut normalized = collapse_stutters(text);

    // Clean up multiple spaces to single space
    normalized = MULTI_SPACE_PATTERN
        .replace_all(&normalized, " ")
        .to_string();

    // Trim leading/trailing whitespace
    normalized.trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Exercise the complete cleanup sequence with an explicitly selected
    /// language. Individual tests below predate the split between filler
    /// removal and non-filler normalization.
    fn filter_transcription_output(
        text: &str,
        language: &str,
        custom_filler_words: &Option<Vec<String>>,
    ) -> String {
        let language = OutputLanguageEvidence::UserSelected(language.to_string());
        let filtered = remove_filler_words(text, &language, custom_filler_words, true);
        normalize_transcription_output(&filtered)
    }

    #[test]
    fn test_apply_custom_words_exact_match() {
        let text = "hello world";
        let custom_words = vec!["Hello".to_string(), "World".to_string()];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert_eq!(result, "Hello World");
    }

    #[test]
    fn test_apply_custom_words_fuzzy_match() {
        let text = "helo wrold";
        let custom_words = vec!["hello".to_string(), "world".to_string()];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert_eq!(result, "hello world");
    }

    #[test]
    fn test_preserve_case_pattern() {
        assert_eq!(preserve_case_pattern("HELLO", "world"), "WORLD");
        assert_eq!(preserve_case_pattern("Hello", "world"), "World");
        assert_eq!(preserve_case_pattern("hello", "WORLD"), "WORLD");
    }

    #[test]
    fn test_extract_punctuation() {
        assert_eq!(extract_punctuation("hello"), ("", ""));
        assert_eq!(extract_punctuation("!hello?"), ("!", "?"));
        assert_eq!(extract_punctuation("...hello..."), ("...", "..."));
    }

    #[test]
    fn test_extract_punctuation_uses_unicode_boundaries() {
        assert_eq!(extract_punctuation("你好。"), ("", "。"));
        assert_eq!(extract_punctuation("「你好」"), ("「", "」"));
        assert_eq!(extract_punctuation("你好！"), ("", "！"));
    }

    #[test]
    fn test_empty_custom_words() {
        let text = "hello world";
        let custom_words = vec![];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert_eq!(result, "hello world");
    }

    #[test]
    fn test_apply_custom_dictionary_replaces_literal_pair() {
        let text = "voy a usar cloud para esto";
        let entries = vec![DictionaryEntry {
            id: "1".to_string(),
            from: "cloud".to_string(),
            to: "Claude Code".to_string(),
        }];
        let result = apply_custom_dictionary(text, &entries);
        assert_eq!(result, "voy a usar Claude Code para esto");
    }

    #[test]
    fn test_apply_custom_dictionary_is_case_insensitive_and_word_bounded() {
        let text = "Cloud es mi herramienta, no cloudy";
        let entries = vec![DictionaryEntry {
            id: "1".to_string(),
            from: "cloud".to_string(),
            to: "Claude Code".to_string(),
        }];
        let result = apply_custom_dictionary(text, &entries);
        // "Cloud" matched (case-insensitive) and re-capitalized; "cloudy"
        // left untouched (word boundary).
        assert_eq!(result, "Claude Code es mi herramienta, no cloudy");
    }

    #[test]
    fn test_apply_custom_dictionary_does_not_duplicate_existing_tail() {
        let entries = vec![DictionaryEntry {
            id: "1".to_string(),
            from: "cloud".to_string(),
            to: "Claude Code".to_string(),
        }];
        assert_eq!(
            apply_custom_dictionary("un límite a Cloud Code para que", &entries),
            "un límite a Claude Code para que"
        );
        // Only the replacement's own tail is swallowed, not any next word.
        assert_eq!(
            apply_custom_dictionary("abre cloud ahora", &entries),
            "abre Claude Code ahora"
        );
    }

    #[test]
    fn test_apply_custom_words_ignores_soundex_only_lookalikes() {
        // "que no" → "queno" shares Soundex Q500 with "Qwen" but is spelled
        // nothing like it; it must survive untouched.
        let custom_words = vec!["Qwen".to_string()];
        assert_eq!(
            apply_custom_words(
                "un límite para que no se consuma todos los tokens",
                &custom_words,
                0.18
            ),
            "un límite para que no se consuma todos los tokens"
        );
    }

    #[test]
    fn test_empty_custom_dictionary_is_noop() {
        let text = "hola cloud";
        let result = apply_custom_dictionary(text, &[]);
        assert_eq!(result, "hola cloud");
    }

    #[test]
    fn test_apply_snippets_expands_whole_utterance() {
        let entries = vec![SnippetEntry {
            id: "1".to_string(),
            trigger: "firma".to_string(),
            expansion: "Un saludo,\nJulio".to_string(),
        }];
        assert_eq!(apply_snippets("firma", &entries), "Un saludo,\nJulio");
        // Case-insensitive, and tolerant of a trailing period a punctuation
        // command (or the ASR itself) may have added.
        assert_eq!(apply_snippets("Firma.", &entries), "Un saludo,\nJulio");
    }

    #[test]
    fn test_apply_snippets_requires_whole_utterance_match() {
        let entries = vec![SnippetEntry {
            id: "1".to_string(),
            trigger: "firma".to_string(),
            expansion: "Un saludo,\nJulio".to_string(),
        }];
        let text = "la firma de este contrato es válida";
        assert_eq!(apply_snippets(text, &entries), text);
    }

    #[test]
    fn test_empty_snippets_is_noop() {
        let text = "firma";
        assert_eq!(apply_snippets(text, &[]), text);
    }

    #[test]
    fn test_punctuation_commands_coma_and_punto() {
        let text = "hola coma como estás punto";
        let result = apply_punctuation_commands(text);
        assert_eq!(result, "hola, como estás.");
    }

    #[test]
    fn test_punctuation_commands_punto_y_aparte_not_shadowed_by_punto() {
        let text = "primer párrafo punto y aparte segundo párrafo";
        let result = apply_punctuation_commands(text);
        assert_eq!(result, "primer párrafo\n\nsegundo párrafo");
    }

    #[test]
    fn test_punctuation_commands_opening_question_mark_hugs_next_word() {
        let text = "te pregunto abre interrogación cómo estás signo de interrogación";
        let result = apply_punctuation_commands(text);
        assert_eq!(result, "te pregunto ¿cómo estás?");
    }

    #[test]
    fn test_strip_xul_trigger_plain() {
        assert_eq!(
            strip_xul_trigger("Xul qué hora es en Tokio"),
            Some("qué hora es en Tokio".to_string())
        );
    }

    #[test]
    fn test_strip_xul_trigger_with_comma_and_greeting() {
        assert_eq!(
            strip_xul_trigger("Oye Xul, resume esto"),
            Some("resume esto".to_string())
        );
        assert_eq!(
            strip_xul_trigger("Xul, cómo estás"),
            Some("cómo estás".to_string())
        );
    }

    #[test]
    fn test_strip_xul_trigger_case_insensitive() {
        assert_eq!(
            strip_xul_trigger("XUL enciende la luz"),
            Some("enciende la luz".to_string())
        );
    }

    #[test]
    fn test_strip_xul_trigger_absent_leaves_dictation_alone() {
        assert_eq!(strip_xul_trigger("recuérdame comprar leche"), None);
        // Not a word-boundary match — "Xultra" isn't "Xul".
        assert_eq!(strip_xul_trigger("Xultra es una marca"), None);
    }

    #[test]
    fn test_strip_teach_trigger_plain() {
        assert_eq!(
            strip_teach_trigger("aprende que Chul se escribe Xul"),
            Some("Chul se escribe Xul".to_string())
        );
        assert_eq!(
            strip_teach_trigger("recuerda que cloud es Claude Code"),
            Some("cloud es Claude Code".to_string())
        );
    }

    #[test]
    fn test_strip_teach_trigger_without_que_or_punctuation() {
        assert_eq!(
            strip_teach_trigger("Aprende: Chul se escribe Xul"),
            Some("Chul se escribe Xul".to_string())
        );
        assert_eq!(
            strip_teach_trigger("recuerdas que esto es así"),
            Some("esto es así".to_string())
        );
    }

    #[test]
    fn test_strip_teach_trigger_absent_leaves_instruction_alone() {
        assert_eq!(strip_teach_trigger("cuál es la capital de Francia"), None);
        assert_eq!(strip_teach_trigger("aprendizaje automático"), None);
    }

    #[test]
    fn test_punctuation_commands_nueva_linea() {
        let text = "primera línea nueva línea segunda línea";
        let result = apply_punctuation_commands(text);
        assert_eq!(result, "primera línea\nsegunda línea");
    }

    #[test]
    fn test_filter_filler_words() {
        let text = "So uhm I was thinking uh about this";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "So I was thinking about this");
    }

    #[test]
    fn test_filter_filler_words_case_insensitive() {
        let text = "UHM this is UH a test";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "this is a test");
    }

    #[test]
    fn test_filter_filler_words_with_punctuation() {
        let text = "Well, uhm, I think, uh. that's right";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "Well, I think, that's right");
    }

    #[test]
    fn test_filter_cleans_whitespace() {
        let text = "Hello    world   test";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "Hello world test");
    }

    #[test]
    fn test_filter_trims() {
        let text = "  Hello world  ";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "Hello world");
    }

    #[test]
    fn test_filter_combined() {
        let text = "  Uhm, so I was, uh, thinking about this  ";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "so I was, thinking about this");
    }

    #[test]
    fn test_filter_preserves_valid_text() {
        let text = "This is a completely normal sentence.";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "This is a completely normal sentence.");
    }

    #[test]
    fn test_filter_stutter_collapse() {
        let text = "w wh wh wh wh wh wh wh wh wh why";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "w wh why");
    }

    #[test]
    fn test_filter_stutter_short_words() {
        let text = "I I I I think so so so so";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "I think so");
    }

    #[test]
    fn test_filter_stutter_longer_words() {
        let text = "Check data doc doc doc doc documentation.";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "Check data doc documentation.");
    }

    #[test]
    fn test_filter_stutter_mixed_case() {
        let text = "No NO no NO no";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "No");
    }

    #[test]
    fn test_filter_stutter_preserves_two_repetitions() {
        let text = "no no is fine";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "no no is fine");
    }

    #[test]
    fn test_filter_english_removes_um() {
        let text = "um I think um this is good";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "I think this is good");
    }

    #[test]
    fn test_filter_portuguese_preserves_um() {
        // "um" means "a/an" in Portuguese
        let text = "um gato bonito";
        let result = filter_transcription_output(text, "pt", &None);
        assert_eq!(result, "um gato bonito");
    }

    #[test]
    fn test_filter_spanish_preserves_ha() {
        // "ha" means "has" in Spanish
        let text = "ha sido un buen día";
        let result = filter_transcription_output(text, "es", &None);
        assert_eq!(result, "ha sido un buen día");
    }

    #[test]
    fn test_filter_language_code_with_region() {
        // "pt-BR" should normalize to "pt"
        let text = "um gato bonito";
        let result = filter_transcription_output(text, "pt-BR", &None);
        assert_eq!(result, "um gato bonito");
    }

    #[test]
    fn test_filter_custom_filler_words_override() {
        let custom = Some(vec!["okay".to_string(), "right".to_string()]);
        let text = "okay so I think right this works";
        let result = filter_transcription_output(text, "en", &custom);
        assert_eq!(result, "so I think this works");
    }

    #[test]
    fn test_filter_custom_filler_words_empty_disables() {
        let custom = Some(vec![]);
        let text = "So uhm I was thinking uh about this";
        let result = filter_transcription_output(text, "en", &custom);
        // No filler words removed since custom list is empty
        assert_eq!(result, "So uhm I was thinking uh about this");
    }

    #[test]
    fn test_filter_unknown_language_still_removes_universal_fillers() {
        let text = "uh I think uhm this works";
        let result = filter_transcription_output(text, "xx", &None);
        assert_eq!(result, "I think this works");
    }

    #[test]
    fn test_filter_unknown_language_does_not_remove_um() {
        let text = "um I think this works";
        let result = filter_transcription_output(text, "xx", &None);
        assert_eq!(result, "um I think this works");
    }

    #[test]
    fn test_filter_unknown_evidence_removes_universal_keeps_gated() {
        let filtered = remove_filler_words(
            "uhh bueno hmm creo que um ha llegado",
            &OutputLanguageEvidence::Unknown,
            &None,
            true,
        );
        assert_eq!(
            normalize_transcription_output(&filtered),
            "bueno creo que um ha llegado"
        );

        let cyrillic = remove_filler_words(
            "хм я думаю ммм это работает",
            &OutputLanguageEvidence::Unknown,
            &None,
            true,
        );
        assert_eq!(
            normalize_transcription_output(&cyrillic),
            "я думаю это работает"
        );
    }

    #[test]
    fn test_filter_german_gated_fillers_require_evidence() {
        let text = "äh ich glaube ähm das passt";

        let unknown = remove_filler_words(text, &OutputLanguageEvidence::Unknown, &None, true);
        assert_eq!(normalize_transcription_output(&unknown), text);

        let result = filter_transcription_output(text, "de", &None);
        assert_eq!(result, "ich glaube das passt");
    }

    #[test]
    fn test_filter_preserves_millimetre_unit() {
        // "mm" was removed from the filler lists because it eats units.
        let text = "the screw is 5 mm long";
        let result = filter_transcription_output(text, "en", &None);
        assert_eq!(result, "the screw is 5 mm long");
    }

    #[test]
    fn test_filter_detected_evidence_unlocks_gated_fillers() {
        let model = remove_filler_words(
            "um I think this works",
            &OutputLanguageEvidence::ModelDetected("en".to_string()),
            &None,
            true,
        );
        assert_eq!(normalize_transcription_output(&model), "I think this works");

        let text = remove_filler_words(
            "euh je pense que ça marche",
            &OutputLanguageEvidence::TextDetected("fr".to_string()),
            &None,
            true,
        );
        assert_eq!(
            normalize_transcription_output(&text),
            "je pense que ça marche"
        );
    }

    #[test]
    fn test_filter_master_toggle_disables_custom_and_builtin_removal() {
        let text = "um customword I think";
        let language = OutputLanguageEvidence::UserSelected("en".to_string());
        let custom = Some(vec!["customword".to_string()]);

        let result = remove_filler_words(text, &language, &custom, false);

        assert_eq!(result, text);
    }

    #[test]
    fn test_filter_custom_words_apply_without_language_evidence() {
        let custom = Some(vec!["customword".to_string()]);
        let text = "customword should be removed but um should remain";

        let filtered = remove_filler_words(text, &OutputLanguageEvidence::Unknown, &custom, true);
        let result = normalize_transcription_output(&filtered);

        assert_eq!(result, "should be removed but um should remain");
    }

    #[test]
    fn test_apply_custom_words_ngram_two_words() {
        let text = "il cui nome è Charge B, che permette";
        let custom_words = vec!["ChargeBee".to_string()];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert!(result.contains("ChargeBee,"), "unexpected result: {result}");
        assert!(!result.contains("Charge B"));
    }

    #[test]
    fn test_apply_custom_words_ngram_three_words() {
        let text = "use Chat G P T for this";
        let custom_words = vec!["ChatGPT".to_string()];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert!(result.contains("ChatGPT"));
    }

    #[test]
    fn test_apply_custom_words_prefers_longer_ngram() {
        let text = "Open AI GPT model";
        let custom_words = vec!["OpenAI".to_string(), "GPT".to_string()];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert_eq!(result, "OpenAI GPT model");
    }

    #[test]
    fn test_apply_custom_words_ngram_preserves_case() {
        let text = "CHARGE B is great";
        let custom_words = vec!["ChargeBee".to_string()];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert!(result.contains("CHARGEBEE"));
    }

    #[test]
    fn test_apply_custom_words_ngram_with_spaces_in_custom() {
        // Custom word with space should also match against split words
        let text = "using Mac Book Pro";
        let custom_words = vec!["MacBook Pro".to_string()];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert_eq!(result, "using MacBook Pro");
    }

    #[test]
    fn test_apply_custom_words_trailing_number_not_doubled() {
        // Verify that trailing non-alpha chars (like numbers) aren't double-counted
        // between build_ngram stripping them and extract_punctuation capturing them
        let text = "use GPT4 for this";
        let custom_words = vec!["GPT-4".to_string()];
        let result = apply_custom_words(text, &custom_words, 0.5);
        // Should NOT produce "GPT-44" (double-counting the trailing 4)
        assert!(
            !result.contains("GPT-44"),
            "got double-counted result: {}",
            result
        );
    }

    #[test]
    fn test_apply_custom_words_matches_ampersand_word() {
        let text = "send it to RD for review";
        let custom_words = vec!["R&D".to_string()];
        let result = apply_custom_words(text, &custom_words, 0.18);
        assert_eq!(result, "send it to R&D for review");
    }

    #[test]
    fn test_apply_custom_words_matches_spoken_ampersand_word() {
        let text = "send it to R and D for review";
        let custom_words = vec!["R&D".to_string()];
        let result = apply_custom_words(text, &custom_words, 0.18);
        assert_eq!(result, "send it to R&D for review");
    }

    #[test]
    fn test_apply_custom_words_preserves_ampersand_word() {
        let text = "send it to R&D for review";
        let custom_words = vec!["R&D".to_string()];
        let result = apply_custom_words(text, &custom_words, 0.18);
        assert_eq!(result, "send it to R&D for review");
    }

    #[test]
    fn test_apply_custom_words_handles_unicode_punctuation() {
        let text = "「Handee。」";
        let custom_words = vec!["Handy".to_string()];
        let result = apply_custom_words(text, &custom_words, 0.5);
        assert_eq!(result, "「Handy。」");
    }

    #[test]
    fn test_apply_custom_words_skips_cjk_fuzzy_matching() {
        let text = "你好。";
        let custom_words = vec!["你号".to_string()];
        let result = apply_custom_words(text, &custom_words, 1.0);
        assert_eq!(result, text);
    }
}
