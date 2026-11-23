import Link from "next/link";
import { AddSourceButton } from "@/app/add-source-dialog";
import type { UiCopy } from "@/app/i18n";
import { appHref } from "@/app/routes";
import { SettingsButton } from "@/app/settings-button";
import { SubscriptionSourceSelect } from "@/app/subscription-source-select";

type SubscriptionSource = {
  id: string;
  type: string;
  name: string;
  category: string | null;
  pendingCount: number;
};

export function SubscriptionControls({ copy, sources, sourceId, sourceKind }: {
  copy: UiCopy;
  sources: SubscriptionSource[];
  sourceId?: string;
  sourceKind: "feed" | "newsletter";
}) {
  const rssHref = appHref({ filter: "recent-posts" });
  const newsletterHref = appHref({ filter: "newsletters" });
  const isRss = sourceKind === "feed";
  const allHref = isRss ? rssHref : newsletterHref;
  const selectedHref = sourceId ? appHref({ source: sourceId, sourceKind }) : allHref;
  const groups = new Map<string | null, SubscriptionSource[]>();
  for (const source of sources) {
    if (source.type !== (isRss ? "rss" : "newsletter")) continue;
    const category = isRss ? source.category : null;
    const group = groups.get(category) ?? [];
    group.push(source);
    groups.set(category, group);
  }

  return (
    <div className="subscriptionControls">
      <nav className="chips subscriptionKinds" aria-label={copy.subscriptions.type}>
        <Link className={isRss ? "active" : ""} aria-current={isRss ? "true" : undefined} href={rssHref}>{copy.sidebar.feeds}</Link>
        <Link className={!isRss ? "active" : ""} aria-current={!isRss ? "true" : undefined} href={newsletterHref}>{copy.sidebar.newsletters}</Link>
      </nav>
      <div className="subscriptionActions">
        {groups.size ? <SubscriptionSourceSelect
          all={{ href: allHref, label: copy.subscriptions.allSources }}
          groups={Array.from(groups, ([name, entries]) => ({
            name,
            options: entries.map((source) => ({
              href: appHref({ source: source.id, sourceKind }),
              label: `${source.name} (${source.pendingCount})`
            }))
          }))}
          label={copy.subscriptions.source}
          value={selectedHref}
        /> : null}
        {isRss ? (
          <AddSourceButton className="subtleActionButton" label={copy.subscriptions.addFeed} tab="rss" />
        ) : (
          <SettingsButton
            className="subtleActionButton"
            href={`${appHref({ filter: "newsletters", settings: "import" })}#import-newsletter`}
            importTarget="newsletter"
            label={copy.newsletters.title}
          >{copy.newsletters.title}</SettingsButton>
        )}
      </div>
    </div>
  );
}
