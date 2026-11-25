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
