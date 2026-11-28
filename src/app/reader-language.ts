const HAN = /\p{Script=Han}/gu;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const HANGUL = /\p{Script=Hangul}/gu;
const LATIN = /\p{Script=Latin}/gu;

function count(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0;
}

// The extracted `language` comes from page metadata and is often missing or wrong
// (Chinese sites declaring lang="en"), so the text's script mix decides CJK languages.
export function readingLanguage(declared: string | null | undefined, text: string | null | undefined) {
  const sample = (text ?? "").slice(0, 4000);
  const han = count(sample, HAN);
  const kana = count(sample, KANA);
  const hangul = count(sample, HANGUL);
  const latin = count(sample, LATIN);
  const normalized = declared?.trim() || null;
  if (hangul >= 20 && hangul * 2 >= latin) return "ko";
  if (kana >= 20 && kana * 10 >= han) return "ja";
  if (han >= 20 && han * 2 >= latin) return normalized?.toLowerCase().startsWith("zh") ? normalized : "zh-CN";
  if (normalized && !/^(zh|ja|ko)\b/i.test(normalized)) return normalized;
  return latin > 0 ? "en" : undefined;
}

// Short passages (highlights, notes, titles) often have fewer than 20 CJK characters,
// so detect their script mix without requiring article-length counts.
export function snippetReadingLanguage(declared: string | null | undefined, text: string | null | undefined) {
  const sample = (text ?? "").slice(0, 1000);
  const han = count(sample, HAN);
  const kana = count(sample, KANA);
  const hangul = count(sample, HANGUL);
  const latin = count(sample, LATIN);
  const normalized = declared?.trim() || null;
  const normalizedLower = normalized?.toLowerCase() ?? null;
  const usableDeclared = normalized && normalizedLower !== "original" && normalizedLower !== "article"
    ? normalized
    : null;

  if ((hangul >= 2 && hangul * 2 >= latin) || (hangul >= 1 && latin === 0 && han === 0 && kana === 0)) {
    return "ko";
  }
  if ((kana >= 2 && kana * 10 >= han) || (kana >= 1 && han === 0 && latin === 0)) {
    return "ja";
  }
  if ((han >= 2 && han * 2 >= latin) || (han >= 1 && latin === 0)) {
    return usableDeclared?.toLowerCase().startsWith("zh") ? usableDeclared : "zh-CN";
  }
  if (usableDeclared && !/^(zh|ja|ko)\b/i.test(usableDeclared)) {
    return usableDeclared;
  }
  return latin > 0 ? "en" : usableDeclared ?? undefined;
}
