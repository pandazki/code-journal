/**
 * Analysis language — which language the lenses write their PROSE in.
 *
 * Only the model-authored prose (Arc / Before / After / Why / empty-state
 * reasons) follows this setting. Structural tokens (field labels, stance
 * keywords) and verbatim quotes are NEVER translated — the grounding gate and
 * the web console parse those, and quotes must stay in the user's own words.
 *
 * Detection is a cheap character-script heuristic over the user's own turns —
 * no model call. It reliably separates the high-value non-Latin cases
 * (Chinese / Japanese / Korean); Latin-script text defaults to English (the
 * heuristic can't tell en/es/fr/… apart by script alone — those are set
 * explicitly in Settings).
 */

export interface Language {
  code: string;
  /** English label for UI. */
  label: string;
  /** Phrase injected into the lens prompt ("Write … in <promptName>."). */
  promptName: string;
}

/** Supported analysis languages. `auto` is a sentinel handled before this map. */
export const LANGUAGES: Language[] = [
  { code: 'en', label: 'English', promptName: 'English' },
  { code: 'zh', label: '中文 (Chinese)', promptName: "Chinese (match the user's variant — Simplified or Traditional)" },
  { code: 'ja', label: '日本語 (Japanese)', promptName: 'Japanese' },
  { code: 'ko', label: '한국어 (Korean)', promptName: 'Korean' },
  { code: 'es', label: 'Español (Spanish)', promptName: 'Spanish' },
  { code: 'fr', label: 'Français (French)', promptName: 'French' },
  { code: 'de', label: 'Deutsch (German)', promptName: 'German' },
  { code: 'pt', label: 'Português (Portuguese)', promptName: 'Portuguese' },
  { code: 'ru', label: 'Русский (Russian)', promptName: 'Russian' },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function isLanguageCode(v: unknown): boolean {
  return typeof v === 'string' && BY_CODE.has(v);
}

/** The prompt phrase for a code; falls back to English for unknown codes. */
export function languagePromptName(code: string): string {
  return BY_CODE.get(code)?.promptName ?? 'English';
}

export function languageLabel(code: string): string {
  return BY_CODE.get(code)?.label ?? code;
}

/**
 * Infer an analysis language from the user's own turn text by character script.
 *
 * Returns a code in LANGUAGES, defaulting to 'en'. Only the scripts that a
 * char-count can actually distinguish are detected; everything Latin → 'en'.
 */
export function detectLanguage(texts: string[]): string {
  const joined = texts.join('\n');
  let han = 0; // CJK ideographs (Chinese, or Kanji in Japanese)
  let kana = 0; // Hiragana + Katakana → Japanese
  let hangul = 0; // → Korean
  let cyrillic = 0;
  let latin = 0;

  for (const ch of joined) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0x3040 && cp <= 0x30ff) kana++;
    else if (cp >= 0x1100 && cp <= 0x11ff) hangul++;
    else if (cp >= 0xac00 && cp <= 0xd7af) hangul++;
    else if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)) han++;
    else if (cp >= 0x0400 && cp <= 0x04ff) cyrillic++;
    else if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) latin++;
  }

  const scripted = han + kana + hangul + cyrillic;
  // Need a minimum of non-Latin signal before overriding the English default,
  // so a stray emoji-name or one Chinese word in an English session doesn't flip it.
  const MIN = 8;

  // Kana present at all → Japanese (Japanese mixes Kanji + kana; Chinese has no kana).
  if (kana >= 3 && kana + han >= MIN) return 'ja';
  if (hangul >= MIN) return 'ko';
  if (han >= MIN && han >= latin) return 'zh';
  if (cyrillic >= MIN && cyrillic >= latin) return 'ru';
  return 'en';
}
