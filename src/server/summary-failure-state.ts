type SummaryStateItem = {
  document: {
    metadataJson: string;
  } | null;
  id: string;
  type: string;
};

function readSummaryStatus(metadataJson: string) {
  try {
    const metadata = JSON.parse(metadataJson) as { summaryStatus?: unknown };
    return metadata && typeof metadata === "object" ? metadata.summaryStatus : null;
  } catch {
    return null;
  }
}

export function hasFailedArticleSummary(metadataJson: string) {
  return readSummaryStatus(metadataJson) === "failed";
}

export function failedArticleSummaryIds(items: SummaryStateItem[]) {
  return new Set(
    items
      .filter((item) => item.type === "article" && item.document && hasFailedArticleSummary(item.document.metadataJson))
      .map((item) => item.id)
  );
}
