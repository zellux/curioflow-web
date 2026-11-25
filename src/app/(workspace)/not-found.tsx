"use client";

import Link from "next/link";
import { pickLocale } from "@/app/i18n";
import { useNavigationState } from "@/app/navigation-state";

export default function WorkspaceNotFound() {
  const { locale } = useNavigationState();
  const copy = pickLocale(locale, {
    en: {
      title: "Article not found",
      body: "It may have been deleted or belong to another library.",
      back: "Back to library"
    },
    "zh-Hans": {
      title: "找不到这篇文章",
      body: "文章可能已被删除，或不在当前资料库中。",
      back: "返回资料库"
    },
    "zh-Hant": {
      title: "找不到這篇文章",
      body: "文章可能已被刪除，或不在目前的資料庫中。",
      back: "返回資料庫"
    },
    ja: {
      title: "記事が見つかりません",
      body: "削除されたか、別のライブラリに属している可能性があります。",
      back: "ライブラリに戻る"
    },
    ko: {
      title: "글을 찾을 수 없습니다",
      body: "삭제되었거나 다른 라이브러리에 속한 글일 수 있습니다.",
      back: "라이브러리로 돌아가기"
    }
  });
  return <div className="scrollArea"><div className="libraryView contentLoadError">
    <h1>{copy.title}</h1>
    <p>{copy.body}</p>
    <Link href="/home">{copy.back}</Link>
  </div></div>;
}
