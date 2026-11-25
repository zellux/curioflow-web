import { AddSourceButton } from "@/app/add-source-dialog";
import type { UiCopy } from "@/app/i18n";
import { appHref } from "@/app/routes";
import { SettingsButton } from "@/app/settings-button";
import { settingsOverlayHref } from "@/app/settings-overlay-state";
import { SubscriptionSourceSelect } from "@/app/subscription-source-select";

type SubscriptionSource = {
  id: string;
  type: string;
  name: string;
  category: string | null;
  _count: { items: number };
};

export function SubscriptionControls({ copy, sources, sourceId, sourceKind }: {
  copy: UiCopy;
  sources: SubscriptionSource[];
  sourceId?: string;
  sourceKind: "feed" | "newsletter";
}) {
  const isRss = sourceKind === "feed";
  const allHref = appHref({ filter: isRss ? "recent-posts" : "newsletters" });
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
      {groups.size ? <SubscriptionSourceSelect
        all={{ href: allHref, label: copy.subscriptions.allSources }}
        groups={Array.from(groups, ([name, entries]) => ({
          name,
          options: entries.map((source) => ({
            href: appHref({ source: source.id, sourceKind }),
            label: `${source.name} (${source._count.items})`
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
          href={settingsOverlayHref(selectedHref, "newsletter")}
          label={copy.newsletters.title}
          tab="newsletter"
        >{copy.newsletters.title}</SettingsButton>
      )}
    </div>
  );
}
