import { pickLocale, type SystemLanguage } from "@/app/i18n";

export function starredCopy(locale: SystemLanguage) {
  return pickLocale(locale, {
    en: { label: "Starred", star: "Star", unstar: "Unstar", removed: "Star removed", empty: "Star articles to find them here." },
    "zh-Hans": { label: "星标", star: "加星", unstar: "取消星标", removed: "已取消星标", empty: "给文章加星，即可在这里查看。" },
    "zh-Hant": { label: "星號", star: "加上星號", unstar: "移除星號", removed: "已移除星號", empty: "為文章加上星號，即可在這裡查看。" },
    ja: { label: "スター付き", star: "スターを付ける", unstar: "スターを外す", removed: "スターを外しました", empty: "スターを付けた記事がここに表示されます。" },
    ko: { label: "별표 표시", star: "별표 추가", unstar: "별표 제거", removed: "별표를 제거했습니다", empty: "별표를 표시한 글이 여기에 표시됩니다." }
  });
}
